-- T08b: bounded default-household data access. Additive restrictive policies.
-- No invitation/tenant switch, no private-voice sharing, no Storage URL migration.
-- Legacy rows are not deleted/repriced/rewritten. Invalid references fail closed.
-- Server-issued provider identity receipt. A self-owned metadata row is not proof
-- of provider ownership: clients cannot invent/steal a Voice ID by direct REST.
CREATE TABLE public.voice_provider_claims (
 voice_id text PRIMARY KEY CHECK(char_length(voice_id) BETWEEN 1 AND 120),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.voice_provider_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_provider_claims FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.voice_provider_claims TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.voice_profiles WHERE elevenlabs_voice_id IS NOT NULL AND elevenlabs_voice_id<>'' GROUP BY elevenlabs_voice_id HAVING count(DISTINCT user_id)>1)
 THEN RAISE EXCEPTION 'Ambiguous legacy voice ownership requires review' USING ERRCODE='42501'; END IF;
END $$;
-- Preserve legacy identities under their existing owner; no claim that legacy
-- provider consent/ownership has been independently verified (T12 reconciliation).
INSERT INTO public.voice_provider_claims(voice_id,user_id,household_id,created_at)
 SELECT DISTINCT ON(elevenlabs_voice_id) elevenlabs_voice_id,user_id,household_id,created_at FROM public.voice_profiles
 WHERE elevenlabs_voice_id IS NOT NULL AND elevenlabs_voice_id<>'' ORDER BY elevenlabs_voice_id,created_at;
CREATE FUNCTION public.record_voice_provider_claim(p_user uuid,p_voice text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid;
BEGIN
 IF p_user IS NULL OR p_voice IS NULL OR char_length(p_voice) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid voice receipt' USING ERRCODE='22023'; END IF;
 SELECT p.household_id INTO h FROM public.profiles p JOIN public.household_memberships m ON m.household_id=p.household_id AND m.user_id=p.id WHERE p.id=p_user;
 IF h IS NULL THEN RAISE EXCEPTION 'Voice scope unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.voice_provider_claims(voice_id,user_id,household_id) VALUES(p_voice,p_user,h) ON CONFLICT(voice_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.voice_provider_claims WHERE voice_id=p_voice AND user_id=p_user AND household_id=h) THEN RAISE EXCEPTION 'Invalid voice receipt' USING ERRCODE='42501'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_voice_provider_claim(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_voice_provider_claim(uuid,text) TO service_role;
CREATE FUNCTION public.guard_voice_provider_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.elevenlabs_voice_id IS NOT NULL AND NEW.elevenlabs_voice_id<>'' AND NOT EXISTS(
  SELECT 1 FROM public.voice_provider_claims c WHERE c.voice_id=NEW.elevenlabs_voice_id AND c.user_id=NEW.user_id AND c.household_id=NEW.household_id
 ) THEN RAISE EXCEPTION 'Provider voice identity is server managed' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_voice_provider_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER voice_z_provider_identity BEFORE INSERT OR UPDATE OF user_id,household_id,elevenlabs_voice_id ON public.voice_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_voice_provider_identity();
CREATE FUNCTION public.current_household_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p.household_id FROM public.profiles p
 JOIN public.households h ON h.id=p.household_id AND h.owner_user_id=p.id
 JOIN public.household_memberships m ON m.household_id=h.id AND m.user_id=p.id
 WHERE p.id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.current_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_household_id() TO anon,authenticated;
-- Provider-ID controls cannot leak a known household voice via a public cast.
CREATE INDEX t08_voice_provider_ref ON public.voice_profiles(elevenlabs_voice_id);
CREATE FUNCTION public.story_voice_reference_allowed(p_story uuid,p_voice text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=p_story AND (
  (NOT s.is_platform_content AND s.user_id=auth.uid() AND s.household_id=public.current_household_id())
  OR (s.is_platform_content AND ((s.is_published AND s.status='published' AND s.deleted_at IS NULL) OR public.has_permission('stories.read') OR public.has_permission('analytics.view')))
 ) AND NOT EXISTS(
  SELECT 1 FROM public.voice_provider_claims v WHERE v.voice_id=p_voice
   AND (s.household_id IS NULL OR v.household_id IS DISTINCT FROM s.household_id)))
$$;
REVOKE ALL ON FUNCTION public.story_voice_reference_allowed(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.story_voice_reference_allowed(uuid,text) TO anon,authenticated;
CREATE FUNCTION public.can_read_story(p_story uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=p_story AND public.story_voice_reference_allowed(s.id,s.narrator_voice_id) AND public.story_voice_reference_allowed(s.id,s.last_voice_id) AND (
  (NOT s.is_platform_content AND s.user_id=auth.uid() AND s.household_id=public.current_household_id())
  OR (s.is_platform_content AND (
   (s.is_published AND s.status='published' AND s.deleted_at IS NULL)
   OR public.has_permission('stories.read') OR public.has_permission('analytics.view')
  ))))
$$;
CREATE FUNCTION public.can_write_story(p_story uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=p_story AND (
  (NOT s.is_platform_content AND s.user_id=auth.uid() AND s.household_id=public.current_household_id())
  OR (s.is_platform_content AND public.has_permission('stories.write'))))
$$;
REVOKE ALL ON FUNCTION public.can_read_story(uuid),public.can_write_story(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_story(uuid),public.can_write_story(uuid) TO authenticated;
-- Anonymous needs only the bounded read helper. No grant to has_permission is needed:
-- security-definer executes the permission check, which is false for no auth.uid().
GRANT EXECUTE ON FUNCTION public.can_read_story(uuid) TO anon;
CREATE FUNCTION public.platform_story_staff_read() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.has_permission('stories.read') OR public.has_permission('analytics.view')
$$;
CREATE FUNCTION public.platform_story_staff_write() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.has_permission('stories.write') $$;
REVOKE ALL ON FUNCTION public.platform_story_staff_read(),public.platform_story_staff_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_story_staff_read(),public.platform_story_staff_write() TO anon,authenticated;
CREATE POLICY t08_select ON public.stories AS RESTRICTIVE FOR SELECT TO anon,authenticated USING ((NOT is_platform_content AND user_id=auth.uid() AND household_id=public.current_household_id()) OR (is_platform_content AND ((is_published AND status='published' AND deleted_at IS NULL) OR public.platform_story_staff_read())));
CREATE POLICY t08_insert ON public.stories AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK ((NOT is_platform_content AND user_id=auth.uid() AND household_id=public.current_household_id()) OR (is_platform_content AND public.platform_story_staff_write()));
CREATE POLICY t08_update ON public.stories AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING ((NOT is_platform_content AND user_id=auth.uid() AND household_id=public.current_household_id()) OR (is_platform_content AND public.platform_story_staff_write())) WITH CHECK ((NOT is_platform_content AND user_id=auth.uid() AND household_id=public.current_household_id()) OR (is_platform_content AND public.platform_story_staff_write()));
CREATE POLICY t08_delete ON public.stories AS RESTRICTIVE FOR DELETE TO anon,authenticated USING ((NOT is_platform_content AND user_id=auth.uid() AND household_id=public.current_household_id()) OR (is_platform_content AND public.platform_story_staff_write()));
CREATE POLICY t08_select ON public.story_pages AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.can_read_story(story_id));
CREATE POLICY t08_insert ON public.story_pages AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (public.can_write_story(story_id));
CREATE POLICY t08_update ON public.story_pages AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (public.can_write_story(story_id)) WITH CHECK (public.can_write_story(story_id));
CREATE POLICY t08_delete ON public.story_pages AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (public.can_write_story(story_id));
CREATE POLICY t08_select ON public.story_characters AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.can_read_story(story_id) AND public.story_voice_reference_allowed(story_id,voice_id));
CREATE POLICY t08_insert ON public.story_characters AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (public.can_write_story(story_id));
CREATE POLICY t08_update ON public.story_characters AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (public.can_write_story(story_id)) WITH CHECK (public.can_write_story(story_id));
CREATE POLICY t08_delete ON public.story_characters AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (public.can_write_story(story_id));
CREATE POLICY t08_all ON public.voice_profiles AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid() AND household_id=public.current_household_id()) WITH CHECK (user_id=auth.uid() AND household_id=public.current_household_id());
CREATE POLICY t08_all ON public.family_members AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid() AND household_id=public.current_household_id()) WITH CHECK (user_id=auth.uid() AND household_id=public.current_household_id());
CREATE POLICY t08_all ON public.play_sessions AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.user_behavior AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.reading_streaks AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.story_shares AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.user_favorites AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.downloaded_stories AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.push_subscriptions AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.user_badges AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.user_challenge_progress AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.parental_controls AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.daily_usage AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.notifications AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_all ON public.usage_tracking AS RESTRICTIVE FOR ALL TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY t08_select ON public.story_ratings AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.can_read_story(story_id));
CREATE POLICY t08_insert ON public.story_ratings AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (user_id=auth.uid() AND public.can_read_story(story_id));
CREATE POLICY t08_update ON public.story_ratings AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND public.can_read_story(story_id));
CREATE POLICY t08_delete ON public.story_ratings AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (user_id=auth.uid());
CREATE POLICY t08_select ON public.story_reviews AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.can_read_story(story_id));
CREATE POLICY t08_insert ON public.story_reviews AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (user_id=auth.uid() AND public.can_read_story(story_id));
CREATE POLICY t08_update ON public.story_reviews AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND public.can_read_story(story_id));
CREATE POLICY t08_delete ON public.story_reviews AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (user_id=auth.uid());
CREATE POLICY t08_select ON public.audio_cache AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.story_pages p WHERE p.id=story_page_id AND public.can_read_story(p.story_id)) AND (voice_id IS NULL OR EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.id=voice_id AND v.user_id=auth.uid() AND v.household_id=public.current_household_id())));
CREATE POLICY t08_insert ON public.audio_cache AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS(SELECT 1 FROM public.story_pages p WHERE p.id=story_page_id AND public.can_write_story(p.story_id)) AND (voice_id IS NULL OR EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.id=voice_id AND v.user_id=auth.uid() AND v.household_id=public.current_household_id())));

-- FK existence is not an authorization check. Check parent references on new/changed
-- associations, including service-role writes; derive relation scope from the actor.
CREATE FUNCTION public.guard_household_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid; vh uuid; sh uuid; st uuid; v uuid; actor uuid; platform boolean; refs text[];
BEGIN
 IF TG_TABLE_NAME='stories' THEN
  h:=NEW.household_id; v:=NEW.voice_id; refs:=ARRAY[NEW.narrator_voice_id,NEW.last_voice_id];
  IF TG_OP='UPDATE' THEN refs:=refs || ARRAY(SELECT voice_id FROM public.story_characters WHERE story_id=NEW.id); END IF;
 ELSIF TG_TABLE_NAME='story_characters' THEN
  SELECT household_id INTO STRICT h FROM public.stories WHERE id=NEW.story_id; refs:=ARRAY[NEW.voice_id];
 ELSIF TG_TABLE_NAME='family_members' THEN h:=NEW.household_id; v:=NEW.voice_profile_id;
 ELSIF TG_TABLE_NAME='audio_cache' THEN
  IF NEW.story_page_id IS NULL THEN RAISE EXCEPTION 'Invalid content reference' USING ERRCODE='42501'; END IF;
  SELECT p.household_id INTO h FROM public.story_pages p WHERE id=NEW.story_page_id;
  v:=NEW.voice_id;
 ELSE
  actor:=NEW.user_id;
  SELECT p.household_id INTO STRICT h FROM public.profiles p WHERE p.id=actor;
  st:=NEW.story_id;
  IF TG_TABLE_NAME='play_sessions' THEN v:=NEW.voice_id; END IF;
  IF st IS NOT NULL THEN
   SELECT s.household_id,s.is_platform_content INTO sh,platform FROM public.stories s WHERE s.id=st;
   IF NOT FOUND OR (NOT platform AND sh IS DISTINCT FROM h)
    OR (platform AND NOT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=st AND (
     (s.is_published AND s.status='published' AND s.deleted_at IS NULL)
     OR (actor=auth.uid() AND public.platform_story_staff_read())
    ))) THEN RAISE EXCEPTION 'Invalid content reference' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.voice_provider_claims vp WHERE vp.voice_id=ANY(refs)
  AND (h IS NULL OR vp.household_id IS DISTINCT FROM h)) THEN RAISE EXCEPTION 'Invalid content reference' USING ERRCODE='42501'; END IF;
 IF v IS NOT NULL THEN
  SELECT household_id INTO vh FROM public.voice_profiles WHERE id=v;
  IF NOT FOUND OR h IS NULL OR vh IS DISTINCT FROM h THEN RAISE EXCEPTION 'Invalid content reference' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_household_references() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER t08_story_voice BEFORE INSERT OR UPDATE OF voice_id,user_id,household_id,is_platform_content,narrator_voice_id,last_voice_id ON public.stories FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_character_voice BEFORE INSERT OR UPDATE OF story_id,voice_id ON public.story_characters FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_family_voice BEFORE INSERT OR UPDATE OF voice_profile_id,user_id,household_id ON public.family_members FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_cache_reference BEFORE INSERT OR UPDATE OF story_page_id,voice_id ON public.audio_cache FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id,voice_id ON public.play_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id ON public.user_behavior FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id ON public.story_ratings FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id ON public.story_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id ON public.story_shares FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id ON public.user_favorites FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();
CREATE TRIGGER t08_reference BEFORE INSERT OR UPDATE OF story_id,user_id ON public.downloaded_stories FOR EACH ROW EXECUTE FUNCTION public.guard_household_references();

-- Counters must not be a SECURITY DEFINER back door into a hidden household.
CREATE OR REPLACE FUNCTION public.increment_play_count(p_story_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.can_read_story(p_story_id) THEN RAISE EXCEPTION 'Content unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.stories SET play_count=play_count+1 WHERE id=p_story_id;
END $$;
CREATE OR REPLACE FUNCTION public.toggle_like(p_story_id uuid,p_delta integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_read_story(p_story_id) OR p_delta NOT IN(-1,1) OR p_delta IS NULL THEN RAISE EXCEPTION 'Content unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.stories SET like_count=GREATEST(0,like_count+p_delta) WHERE id=p_story_id;
END $$;
REVOKE ALL ON FUNCTION public.increment_play_count(uuid),public.toggle_like(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_play_count(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_like(uuid,integer) TO authenticated;
-- Legacy XP helper remains an account feature, but cannot target another actor.
CREATE OR REPLACE FUNCTION public.award_xp(p_user_id uuid,p_amount integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id OR NOT public.feature_enabled('gamification')
  OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.profiles SET xp=COALESCE(xp,0)+p_amount,level=GREATEST(1,FLOOR(SQRT((COALESCE(xp,0)+p_amount)::numeric/100))::integer+1) WHERE id=p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.award_xp(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.award_xp(uuid,integer) TO authenticated;

-- Bounded voice authorization: private IDs of another household remain unavailable,
-- including for staff. Unknown catalog audition is only a voices.manage privilege.
CREATE FUNCTION public.authorize_tts_voice(p_voice_id text,p_locale text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manager boolean:=public.has_permission('voices.manage');
BEGIN
 IF auth.uid() IS NULL OR public.current_household_id() IS NULL THEN RETURN 'unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.elevenlabs_voice_id=p_voice_id AND v.user_id=auth.uid() AND v.household_id=public.current_household_id() AND v.is_active) THEN RETURN 'allowed'; END IF;
 IF EXISTS(SELECT 1 FROM public.voice_provider_claims v WHERE v.voice_id=p_voice_id AND v.household_id IS DISTINCT FROM public.current_household_id()) THEN RETURN 'unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.default_voices v WHERE v.voice_id=p_voice_id AND v.language=p_locale AND v.is_active) THEN RETURN 'allowed'; END IF;
 IF manager THEN RETURN 'allowed'; END IF;
 IF EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.elevenlabs_voice_id=p_voice_id AND v.user_id=auth.uid() AND NOT v.is_active)
  OR EXISTS(SELECT 1 FROM public.default_voices v WHERE v.voice_id=p_voice_id AND v.language=p_locale AND NOT v.is_active) THEN RETURN 'disabled'; END IF;
 RETURN 'unavailable';
END $$;
REVOKE ALL ON FUNCTION public.authorize_tts_voice(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_tts_voice(text,text) TO authenticated;

-- Staff policies must not call authenticated-only permission RPCs as anon.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public'
  AND roles=ARRAY['public']::name[] AND (qual LIKE '%has_permission(%' OR with_check LIKE '%has_permission(%')
 LOOP EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated',p.policyname,p.schemaname,p.tablename); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_admin_platform_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE platform boolean; v_story uuid;
BEGIN
 -- Only pure aggregate counter changes are allowed through the checked counter
 -- RPC/ratings trigger. Ordinary platform writes still require MFA + permission;
 -- direct client counter updates are blocked by the new restrictive story RLS.
 IF TG_TABLE_NAME='stories' AND TG_OP='UPDATE' AND
  (to_jsonb(NEW)-ARRAY['updated_at','play_count','like_count','avg_rating','rating_count'])=
  (to_jsonb(OLD)-ARRAY['updated_at','play_count','like_count','avg_rating','rating_count']) THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_TABLE_NAME='stories' THEN
  IF TG_OP='DELETE' THEN platform:=OLD.is_platform_content; ELSIF TG_OP='INSERT' THEN platform:=NEW.is_platform_content; ELSE platform:=OLD.is_platform_content OR NEW.is_platform_content; END IF;
 ELSE
  IF TG_OP='DELETE' THEN v_story:=OLD.story_id; ELSE v_story:=NEW.story_id; END IF;
  SELECT is_platform_content INTO platform FROM public.stories WHERE id=v_story;
  IF TG_OP='UPDATE' AND OLD.story_id IS DISTINCT FROM NEW.story_id THEN platform:=COALESCE(platform,false) OR EXISTS(SELECT 1 FROM public.stories WHERE id=OLD.story_id AND is_platform_content); END IF;
 END IF;
 IF platform AND NOT public.has_permission('stories.write') THEN RAISE EXCEPTION 'Không có quyền ghi truyện nền tảng: phiên chưa xác thực hoặc đã hết hạn' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

-- Refuse unsafe legacy cast associations, never silently publish/rehome/delete them.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.stories s JOIN public.voice_profiles v ON v.elevenlabs_voice_id IN(s.narrator_voice_id,s.last_voice_id)
  WHERE s.household_id IS NULL OR s.household_id IS DISTINCT FROM v.household_id)
  OR EXISTS(SELECT 1 FROM public.story_characters c JOIN public.stories s ON s.id=c.story_id JOIN public.voice_profiles v ON v.elevenlabs_voice_id=c.voice_id
   WHERE s.household_id IS NULL OR s.household_id IS DISTINCT FROM v.household_id)
 THEN RAISE EXCEPTION 'Unsafe legacy voice associations require a separate reviewed repair' USING ERRCODE='42501'; END IF;
END $$;

-- Known household clones cannot be exported as public default-voice metadata.
CREATE FUNCTION public.guard_public_voice_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.voice_provider_claims WHERE voice_id=NEW.voice_id) THEN RAISE EXCEPTION 'Invalid content reference' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_public_voice_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER t08_public_voice BEFORE INSERT OR UPDATE OF voice_id ON public.default_voices FOR EACH ROW EXECUTE FUNCTION public.guard_public_voice_reference();
CREATE FUNCTION public.allowed_catalog_voice_ids(p_voice_ids text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.has_permission('voices.manage') THEN RAISE EXCEPTION 'Catalog unavailable' USING ERRCODE='42501'; END IF;
 IF cardinality(p_voice_ids)>1000 OR p_voice_ids IS NULL OR EXISTS(SELECT 1 FROM unnest(p_voice_ids) x WHERE x IS NULL OR char_length(x) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'Invalid catalog request' USING ERRCODE='22023'; END IF;
 RETURN ARRAY(SELECT DISTINCT x FROM unnest(p_voice_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.voice_provider_claims v WHERE v.voice_id=x AND v.household_id IS DISTINCT FROM public.current_household_id()));
END $$;
REVOKE ALL ON FUNCTION public.allowed_catalog_voice_ids(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.allowed_catalog_voice_ids(text[]) TO authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.default_voices d JOIN public.voice_profiles v ON v.elevenlabs_voice_id=d.voice_id) THEN RAISE EXCEPTION 'Unsafe legacy public voice association requires review' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION public.voice_provider_claims_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.voice_provider_claims_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_provider_claims_ready() TO service_role;
