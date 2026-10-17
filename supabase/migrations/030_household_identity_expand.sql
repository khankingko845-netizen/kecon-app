-- T08a expand only: default household identity, no legacy ACL widening or sharing.
-- family_members remains the existing people/voice list, not account membership.
CREATE TABLE public.households (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.household_memberships (
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','parent')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(household_id,user_id)
);
CREATE INDEX household_membership_user ON public.household_memberships(user_id);
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.households,public.household_memberships FROM anon,authenticated;
GRANT SELECT ON public.households,public.household_memberships TO authenticated;
GRANT ALL ON public.households,public.household_memberships TO service_role;

CREATE FUNCTION public.is_household_member(p_household uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.household_memberships WHERE household_id=p_household AND user_id=auth.uid()
 )
$$;
REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid) TO authenticated;
CREATE POLICY household_member_read ON public.households FOR SELECT TO authenticated USING(public.is_household_member(id));
CREATE POLICY household_membership_read ON public.household_memberships FOR SELECT TO authenticated USING(public.is_household_member(household_id));

CREATE FUNCTION public.ensure_default_household(p_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid;
BEGIN
 INSERT INTO public.households(owner_user_id) VALUES(p_user) ON CONFLICT(owner_user_id) DO NOTHING;
 SELECT id INTO STRICT h FROM public.households WHERE owner_user_id=p_user;
 INSERT INTO public.household_memberships(household_id,user_id,role) VALUES(h,p_user,'owner') ON CONFLICT DO NOTHING;
 RETURN h;
END $$;
REVOKE ALL ON FUNCTION public.ensure_default_household(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_household(uuid) TO service_role;

INSERT INTO public.households(owner_user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.household_memberships(household_id,user_id,role) SELECT id,owner_user_id,'owner' FROM public.households ON CONFLICT DO NOTHING;
ALTER TABLE public.profiles ADD COLUMN household_id uuid REFERENCES public.households(id) DEFERRABLE INITIALLY DEFERRED;
UPDATE public.profiles p SET household_id=h.id FROM public.households h WHERE h.owner_user_id=p.id;
SET CONSTRAINTS profiles_household_id_fkey IMMEDIATE;
ALTER TABLE public.profiles ALTER COLUMN household_id SET NOT NULL;
SET CONSTRAINTS profiles_household_id_fkey DEFERRED;
CREATE INDEX profile_household ON public.profiles(household_id);
CREATE FUNCTION public.bind_profile_household() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid;
BEGIN
 h:=public.ensure_default_household(NEW.id);
 IF NEW.household_id IS NOT NULL AND NEW.household_id IS DISTINCT FROM h THEN
  RAISE EXCEPTION 'Household scope is server managed' USING ERRCODE='42501';
 END IF;
 NEW.household_id:=h;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_profile_household() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER profile_household_bind BEFORE INSERT OR UPDATE OF id,household_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.bind_profile_household();

ALTER TABLE public.stories ADD COLUMN household_id uuid REFERENCES public.households(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.voice_profiles ADD COLUMN household_id uuid REFERENCES public.households(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.family_members ADD COLUMN household_id uuid REFERENCES public.households(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.story_pages ADD COLUMN household_id uuid REFERENCES public.households(id) DEFERRABLE INITIALLY DEFERRED;
UPDATE public.stories s SET household_id=p.household_id FROM public.profiles p WHERE s.user_id=p.id AND NOT s.is_platform_content;
UPDATE public.voice_profiles v SET household_id=p.household_id FROM public.profiles p WHERE v.user_id=p.id;
UPDATE public.family_members f SET household_id=p.household_id FROM public.profiles p WHERE f.user_id=p.id;
UPDATE public.story_pages p SET household_id=s.household_id FROM public.stories s WHERE p.story_id=s.id;
SET CONSTRAINTS stories_household_id_fkey,voice_profiles_household_id_fkey,family_members_household_id_fkey,story_pages_household_id_fkey IMMEDIATE;
CREATE INDEX story_household ON public.stories(household_id);
CREATE INDEX voice_household ON public.voice_profiles(household_id);
CREATE INDEX family_people_household ON public.family_members(household_id);
CREATE INDEX page_household ON public.story_pages(household_id);

CREATE FUNCTION public.bind_owned_household() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid; platform boolean:=false;
BEGIN
 IF TG_TABLE_NAME='stories' THEN platform:=NEW.is_platform_content; END IF;
 IF NOT platform AND NEW.user_id IS NOT NULL THEN
  SELECT household_id INTO STRICT h FROM public.profiles WHERE id=NEW.user_id;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.household_id IS NOT NULL AND NEW.household_id IS DISTINCT FROM h THEN
   RAISE EXCEPTION 'Household scope mismatch' USING ERRCODE='42501';
  END IF;
 ELSE
  IF NEW.household_id IS DISTINCT FROM OLD.household_id AND NEW.household_id IS DISTINCT FROM h THEN
   RAISE EXCEPTION 'Household scope mismatch' USING ERRCODE='42501';
  END IF;
 END IF;
 NEW.household_id:=h;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_owned_household() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER story_household_bind BEFORE INSERT OR UPDATE OF user_id,household_id,is_platform_content ON public.stories FOR EACH ROW EXECUTE FUNCTION public.bind_owned_household();
CREATE TRIGGER voice_household_bind BEFORE INSERT OR UPDATE OF user_id,household_id ON public.voice_profiles FOR EACH ROW EXECUTE FUNCTION public.bind_owned_household();
CREATE TRIGGER family_people_household_bind BEFORE INSERT OR UPDATE OF user_id,household_id ON public.family_members FOR EACH ROW EXECUTE FUNCTION public.bind_owned_household();
CREATE FUNCTION public.bind_page_household() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid;
BEGIN
 SELECT household_id INTO STRICT h FROM public.stories WHERE id=NEW.story_id;
 IF TG_OP='INSERT' THEN
  IF NEW.household_id IS NOT NULL AND NEW.household_id IS DISTINCT FROM h THEN RAISE EXCEPTION 'Household scope mismatch' USING ERRCODE='42501'; END IF;
 ELSE
  IF NEW.household_id IS DISTINCT FROM OLD.household_id AND NEW.household_id IS DISTINCT FROM h THEN RAISE EXCEPTION 'Household scope mismatch' USING ERRCODE='42501'; END IF;
 END IF;
 NEW.household_id:=h; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_page_household() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER page_household_bind BEFORE INSERT OR UPDATE OF story_id,household_id ON public.story_pages FOR EACH ROW EXECUTE FUNCTION public.bind_page_household();
-- Reclassifying/moving a story updates page identity in the same transaction.
CREATE FUNCTION public.sync_page_household() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.story_pages SET household_id=NEW.household_id WHERE story_id=NEW.id AND household_id IS DISTINCT FROM NEW.household_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_page_household() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER story_household_pages AFTER UPDATE ON public.stories FOR EACH ROW WHEN(OLD.household_id IS DISTINCT FROM NEW.household_id) EXECUTE FUNCTION public.sync_page_household();

CREATE FUNCTION public.my_household_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('household_id',h.id,'role',m.role) INTO result
 FROM public.households h JOIN public.household_memberships m ON m.household_id=h.id AND m.user_id=auth.uid()
 WHERE h.owner_user_id=auth.uid();
 IF result IS NULL THEN RAISE EXCEPTION 'Household not ready' USING ERRCODE='55000'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.my_household_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_household_context() TO authenticated;

SET CONSTRAINTS stories_household_id_fkey,voice_profiles_household_id_fkey,family_members_household_id_fkey,story_pages_household_id_fkey DEFERRED;
