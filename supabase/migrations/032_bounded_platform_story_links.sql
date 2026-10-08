-- T09a: links to ALREADY PUBLIC platform text only. No private assets/voices,
-- invitations, consent substitution or widening of the original story ACL.
CREATE TABLE public.story_share_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 is_active boolean NOT NULL DEFAULT true,
 revoked_at timestamptz,
 view_count integer NOT NULL DEFAULT 0
);
CREATE INDEX story_share_links_issuer ON public.story_share_links(user_id,created_at DESC);
ALTER TABLE public.story_share_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.story_share_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.story_share_links TO service_role;

CREATE FUNCTION public.issue_platform_story_link(p_story uuid,p_hours integer DEFAULT 168) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE u uuid:=auth.uid(); h uuid; token text; link public.story_share_links;
BEGIN
 h:=public.current_household_id();
 IF u IS NULL OR h IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF p_hours IS NULL OR p_hours NOT IN(24,72,168) THEN RAISE EXCEPTION 'Invalid lifetime' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=u FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.stories WHERE id=p_story AND is_platform_content AND is_published AND status='published' AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Only public platform stories' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.story_share_links WHERE user_id=u AND created_at>now()-interval '24 hours')>=60
 OR (SELECT count(*) FROM public.story_share_links WHERE user_id=u AND story_id=p_story AND is_active AND expires_at>now())>=10
 THEN RAISE EXCEPTION 'Link limit' USING ERRCODE='54000'; END IF;
 token:=encode(gen_random_bytes(32),'hex');
 INSERT INTO public.story_share_links(story_id,user_id,household_id,token_hash,expires_at)
 VALUES(p_story,u,h,encode(digest(token,'sha256'),'hex'),now()+make_interval(hours=>p_hours))
 RETURNING * INTO link;
 RETURN jsonb_build_object('id',link.id,'story_id',link.story_id,'share_token',token,'expires_at',link.expires_at,'is_active',true,'view_count',0);
END $$;
REVOKE ALL ON FUNCTION public.issue_platform_story_link(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_platform_story_link(uuid,integer) TO authenticated;

CREATE FUNCTION public.list_platform_story_links(p_story uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'expires_at',s.expires_at,'is_active',s.is_active AND s.expires_at>now(),'view_count',s.view_count) ORDER BY s.created_at DESC),'[]'::jsonb)
 FROM (SELECT * FROM public.story_share_links WHERE user_id=auth.uid() AND household_id=public.current_household_id() AND story_id=p_story ORDER BY created_at DESC LIMIT 100) s
$$;
REVOKE ALL ON FUNCTION public.list_platform_story_links(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_platform_story_links(uuid) TO authenticated;

CREATE FUNCTION public.revoke_platform_story_link(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.story_share_links SET is_active=false,revoked_at=coalesce(revoked_at,now())
 WHERE id=p_id AND user_id=auth.uid() AND household_id=public.current_household_id();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.revoke_platform_story_link(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_story_link(uuid) TO authenticated;

CREATE FUNCTION public.resolve_platform_story_link(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE l public.story_share_links; s public.stories; pages jsonb;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT x.* INTO l FROM public.story_share_links x
 JOIN public.profiles p ON p.id=x.user_id AND p.household_id=x.household_id
 JOIN public.households h ON h.id=x.household_id AND h.owner_user_id=x.user_id
 JOIN public.household_memberships m ON m.household_id=x.household_id AND m.user_id=x.user_id
 WHERE x.token_hash=encode(digest(p_token,'sha256'),'hex') AND x.is_active AND x.expires_at>now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO s FROM public.stories WHERE id=l.story_id AND is_platform_content AND is_published AND status='published' AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM public.story_pages WHERE story_id=s.id)>100
 OR (SELECT coalesce(sum(char_length(content)),0) FROM public.story_pages WHERE story_id=s.id)>200000
 OR EXISTS(SELECT 1 FROM public.story_pages WHERE story_id=s.id AND char_length(content)>10000)
 THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('page_number',page_number,'content',content) ORDER BY page_number),'[]'::jsonb)
 INTO pages FROM public.story_pages WHERE story_id=s.id;
 UPDATE public.story_share_links SET view_count=least(view_count+1,1000000000) WHERE id=l.id AND is_active AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('story',jsonb_build_object('id',s.id,'title',s.title,'description',s.description),'pages',pages);
END $$;
REVOKE ALL ON FUNCTION public.resolve_platform_story_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_platform_story_link(text) TO anon,authenticated;