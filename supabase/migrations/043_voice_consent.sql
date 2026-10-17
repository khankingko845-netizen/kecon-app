-- T12 — Spoken voice consent before cloning; withdrawal deletes the voice (docs/voice-consent.md).
-- 1) A versioned voice-consent text (consent_documents kind 'voice_clone') ends with the sentence
--    the contributor reads aloud. 2) voice_consents: one row per spoken consent — the recording
--    (private bucket voice-consents, SHA-256), time, text version + hash, speaker, parent proof —
--    stored BEFORE the clone call. /api/voice/clone needs a fresh unused consent of the caller's
--    household (voice_consent_ready) and binds the new provider voice to it (voice_consent_bind);
--    a family voice profile with a provider voice needs a bound, active consent.
-- 3) Withdrawal (or deleting a voice / the account) stops the voice at once (authorize_tts_voice)
--    and queues a deletion job: ElevenLabs voice, sample + consent recordings and the narration
--    cache rendered with that voice. Workers: the withdraw route right away, then
--    kecon-voice-deletion.timer every 15 minutes; every job is due well inside 24 hours.
-- Additive. Legacy family voices (cloned before T12) keep their rows but need a consent to speak.

-- 1) Voice-consent documents share the T11 versioned, immutable, hashed documents.
ALTER TABLE public.consent_documents DROP CONSTRAINT consent_documents_kind_check;
ALTER TABLE public.consent_documents ADD CONSTRAINT consent_documents_kind_check CHECK (kind IN ('parent_policy','voice_clone'));
ALTER TABLE public.consent_documents ADD COLUMN spoken_text text
 CHECK (spoken_text IS NULL OR (char_length(spoken_text) BETWEEN 20 AND 400 AND position('{ten}' IN spoken_text) > 0));
ALTER TABLE public.consent_documents ADD CONSTRAINT consent_documents_spoken CHECK ((kind = 'voice_clone') = (spoken_text IS NOT NULL));
COMMENT ON COLUMN public.consent_documents.spoken_text IS 'voice_clone: the sentence read aloud; {ten} = the speaker''s name. Part of body_sha256.';
CREATE OR REPLACE FUNCTION public.consent_documents_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,extensions AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  -- What the reader sees: title + summary + full text (+ the sentence read aloud), UTF-8.
  -- Documents without a spoken sentence (parent_policy) keep the T11 hash.
  NEW.body_sha256 := encode(digest(convert_to(NEW.title || E'\n\n' || NEW.summary || E'\n\n' || NEW.body
    || coalesce(E'\n\n' || NEW.spoken_text, ''), 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Consent documents are immutable: publish a new version' USING ERRCODE = '42501';
END $$;
-- A voice consent is spoken by the contributor, never a click: T11 consent rows stay parent_policy.
ALTER TABLE public.consents ADD CONSTRAINT consents_parent_policy_only CHECK (kind = 'parent_policy');

-- 2) Spoken consents. Evidence is append-only: audio is attached once, a provider voice is bound
--    once, withdrawal and audio deletion are stamped once.
CREATE TABLE public.voice_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 document_id uuid NOT NULL REFERENCES public.consent_documents(id),
 version integer NOT NULL,
 locale text NOT NULL,
 body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
 speaker_name text NOT NULL CHECK (char_length(speaker_name) BETWEEN 1 AND 60),
 spoken_text text NOT NULL CHECK (char_length(spoken_text) BETWEEN 20 AND 500),
 method text NOT NULL DEFAULT 'spoken_in_app' CHECK (method IN ('spoken_in_app')),
 parent_method text NOT NULL CHECK (parent_method IN ('parent_pin','account_holder')),
 audio_sha256 text NOT NULL CHECK (audio_sha256 ~ '^[0-9a-f]{64}$'),
 audio_bytes integer NOT NULL CHECK (audio_bytes BETWEEN 1 AND 5242880),
 audio_mime text NOT NULL CHECK (audio_mime IN ('audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav')),
 duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 2000 AND 60000),
 user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 audio_path text CHECK (audio_path IS NULL OR audio_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|mp4|ogg|mp3|wav)$'),
 audio_stored_at timestamptz,
 provider text CHECK (provider IS NULL OR provider = 'elevenlabs'),
 provider_voice_id text UNIQUE CHECK (provider_voice_id IS NULL OR char_length(provider_voice_id) BETWEEN 1 AND 120),
 bound_at timestamptz,
 withdrawn_at timestamptz,
 withdraw_reason text CHECK (withdraw_reason IS NULL OR withdraw_reason IN ('withdrawn','voice_deleted','account_deleted','expired')),
 withdrawn_by uuid,
 audio_deleted_at timestamptz,
 CHECK ((audio_path IS NULL) = (audio_stored_at IS NULL)),
 CHECK ((provider_voice_id IS NULL) = (bound_at IS NULL) AND (provider_voice_id IS NULL) = (provider IS NULL)),
 CHECK ((withdrawn_at IS NULL) = (withdraw_reason IS NULL)),
 CHECK (withdrawn_at IS NULL OR withdrawn_at >= recorded_at),
 CHECK (audio_deleted_at IS NULL OR withdrawn_at IS NOT NULL)
);
CREATE INDEX voice_consents_household ON public.voice_consents(household_id, recorded_at DESC);
COMMENT ON TABLE public.voice_consents IS 'T12: spoken consent of the voice contributor, recorded before cloning (docs/voice-consent.md).';
CREATE FUNCTION public.voice_consents_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (NEW.id, NEW.household_id, NEW.recorded_by, NEW.document_id, NEW.version, NEW.locale, NEW.body_sha256, NEW.speaker_name,
     NEW.spoken_text, NEW.method, NEW.parent_method, NEW.audio_sha256, NEW.audio_bytes, NEW.audio_mime, NEW.duration_ms,
     NEW.user_agent, NEW.recorded_at)
    IS DISTINCT FROM (OLD.id, OLD.household_id, OLD.recorded_by, OLD.document_id, OLD.version, OLD.locale, OLD.body_sha256, OLD.speaker_name,
     OLD.spoken_text, OLD.method, OLD.parent_method, OLD.audio_sha256, OLD.audio_bytes, OLD.audio_mime, OLD.duration_ms,
     OLD.user_agent, OLD.recorded_at)
  OR (OLD.audio_path IS NOT NULL AND (NEW.audio_path, NEW.audio_stored_at) IS DISTINCT FROM (OLD.audio_path, OLD.audio_stored_at))
  OR (OLD.provider_voice_id IS NOT NULL AND (NEW.provider, NEW.provider_voice_id, NEW.bound_at) IS DISTINCT FROM (OLD.provider, OLD.provider_voice_id, OLD.bound_at))
  OR (OLD.withdrawn_at IS NOT NULL AND OLD.provider_voice_id IS NULL AND NEW.provider_voice_id IS NOT NULL)
  OR (OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at, NEW.withdraw_reason, NEW.withdrawn_by) IS DISTINCT FROM (OLD.withdrawn_at, OLD.withdraw_reason, OLD.withdrawn_by))
  OR (OLD.audio_deleted_at IS NOT NULL AND NEW.audio_deleted_at IS DISTINCT FROM OLD.audio_deleted_at)
 THEN RAISE EXCEPTION 'Voice consent records are append-only' USING ERRCODE = '42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER voice_consents_guard BEFORE UPDATE ON public.voice_consents FOR EACH ROW EXECUTE FUNCTION public.voice_consents_guard();
ALTER TABLE public.voice_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.voice_consents TO authenticated;
GRANT ALL ON public.voice_consents TO service_role;
CREATE POLICY voice_consents_household ON public.voice_consents FOR SELECT TO authenticated
 USING (household_id = public.current_household_id());
-- Consent recordings: private, written and signed only by the server (service role).
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-consents', 'voice-consents', false, 5242880, ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
 allowed_mime_types = ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'];

-- 3) Deletion jobs. No foreign keys: a job outlives the account / household it cleans up.
CREATE TABLE public.voice_deletion_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid,
 user_ids uuid[] NOT NULL DEFAULT '{}',
 consent_id uuid,
 provider text NOT NULL DEFAULT 'elevenlabs' CHECK (provider = 'elevenlabs'),
 provider_voice_id text UNIQUE CHECK (provider_voice_id IS NULL OR char_length(provider_voice_id) BETWEEN 1 AND 120),
 reason text NOT NULL CHECK (reason IN ('withdrawn','voice_deleted','account_deleted','clone_unbound','expired')),
 storage_paths jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(storage_paths) = 'array'),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done')),
 attempts integer NOT NULL DEFAULT 0,
 provider_result text CHECK (provider_result IS NULL OR provider_result IN ('deleted','already_gone','not_found')),
 provider_done_at timestamptz,
 provider_history_removed integer NOT NULL DEFAULT 0,
 pages_cleared integer NOT NULL DEFAULT 0,
 files_removed integer NOT NULL DEFAULT 0,
 removed_cache jsonb NOT NULL DEFAULT '[]'::jsonb,
 last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 due_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 swept_at timestamptz,
 deadline_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
 done_at timestamptz,
 CHECK ((status = 'done') = (done_at IS NOT NULL)),
 CHECK ((provider_result IS NULL) = (provider_done_at IS NULL))
);
CREATE INDEX voice_deletion_jobs_due ON public.voice_deletion_jobs(status, due_at);
CREATE INDEX voice_deletion_jobs_household ON public.voice_deletion_jobs(household_id);
CREATE INDEX voice_deletion_jobs_consent ON public.voice_deletion_jobs(consent_id);
COMMENT ON TABLE public.voice_deletion_jobs IS 'T12: delete a family voice at the provider + its recordings + narration cache within 24 hours.';
ALTER TABLE public.voice_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_deletion_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voice_deletion_jobs TO service_role;

-- Queue (or extend) the job of a voice / consent. Re-opens a finished job when there is new work.
CREATE FUNCTION public._voice_deletion_enqueue(p_household uuid, p_user uuid, p_consent uuid, p_voice text, p_paths jsonb, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.voice_deletion_jobs%ROWTYPE; v_paths jsonb := coalesce(p_paths, '[]'::jsonb); v_more boolean;
BEGIN
 IF p_voice IS NOT NULL THEN
  SELECT * INTO j FROM public.voice_deletion_jobs WHERE provider_voice_id = p_voice FOR UPDATE;
 END IF;
 IF j.id IS NULL AND p_consent IS NOT NULL THEN
  SELECT * INTO j FROM public.voice_deletion_jobs WHERE consent_id = p_consent
   AND (p_voice IS NULL OR provider_voice_id IS NULL) ORDER BY created_at LIMIT 1 FOR UPDATE;
 END IF;
 IF j.id IS NULL THEN
  INSERT INTO public.voice_deletion_jobs(household_id, user_ids, consent_id, provider_voice_id, reason, storage_paths)
   VALUES (p_household, CASE WHEN p_user IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_user] END, p_consent, p_voice, p_reason,
    (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(v_paths) x))
   RETURNING * INTO j;
  RETURN j.id;
 END IF;
 v_more := (p_voice IS NOT NULL AND j.provider_voice_id IS NULL)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_paths) x WHERE NOT (j.storage_paths @> jsonb_build_array(x)));
 UPDATE public.voice_deletion_jobs SET
   household_id = coalesce(household_id, p_household),
   user_ids = CASE WHEN p_user IS NULL OR p_user = ANY(user_ids) THEN user_ids ELSE user_ids || p_user END,
   consent_id = coalesce(consent_id, p_consent),
   provider_voice_id = coalesce(provider_voice_id, p_voice),
   storage_paths = (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(storage_paths || v_paths) x),
   status = CASE WHEN v_more AND status = 'done' THEN 'pending' ELSE status END,
   done_at = CASE WHEN v_more AND status = 'done' THEN NULL ELSE done_at END,
   due_at = CASE WHEN v_more THEN least(due_at, now()) ELSE due_at END,
   deadline_at = CASE WHEN v_more AND status = 'done' THEN now() + interval '24 hours' ELSE deadline_at END,
   updated_at = now()
  WHERE id = j.id;
 RETURN j.id;
END $$;

-- 4) Family voice profiles: a provider voice needs a bound, active consent of the household.
--    Renames / on-off toggles of legacy rows keep working (the voice ID does not change).
CREATE FUNCTION public.guard_voice_profile_consent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.elevenlabs_voice_id IS NULL OR NEW.elevenlabs_voice_id = '' THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.elevenlabs_voice_id IS NOT DISTINCT FROM OLD.elevenlabs_voice_id
    AND NEW.household_id IS NOT DISTINCT FROM OLD.household_id THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.voice_consents c WHERE c.provider_voice_id = NEW.elevenlabs_voice_id
    AND c.household_id = NEW.household_id AND c.withdrawn_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.voice_deletion_jobs j WHERE j.provider_voice_id = NEW.elevenlabs_voice_id) THEN
  RAISE EXCEPTION 'Voice consent required' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
-- After voice_household_bind (household known), before voice_z_provider_identity.
CREATE TRIGGER voice_z_consent BEFORE INSERT OR UPDATE OF elevenlabs_voice_id, household_id ON public.voice_profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_voice_profile_consent();
-- Listening history keeps the listen, not the deleted voice (play_sessions.voice_id had no ON DELETE
-- action, so a used family voice could not be deleted). During an account deletion the rows go anyway.
CREATE FUNCTION public.voice_profile_before_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
  FOR r IN SELECT id FROM public.play_sessions WHERE voice_id = OLD.id LOOP
   BEGIN
    UPDATE public.play_sessions SET voice_id = NULL WHERE id = r.id;
   EXCEPTION WHEN others THEN
    DELETE FROM public.play_sessions WHERE id = r.id;
   END;
  END LOOP;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER voice_profiles_before_delete BEFORE DELETE ON public.voice_profiles
 FOR EACH ROW EXECUTE FUNCTION public.voice_profile_before_delete();
-- Deleting a voice (Giọng đọc, "Xoá toàn bộ dữ liệu", account deletion) withdraws its consent and
-- queues the provider voice + sample + consent recording for deletion.
CREATE FUNCTION public.voice_profile_after_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v text := nullif(OLD.elevenlabs_voice_id, ''); c public.voice_consents%ROWTYPE; paths jsonb := '[]'::jsonb;
 gone boolean := NOT EXISTS(SELECT 1 FROM public.profiles WHERE id = OLD.user_id);
BEGIN
 IF OLD.sample_audio_url ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' THEN
  paths := jsonb_build_array(jsonb_build_object('bucket', 'recordings', 'name', OLD.sample_audio_url));
 END IF;
 -- Another profile still speaking with this voice keeps it (only this sample goes).
 IF v IS NOT NULL AND EXISTS(SELECT 1 FROM public.voice_profiles WHERE elevenlabs_voice_id = v) THEN v := NULL; END IF;
 IF v IS NOT NULL THEN
  SELECT * INTO c FROM public.voice_consents WHERE provider_voice_id = v;
  IF c.id IS NOT NULL THEN
   IF c.withdrawn_at IS NULL THEN
    UPDATE public.voice_consents SET withdrawn_at = greatest(now(), recorded_at),
      withdraw_reason = CASE WHEN gone THEN 'account_deleted' ELSE 'voice_deleted' END, withdrawn_by = auth.uid()
     WHERE id = c.id;
   END IF;
   IF c.audio_path IS NOT NULL AND c.audio_deleted_at IS NULL THEN
    paths := paths || jsonb_build_array(jsonb_build_object('bucket', 'voice-consents', 'name', c.audio_path));
   END IF;
  END IF;
 END IF;
 IF v IS NULL AND paths = '[]'::jsonb THEN RETURN NULL; END IF;
 PERFORM public._voice_deletion_enqueue(OLD.household_id, OLD.user_id, c.id, v, paths,
  CASE WHEN gone THEN 'account_deleted' ELSE 'voice_deleted' END);
 RETURN NULL;
END $$;
CREATE TRIGGER voice_profiles_deletion AFTER DELETE ON public.voice_profiles
 FOR EACH ROW EXECUTE FUNCTION public.voice_profile_after_delete();
-- Consent rows disappear only with the household / account: their voice + recording go too.
CREATE FUNCTION public.voice_consent_after_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE paths jsonb := '[]'::jsonb;
BEGIN
 IF OLD.audio_path IS NOT NULL AND OLD.audio_deleted_at IS NULL THEN
  paths := jsonb_build_array(jsonb_build_object('bucket', 'voice-consents', 'name', OLD.audio_path));
 END IF;
 IF OLD.provider_voice_id IS NULL AND paths = '[]'::jsonb THEN RETURN NULL; END IF;
 PERFORM public._voice_deletion_enqueue(OLD.household_id, OLD.recorded_by, OLD.id, OLD.provider_voice_id, paths, 'account_deleted');
 RETURN NULL;
END $$;
CREATE TRIGGER voice_consents_deletion AFTER DELETE ON public.voice_consents
 FOR EACH ROW EXECUTE FUNCTION public.voice_consent_after_delete();

-- 5) Which voices rendered a page's saved narration. Only save_page_audio may say so; audio
--    written any other way (older app, copies, scripts) is "unknown" and is cleared conservatively
--    when a voice of the household is withdrawn.
ALTER TABLE public.story_pages ADD COLUMN audio_voice_ids text[]
 CHECK (audio_voice_ids IS NULL OR cardinality(audio_voice_ids) <= 20);
COMMENT ON COLUMN public.story_pages.audio_voice_ids IS 'T12: provider voice IDs in audio_url (save_page_audio); NULL = unknown.';
CREATE FUNCTION public.story_pages_audio_voices() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.audio_url IS NULL THEN
  NEW.audio_voice_ids := NULL;
 ELSIF coalesce(current_setting('kecon.page_audio_voices', true), '') <> 'trusted'
   AND (TG_OP = 'INSERT' OR NEW.audio_url IS DISTINCT FROM OLD.audio_url OR NEW.audio_voice_ids IS DISTINCT FROM OLD.audio_voice_ids) THEN
  NEW.audio_voice_ids := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER story_pages_audio_voices BEFORE INSERT OR UPDATE OF audio_url, audio_voice_ids ON public.story_pages
 FOR EACH ROW EXECUTE FUNCTION public.story_pages_audio_voices();
-- True when one of the voices was withdrawn / deleted (opaque provider IDs the caller already holds).
CREATE FUNCTION public.voice_ids_revoked(p_voice_ids text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.voice_deletion_jobs j WHERE j.provider_voice_id = ANY(p_voice_ids))
$$;
-- Player / mini player / editor save narration through this (RLS of the caller applies).
CREATE FUNCTION public.save_page_audio(p_page uuid, p_url text, p_duration integer DEFAULT 0, p_key text DEFAULT NULL,
 p_voice_ids text[] DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_ids text[]; n integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
 IF p_url IS NULL OR char_length(p_url) NOT BETWEEN 1 AND 2000 OR (p_key IS NOT NULL AND char_length(p_key) > 200) THEN
  RAISE EXCEPTION 'Invalid page audio' USING ERRCODE = '22023';
 END IF;
 IF p_voice_ids IS NOT NULL THEN
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_voice_ids) x WHERE x IS NOT NULL AND char_length(x) BETWEEN 1 AND 120 ORDER BY x);
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) > 20 THEN RAISE EXCEPTION 'Invalid page audio' USING ERRCODE = '22023'; END IF;
  IF public.voice_ids_revoked(v_ids) THEN RAISE EXCEPTION 'Voice withdrawn' USING ERRCODE = '42501'; END IF;
 END IF;
 PERFORM set_config('kecon.page_audio_voices', 'trusted', true);
 UPDATE public.story_pages SET audio_url = p_url, audio_duration = greatest(0, least(coalesce(p_duration, 0), 36000)),
   audio_key = p_key, audio_voice_ids = v_ids
  WHERE id = p_page;
 GET DIAGNOSTICS n = ROW_COUNT;
 PERFORM set_config('kecon.page_audio_voices', '', true);
 RETURN n = 1;
END $$;

-- 6) TTS authorization (031): a withdrawn / deleted family voice never speaks again, staff included;
--    the household's own voice needs an active consent ('consent_required' for legacy clones).
CREATE OR REPLACE FUNCTION public.authorize_tts_voice(p_voice_id text,p_locale text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manager boolean:=public.has_permission('voices.manage'); h uuid:=public.current_household_id();
BEGIN
 IF auth.uid() IS NULL OR h IS NULL THEN RETURN 'unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.voice_deletion_jobs j WHERE j.provider_voice_id=p_voice_id) THEN RETURN 'unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.elevenlabs_voice_id=p_voice_id AND v.user_id=auth.uid() AND v.household_id=h AND v.is_active) THEN
  IF EXISTS(SELECT 1 FROM public.voice_consents c WHERE c.provider_voice_id=p_voice_id AND c.household_id=h AND c.withdrawn_at IS NULL) THEN RETURN 'allowed'; END IF;
  RETURN 'consent_required';
 END IF;
 IF EXISTS(SELECT 1 FROM public.voice_provider_claims v WHERE v.voice_id=p_voice_id AND v.household_id IS DISTINCT FROM h) THEN RETURN 'unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.default_voices v WHERE v.voice_id=p_voice_id AND v.language=p_locale AND v.is_active) THEN RETURN 'allowed'; END IF;
 IF manager THEN RETURN 'allowed'; END IF;
 IF EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.elevenlabs_voice_id=p_voice_id AND v.user_id=auth.uid() AND NOT v.is_active)
  OR EXISTS(SELECT 1 FROM public.default_voices v WHERE v.voice_id=p_voice_id AND v.language=p_locale AND NOT v.is_active) THEN RETURN 'disabled'; END IF;
 RETURN 'unavailable';
END $$;
-- A deleted family voice cannot be published as a default voice or offered in the staff catalogue.
CREATE OR REPLACE FUNCTION public.guard_public_voice_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.voice_provider_claims WHERE voice_id=NEW.voice_id)
  OR EXISTS(SELECT 1 FROM public.voice_deletion_jobs WHERE provider_voice_id=NEW.voice_id)
  OR EXISTS(SELECT 1 FROM public.voice_consents WHERE provider_voice_id=NEW.voice_id)
 THEN RAISE EXCEPTION 'Invalid content reference' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.allowed_catalog_voice_ids(p_voice_ids text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.has_permission('voices.manage') THEN RAISE EXCEPTION 'Catalog unavailable' USING ERRCODE='42501'; END IF;
 IF cardinality(p_voice_ids)>1000 OR p_voice_ids IS NULL OR EXISTS(SELECT 1 FROM unnest(p_voice_ids) x WHERE x IS NULL OR char_length(x) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'Invalid catalog request' USING ERRCODE='22023'; END IF;
 RETURN ARRAY(SELECT DISTINCT x FROM unnest(p_voice_ids) x
  WHERE NOT EXISTS(SELECT 1 FROM public.voice_provider_claims v WHERE v.voice_id=x AND v.household_id IS DISTINCT FROM public.current_household_id())
    AND NOT EXISTS(SELECT 1 FROM public.voice_deletion_jobs j WHERE j.provider_voice_id=x));
END $$;

-- 7) Client API.
-- Current voice-consent text (+ the sentence to read aloud).
CREATE FUNCTION public.voice_consent_document(p_locale text DEFAULT 'vi') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.consent_documents%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.consent_documents WHERE id = public._consent_current_document('voice_clone', p_locale);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_document'); END IF;
 RETURN jsonb_build_object('ok', true, 'document', jsonb_build_object('id', d.id, 'version', d.version, 'locale', d.locale,
  'title', d.title, 'summary', d.summary, 'body', d.body, 'spoken_text', d.spoken_text, 'body_sha256', d.body_sha256,
  'published_at', d.published_at));
END $$;
-- Step 1 of recording a consent (the API route, with the caller's session): checks the parent
-- policy consent, the exact text version + hash and the parent proof, then creates the record.
-- The route uploads the audio with the service role and attaches it (voice_consent_attach_audio).
CREATE FUNCTION public.voice_consent_begin(p_document uuid, p_body_sha256 text, p_speaker text, p_audio_sha256 text,
 p_audio_bytes integer, p_audio_mime text, p_duration_ms integer, p_proof text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_uid uuid := auth.uid(); h uuid := public.current_household_id(); d public.consent_documents%ROWTYPE;
 v_name text := btrim(regexp_replace(coalesce(p_speaker, ''), '\s+', ' ', 'g')); v_method text := 'account_holder';
 v_ext text; v_row public.voice_consents%ROWTYPE;
BEGIN
 IF v_uid IS NULL OR h IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 IF NOT public._consent_active(v_uid, 'parent_policy') THEN RETURN jsonb_build_object('ok', false, 'reason', 'policy_required'); END IF;
 SELECT * INTO d FROM public.consent_documents WHERE id = p_document AND kind = 'voice_clone' AND published_at <= now();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
 IF d.version IS DISTINCT FROM public._consent_current_version('voice_clone') OR p_body_sha256 IS DISTINCT FROM d.body_sha256 THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'current_version', public._consent_current_version('voice_clone'));
 END IF;
 IF char_length(v_name) NOT BETWEEN 1 AND 60 OR v_name ~ '[[:cntrl:]{}<>]' THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'invalid_speaker');
 END IF;
 v_ext := CASE p_audio_mime WHEN 'audio/webm' THEN 'webm' WHEN 'audio/mp4' THEN 'mp4' WHEN 'audio/ogg' THEN 'ogg'
  WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/wav' THEN 'wav' END;
 IF v_ext IS NULL OR p_audio_sha256 IS NULL OR p_audio_sha256 !~ '^[0-9a-f]{64}$' OR p_audio_bytes IS NULL
  OR p_audio_bytes NOT BETWEEN 1 AND 5242880 OR p_duration_ms IS NULL OR p_duration_ms NOT BETWEEN 2000 AND 60000 THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'invalid_audio');
 END IF;
 IF public._consent_has_pin(v_uid) THEN
  IF public.parent_gate_check(p_proof) IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'parent_proof_required'); END IF;
  v_method := 'parent_pin';
 END IF;
 IF (SELECT count(*) FROM public.voice_consents c WHERE c.household_id = h AND c.recorded_at > now() - interval '1 day') >= 20 THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
 END IF;
 INSERT INTO public.voice_consents(household_id, recorded_by, document_id, version, locale, body_sha256, speaker_name, spoken_text,
   parent_method, audio_sha256, audio_bytes, audio_mime, duration_ms, user_agent)
  VALUES (h, v_uid, d.id, d.version, d.locale, d.body_sha256, v_name, replace(d.spoken_text, '{ten}', v_name),
   v_method, p_audio_sha256, p_audio_bytes, p_audio_mime, p_duration_ms, left(nullif(btrim(p_user_agent), ''), 300))
  RETURNING * INTO v_row;
 RETURN jsonb_build_object('ok', true, 'consent_id', v_row.id, 'household_id', h,
  'audio_path', h::text || '/' || v_row.id::text || '.' || v_ext, 'recorded_at', v_row.recorded_at,
  'version', v_row.version, 'spoken_text', v_row.spoken_text, 'parent_method', v_row.parent_method);
END $$;
-- Clone gate: a recorded (audio stored), unused, unwithdrawn consent of the household, for the
-- current text version, recorded in the last 24 hours. Checked before quota and before the provider.
CREATE FUNCTION public.voice_consent_ready(p_consent uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); h uuid := public.current_household_id(); c public.voice_consents%ROWTYPE;
BEGIN
 IF v_uid IS NULL OR h IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 IF NOT public._consent_active(v_uid, 'parent_policy') THEN RETURN jsonb_build_object('ok', false, 'reason', 'policy_required'); END IF;
 IF p_consent IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'missing'); END IF;
 SELECT * INTO c FROM public.voice_consents WHERE id = p_consent AND household_id = h;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
 IF c.withdrawn_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'withdrawn'); END IF;
 IF c.provider_voice_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'used'); END IF;
 IF c.audio_path IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_audio'); END IF;
 IF c.version IS DISTINCT FROM public._consent_current_version('voice_clone') THEN RETURN jsonb_build_object('ok', false, 'reason', 'stale'); END IF;
 IF c.recorded_at < now() - interval '24 hours' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
 RETURN jsonb_build_object('ok', true, 'consent_id', c.id, 'household_id', h, 'speaker_name', c.speaker_name, 'version', c.version,
  'recorded_at', c.recorded_at);
END $$;
-- Withdraw a consent (and delete its voice) — by consent or by voice profile (legacy voices
-- without a consent are deleted the same way). Parent PIN accounts prove the PIN.
CREATE FUNCTION public.voice_consent_withdraw(p_consent uuid DEFAULT NULL, p_profile uuid DEFAULT NULL, p_proof text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_uid uuid := auth.uid(); h uuid := public.current_household_id(); c public.voice_consents%ROWTYPE;
 p public.voice_profiles%ROWTYPE; v_voice text; v_paths jsonb := '[]'::jsonb; n integer := 0; v_was_open boolean := false;
BEGIN
 IF v_uid IS NULL OR h IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 IF p_consent IS NULL AND p_profile IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'missing'); END IF;
 IF public._consent_has_pin(v_uid) AND public.parent_gate_check(p_proof) IS NULL THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'parent_proof_required');
 END IF;
 IF p_profile IS NOT NULL THEN
  SELECT * INTO p FROM public.voice_profiles WHERE id = p_profile AND household_id = h;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_voice := nullif(p.elevenlabs_voice_id, '');
 END IF;
 IF p_consent IS NOT NULL THEN
  SELECT * INTO c FROM public.voice_consents WHERE id = p_consent AND household_id = h FOR UPDATE;
  IF NOT FOUND OR (v_voice IS NOT NULL AND c.provider_voice_id IS DISTINCT FROM v_voice) THEN
   RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_voice := coalesce(v_voice, c.provider_voice_id);
 ELSIF v_voice IS NOT NULL THEN
  SELECT * INTO c FROM public.voice_consents WHERE provider_voice_id = v_voice AND household_id = h FOR UPDATE;
 END IF;
 IF c.id IS NOT NULL AND c.withdrawn_at IS NULL THEN
  v_was_open := true;
  UPDATE public.voice_consents SET withdrawn_at = greatest(now(), recorded_at), withdraw_reason = 'withdrawn', withdrawn_by = v_uid
   WHERE id = c.id;
 END IF;
 IF c.id IS NOT NULL AND c.audio_path IS NOT NULL AND c.audio_deleted_at IS NULL THEN
  v_paths := jsonb_build_array(jsonb_build_object('bucket', 'voice-consents', 'name', c.audio_path));
 END IF;
 IF v_voice IS NOT NULL OR v_paths <> '[]'::jsonb THEN
  PERFORM public._voice_deletion_enqueue(h, v_uid, c.id, v_voice, v_paths, 'withdrawn');
 END IF;
 -- Every household profile speaking with the voice (the delete trigger adds their samples).
 DELETE FROM public.voice_profiles WHERE household_id = h
  AND ((v_voice IS NOT NULL AND elevenlabs_voice_id = v_voice) OR id = p_profile);
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN jsonb_build_object('ok', true, 'withdrawn', v_was_open, 'profiles_deleted', n, 'household_id', h,
  'deadline_at', now() + interval '24 hours');
END $$;
-- Bố mẹ › Quyền riêng tư & dữ liệu › Đồng ý giọng nói: the household's consents (newest first)
-- and its deletion jobs (also those of voices that never had a consent).
CREATE FUNCTION public.voice_consent_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid := public.current_household_id();
BEGIN
 IF auth.uid() IS NULL OR h IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 RETURN jsonb_build_object('ok', true,
  'consents', (SELECT coalesce(jsonb_agg(x.item ORDER BY x.recorded_at DESC), '[]'::jsonb) FROM (
   SELECT c.recorded_at, jsonb_build_object(
    'id', c.id, 'speaker_name', c.speaker_name, 'spoken_text', c.spoken_text, 'version', c.version, 'locale', c.locale,
    'recorded_at', c.recorded_at, 'parent_method', c.parent_method, 'duration_ms', c.duration_ms,
    'audio_available', c.audio_path IS NOT NULL AND c.audio_deleted_at IS NULL,
    'provider_voice_id', c.provider_voice_id, 'bound_at', c.bound_at, 'withdrawn_at', c.withdrawn_at,
    'withdraw_reason', c.withdraw_reason, 'audio_deleted_at', c.audio_deleted_at,
    'state', CASE WHEN c.withdrawn_at IS NOT NULL THEN 'withdrawn' WHEN c.provider_voice_id IS NOT NULL THEN 'active'
      WHEN c.audio_path IS NULL THEN 'incomplete' WHEN c.recorded_at < now() - interval '24 hours' THEN 'expired' ELSE 'ready' END,
    'profiles', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'is_active', v.is_active) ORDER BY v.created_at), '[]'::jsonb)
      FROM public.voice_profiles v WHERE c.provider_voice_id IS NOT NULL AND v.household_id = c.household_id AND v.elevenlabs_voice_id = c.provider_voice_id),
    'deletion_id', (SELECT j.id FROM public.voice_deletion_jobs j
      WHERE j.consent_id = c.id OR (c.provider_voice_id IS NOT NULL AND j.provider_voice_id = c.provider_voice_id)
      ORDER BY (j.provider_voice_id IS NOT NULL) DESC, j.created_at LIMIT 1)) AS item
   FROM public.voice_consents c WHERE c.household_id = h ORDER BY c.recorded_at DESC LIMIT 100) x),
  'deletions', (SELECT coalesce(jsonb_agg(y.item ORDER BY y.created_at DESC), '[]'::jsonb) FROM (
   SELECT j.created_at, jsonb_build_object('id', j.id, 'consent_id', j.consent_id, 'reason', j.reason, 'status', j.status,
    'voice', j.provider_voice_id IS NOT NULL, 'provider_result', j.provider_result, 'provider_done_at', j.provider_done_at,
    'files_left', jsonb_array_length(j.storage_paths), 'files_removed', j.files_removed, 'pages_cleared', j.pages_cleared,
    'created_at', j.created_at, 'deadline_at', j.deadline_at, 'done_at', j.done_at,
    'overdue', j.status <> 'done' AND j.deadline_at < now()) AS item
   FROM public.voice_deletion_jobs j WHERE j.household_id = h ORDER BY j.created_at DESC LIMIT 50) y));
END $$;
-- Storage path of a consent recording the household may play back (the route signs it).
CREATE FUNCTION public.voice_consent_audio_path(p_consent uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT c.audio_path FROM public.voice_consents c
  WHERE auth.uid() IS NOT NULL AND c.id = p_consent AND c.household_id = public.current_household_id() AND c.audio_deleted_at IS NULL
$$;
-- Narration files removed for this household (last 30 days): devices drop their offline copies.
CREATE FUNCTION public.voice_revoked_audio() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(DISTINCT n.value), '[]'::jsonb)
  FROM public.voice_deletion_jobs j CROSS JOIN LATERAL jsonb_array_elements_text(j.removed_cache) n
  WHERE auth.uid() IS NOT NULL AND j.household_id = public.current_household_id() AND j.updated_at > now() - interval '30 days'
$$;

-- 8) Server API (service role).
CREATE FUNCTION public.voice_consent_attach_audio(p_consent uuid, p_path text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.voice_consents%ROWTYPE; v_expected text;
BEGIN
 SELECT * INTO c FROM public.voice_consents WHERE id = p_consent FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 v_expected := c.household_id::text || '/' || c.id::text || '.' || CASE c.audio_mime WHEN 'audio/webm' THEN 'webm'
  WHEN 'audio/mp4' THEN 'mp4' WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/mpeg' THEN 'mp3' ELSE 'wav' END;
 IF c.audio_path IS NOT NULL OR c.withdrawn_at IS NOT NULL OR p_path IS DISTINCT FROM v_expected THEN RETURN false; END IF;
 UPDATE public.voice_consents SET audio_path = p_path, audio_stored_at = now() WHERE id = c.id;
 RETURN true;
END $$;
-- Upload failed: a record without its recording is not evidence of anything.
CREATE FUNCTION public.voice_consent_discard(p_consent uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM public.voice_consents WHERE id = p_consent AND audio_path IS NULL AND provider_voice_id IS NULL;
 RETURN FOUND;
END $$;
-- After the provider returned the new voice: record the T08 identity receipt and bind the voice to
-- the consent, atomically. A consent withdrawn meanwhile (or not usable) queues the new voice for
-- deletion instead and says so.
CREATE FUNCTION public.voice_consent_bind(p_user uuid, p_consent uuid, p_voice text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h uuid; c public.voice_consents%ROWTYPE; v_reason text; j uuid; v_held boolean;
BEGIN
 IF p_user IS NULL OR p_consent IS NULL OR p_voice IS NULL OR char_length(p_voice) NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'Invalid voice receipt' USING ERRCODE = '22023';
 END IF;
 -- A voice someone already holds is never queued from here (a provider does not hand out an
 -- existing ID; a retried call after a successful bind lands here too).
 v_held := EXISTS(SELECT 1 FROM public.voice_provider_claims WHERE voice_id = p_voice)
  OR EXISTS(SELECT 1 FROM public.voice_consents WHERE provider_voice_id = p_voice);
 SELECT p.household_id INTO h FROM public.profiles p
  JOIN public.household_memberships m ON m.household_id = p.household_id AND m.user_id = p.id WHERE p.id = p_user;
 SELECT * INTO c FROM public.voice_consents WHERE id = p_consent FOR UPDATE;
 v_reason := CASE WHEN c.id IS NULL OR h IS NULL OR c.household_id IS DISTINCT FROM h THEN 'not_found'
  WHEN c.withdrawn_at IS NOT NULL THEN 'withdrawn' WHEN c.provider_voice_id IS NOT NULL THEN 'used'
  WHEN c.audio_path IS NULL THEN 'no_audio' END;
 IF v_reason IS NOT NULL THEN
  IF NOT v_held THEN j := public._voice_deletion_enqueue(coalesce(h, c.household_id), NULL, NULL, p_voice, '[]'::jsonb, 'clone_unbound'); END IF;
  RETURN jsonb_build_object('ok', false, 'reason', v_reason, 'job_id', j);
 END IF;
 BEGIN
  PERFORM public.record_voice_provider_claim(p_user, p_voice);
 EXCEPTION WHEN others THEN
  IF NOT v_held THEN j := public._voice_deletion_enqueue(h, NULL, NULL, p_voice, '[]'::jsonb, 'clone_unbound'); END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'claim_failed', 'job_id', j);
 END;
 UPDATE public.voice_consents SET provider = 'elevenlabs', provider_voice_id = p_voice, bound_at = now() WHERE id = c.id;
 RETURN jsonb_build_object('ok', true, 'consent_id', c.id);
END $$;
-- Unused consents expire for cloning after 24 hours; their recording is deleted after 48 hours.
CREATE FUNCTION public.voice_consent_expire() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.voice_consents%ROWTYPE; n integer := 0;
BEGIN
 FOR r IN SELECT * FROM public.voice_consents WHERE withdrawn_at IS NULL AND provider_voice_id IS NULL
   AND recorded_at < now() - interval '48 hours' ORDER BY recorded_at LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.voice_consents SET withdrawn_at = now(), withdraw_reason = 'expired' WHERE id = r.id;
  IF r.audio_path IS NOT NULL THEN
   PERFORM public._voice_deletion_enqueue(r.household_id, r.recorded_by, r.id, NULL,
    jsonb_build_array(jsonb_build_object('bucket', 'voice-consents', 'name', r.audio_path)), 'expired');
  END IF;
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;
-- Worker: claim due jobs (one household right after a withdrawal, or any).
CREATE FUNCTION public.voice_deletion_claim(p_household uuid DEFAULT NULL, p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_out jsonb := '[]'::jsonb; r public.voice_deletion_jobs%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM public.voice_deletion_jobs j
   WHERE ((j.status = 'pending' AND j.due_at <= now()) OR (j.status = 'running' AND j.claimed_at < now() - interval '15 minutes'))
     AND (p_household IS NULL OR j.household_id = p_household)
   ORDER BY j.due_at LIMIT least(greatest(coalesce(p_limit, 10), 1), 50) FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.voice_deletion_jobs SET status = 'running', claimed_at = now(), attempts = attempts + 1, updated_at = now() WHERE id = r.id;
  v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'provider', r.provider, 'provider_voice_id', r.provider_voice_id,
   'provider_done', r.provider_done_at IS NOT NULL, 'attempts', r.attempts + 1, 'household_id', r.household_id));
 END LOOP;
 RETURN v_out;
END $$;
-- Worker: stop using the voice in saved narration + story casts and list every file to remove:
-- queued recordings, narration rendered with the voice (or unknown voices of the household), and
-- orphan files of the household's accounts older than 1 hour (uploads no page references).
CREATE FUNCTION public.voice_deletion_prepare(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.voice_deletion_jobs%ROWTYPE; v_pages integer := 0; v_names text[] := '{}'; v_orphans text[] := '{}';
 v_samples text[] := '{}'; v_paths jsonb;
BEGIN
 SELECT * INTO j FROM public.voice_deletion_jobs WHERE id = p_job FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF j.provider_voice_id IS NOT NULL THEN
  WITH target AS (
   SELECT p.id, p.audio_url FROM public.story_pages p
    WHERE p.audio_url IS NOT NULL AND (j.provider_voice_id = ANY(p.audio_voice_ids)
     OR (p.audio_voice_ids IS NULL AND j.household_id IS NOT NULL AND p.household_id = j.household_id AND j.reason <> 'clone_unbound'))),
  cleared AS (
   UPDATE public.story_pages p SET audio_url = NULL, audio_key = NULL, audio_duration = 0
    FROM target t WHERE p.id = t.id RETURNING t.audio_url)
  SELECT count(*)::int, coalesce(array_agg(substring(audio_url FROM '/tts-cache/([^?#/]+)')) FILTER (WHERE audio_url ~ '/tts-cache/[^?#/]+'), '{}')
   INTO v_pages, v_names FROM cleared;
  UPDATE public.stories SET narrator_voice_id = NULL, narrator_voice_name = NULL WHERE narrator_voice_id = j.provider_voice_id;
  UPDATE public.stories SET last_voice_id = NULL, last_voice_name = NULL WHERE last_voice_id = j.provider_voice_id;
  UPDATE public.story_characters SET voice_id = NULL, voice_name = NULL WHERE voice_id = j.provider_voice_id;
 END IF;
 IF cardinality(j.user_ids) > 0 THEN
  SELECT coalesce(array_agg(o.name), '{}') INTO v_orphans FROM storage.objects o
   WHERE o.bucket_id = 'tts-cache' AND o.owner = ANY(j.user_ids) AND o.created_at < now() - interval '1 hour'
     AND o.name NOT IN (SELECT substring(p.audio_url FROM '/tts-cache/([^?#/]+)') FROM public.story_pages p
      WHERE p.audio_url ~ '/tts-cache/[^?#/]+');
  SELECT coalesce(array_agg(o.name), '{}') INTO v_samples FROM storage.objects o
   WHERE o.bucket_id = 'recordings' AND split_part(o.name, '/', 1) IN (SELECT u::text FROM unnest(j.user_ids) u)
     AND o.created_at < now() - interval '1 hour'
     AND NOT EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.sample_audio_url = o.name);
 END IF;
 SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) INTO v_paths FROM (
  SELECT e AS x FROM jsonb_array_elements(j.storage_paths) e
  UNION ALL SELECT jsonb_build_object('bucket', 'tts-cache', 'name', n) FROM unnest(v_names || v_orphans) n WHERE n IS NOT NULL
  UNION ALL SELECT jsonb_build_object('bucket', 'recordings', 'name', n) FROM unnest(v_samples) n WHERE n IS NOT NULL) s;
 UPDATE public.voice_deletion_jobs SET storage_paths = v_paths, pages_cleared = pages_cleared + v_pages, swept_at = now(), updated_at = now()
  WHERE id = j.id;
 RETURN jsonb_build_object('storage_paths', v_paths, 'pages_cleared', v_pages);
END $$;
-- Worker: record one attempt. Done = provider voice gone, every file removed and (for a voice) a
-- sweep at least 2 hours after the job started, so narration that was in flight is caught too.
CREATE FUNCTION public.voice_deletion_finish(p_job uuid, p_provider_result text DEFAULT NULL, p_removed jsonb DEFAULT '[]'::jsonb,
 p_error text DEFAULT NULL, p_history_removed integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.voice_deletion_jobs%ROWTYPE; v_removed jsonb := coalesce(p_removed, '[]'::jsonb); v_left jsonb; v_cache jsonb;
 v_n integer; v_done boolean; v_due timestamptz;
BEGIN
 IF p_provider_result IS NOT NULL AND p_provider_result NOT IN ('deleted','already_gone','not_found') THEN
  RAISE EXCEPTION 'Invalid provider result' USING ERRCODE = '22023';
 END IF;
 SELECT * INTO j FROM public.voice_deletion_jobs WHERE id = p_job FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p_provider_result IS NOT NULL AND j.provider_done_at IS NULL AND j.provider_voice_id IS NOT NULL THEN
  j.provider_result := p_provider_result; j.provider_done_at := now();
 END IF;
 SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_left FROM jsonb_array_elements(j.storage_paths) x WHERE NOT (v_removed @> jsonb_build_array(x));
 SELECT count(*)::int INTO v_n FROM jsonb_array_elements(j.storage_paths) x WHERE v_removed @> jsonb_build_array(x);
 SELECT coalesce(jsonb_agg(DISTINCT n), '[]'::jsonb) INTO v_cache FROM (
  SELECT jsonb_array_elements_text(j.removed_cache) n
  UNION SELECT x->>'name' FROM jsonb_array_elements(j.storage_paths) x WHERE x->>'bucket' = 'tts-cache' AND v_removed @> jsonb_build_array(x)) s;
 UPDATE public.voice_consents c SET audio_deleted_at = now()
  WHERE c.audio_deleted_at IS NULL AND c.withdrawn_at IS NOT NULL AND c.audio_path IS NOT NULL
    AND v_removed @> jsonb_build_array(jsonb_build_object('bucket', 'voice-consents', 'name', c.audio_path));
 v_done := p_error IS NULL AND v_left = '[]'::jsonb AND (j.provider_voice_id IS NULL OR j.provider_done_at IS NOT NULL)
  AND (j.provider_voice_id IS NULL OR j.reason = 'clone_unbound' OR j.swept_at >= j.created_at + interval '2 hours');
 v_due := CASE WHEN p_error IS NOT NULL OR v_left <> '[]'::jsonb OR (j.provider_voice_id IS NOT NULL AND j.provider_done_at IS NULL)
  THEN now() + least(interval '1 hour', interval '1 minute' * power(2, least(j.attempts, 10)))
  ELSE greatest(now() + interval '1 minute', j.created_at + interval '2 hours' + interval '1 minute') END;
 UPDATE public.voice_deletion_jobs SET provider_result = j.provider_result, provider_done_at = j.provider_done_at,
   provider_history_removed = provider_history_removed + greatest(0, least(coalesce(p_history_removed, 0), 100000)),
   storage_paths = v_left, files_removed = files_removed + v_n, removed_cache = v_cache,
   last_error = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 500) END,
   status = CASE WHEN v_done THEN 'done' ELSE 'pending' END, done_at = CASE WHEN v_done THEN now() END,
   due_at = CASE WHEN v_done THEN due_at ELSE v_due END, claimed_at = NULL, updated_at = now()
  WHERE id = j.id;
 RETURN jsonb_build_object('status', CASE WHEN v_done THEN 'done' ELSE 'pending' END, 'files_left', jsonb_array_length(v_left),
  'files_removed', v_n, 'provider_result', j.provider_result, 'due_at', CASE WHEN v_done THEN NULL ELSE v_due END);
END $$;
-- Monitoring: jobs past their 24-hour deadline (admin health / the worker log).
CREATE FUNCTION public.voice_deletion_overdue() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT count(*)::int FROM public.voice_deletion_jobs WHERE status <> 'done' AND deadline_at < now()
$$;

REVOKE ALL ON FUNCTION public.voice_consents_guard(), public._voice_deletion_enqueue(uuid, uuid, uuid, text, jsonb, text),
 public.guard_voice_profile_consent(), public.voice_profile_before_delete(), public.voice_profile_after_delete(),
 public.voice_consent_after_delete(), public.story_pages_audio_voices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.voice_consent_document(text), public.voice_consent_begin(uuid, text, text, text, integer, text, integer, text, text),
 public.voice_consent_ready(uuid), public.voice_consent_withdraw(uuid, uuid, text), public.voice_consent_list(),
 public.voice_consent_audio_path(uuid), public.voice_revoked_audio(), public.voice_ids_revoked(text[]),
 public.save_page_audio(uuid, text, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_consent_document(text), public.voice_consent_begin(uuid, text, text, text, integer, text, integer, text, text),
 public.voice_consent_ready(uuid), public.voice_consent_withdraw(uuid, uuid, text), public.voice_consent_list(),
 public.voice_consent_audio_path(uuid), public.voice_revoked_audio(), public.voice_ids_revoked(text[]),
 public.save_page_audio(uuid, text, integer, text, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.voice_consent_attach_audio(uuid, text), public.voice_consent_discard(uuid),
 public.voice_consent_bind(uuid, uuid, text), public.voice_consent_expire(), public.voice_deletion_claim(uuid, integer),
 public.voice_deletion_prepare(uuid), public.voice_deletion_finish(uuid, text, jsonb, text, integer), public.voice_deletion_overdue()
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_consent_attach_audio(uuid, text), public.voice_consent_discard(uuid),
 public.voice_consent_bind(uuid, uuid, text), public.voice_consent_expire(), public.voice_deletion_claim(uuid, integer),
 public.voice_deletion_prepare(uuid), public.voice_deletion_finish(uuid, text, jsonb, text, integer), public.voice_deletion_overdue()
 TO service_role;

-- 9) Version 1 of the voice-consent text (Vietnamese).
INSERT INTO public.consent_documents(kind, version, locale, title, summary, body, spoken_text) VALUES (
 'voice_clone', 1, 'vi', 'Đồng ý cho KểCon dùng giọng nói',
 $kc_summary$- Người góp giọng tự đọc to câu đồng ý. KểCon lưu bản ghi câu đó cùng thời điểm và phiên bản văn bản này trước khi tạo giọng.
- Bản ghi âm mẫu được gửi tới ElevenLabs để tạo một giọng đọc nhân bản, chỉ dùng để kể truyện trong tài khoản của gia đình đã ghi âm.
- Giọng không được chia sẻ cho gia đình khác, không đưa vào thư viện chung, không dùng để quảng cáo.
- Rút đồng ý bất cứ lúc nào trong Bố mẹ › Quyền riêng tư & dữ liệu › Đồng ý giọng nói: giọng ngừng được dùng ngay; giọng ở ElevenLabs, các file ghi âm và audio truyện đọc bằng giọng đó bị xoá trong vòng 24 giờ.$kc_summary$,
 $kc_body$## 1. Văn bản này là gì
Đây là bản 1 của lời đồng ý dùng giọng nói trong KểCon. Người góp giọng (bố, mẹ, ông, bà hoặc người thân) đọc to câu đồng ý ở cuối văn bản, trước khi ghi âm mẫu. Bố mẹ giữ tài khoản xác nhận bằng mã PIN phụ huynh, hoặc câu hỏi dành cho người lớn khi chưa đặt PIN.

## 2. KểCon làm gì với giọng nói
- Ghi âm câu đồng ý: lưu trên máy chủ KểCon trong kho riêng (chỉ gia đình nghe lại được) làm bằng chứng, kèm thời điểm, phiên bản và mã băm của văn bản này, tên người góp giọng và cách bố mẹ xác nhận.
- Ghi âm mẫu (30 giây – 3 phút): gửi tới ElevenLabs, nhà cung cấp giọng nói (máy chủ có thể ở ngoài Việt Nam), để tạo giọng nhân bản. Bản ghi mẫu cũng được lưu trên máy chủ KểCon để gia đình nghe lại.
- Giọng nhân bản nằm trong tài khoản ElevenLabs của KểCon và chỉ dùng để đọc truyện trong tài khoản của gia đình này.
- Audio truyện đọc bằng giọng đó được lưu lại để lần sau phát ngay, không phải tạo lại.

## 3. Những điều KểCon không làm
- Không chia sẻ giọng cho gia đình khác, không đưa vào thư viện truyện chung, không bán, không dùng để quảng cáo.
- Không dùng giọng để đọc nội dung nào ngoài truyện trong app.

## 4. Rút đồng ý
- Bố mẹ rút đồng ý trong Bố mẹ › Quyền riêng tư & dữ liệu › Đồng ý giọng nói, hoặc khi xoá giọng ở mục Giọng đọc. Người góp giọng có thể nhờ bố mẹ làm việc này bất cứ lúc nào.
- Khi rút: giọng ngừng được dùng ngay. Trong vòng 24 giờ KểCon xoá giọng ở ElevenLabs, xoá file ghi âm mẫu và ghi âm câu đồng ý, xoá audio truyện đã đọc bằng giọng đó trên máy chủ. Truyện đã tải về máy được dọn ở lần mở app tiếp theo.
- KểCon chỉ giữ thông tin tối thiểu để chứng minh việc đồng ý và việc xoá: thời điểm đồng ý và rút, phiên bản và mã băm của văn bản, mã băm của bản ghi.
- Dữ liệu đã xoá có thể còn trong bản sao lưu đã mã hoá tối đa khoảng 6 tháng, như chính sách quyền riêng tư cho bố mẹ.
- Lời đồng ý chưa dùng để tạo giọng hết hạn sau 24 giờ; bản ghi của nó bị xoá sau 48 giờ.

## 5. Câu đồng ý cần đọc to
Người góp giọng đọc nguyên văn câu dưới đây, với tên của mình. Nếu người góp giọng không đồng ý, đừng ghi âm.$kc_body$,
 'Tôi là {ten}. Tôi đồng ý để KểCon dùng giọng nói của tôi tạo giọng đọc truyện cho gia đình mình. Tôi biết mình có thể rút lại đồng ý bất cứ lúc nào.');