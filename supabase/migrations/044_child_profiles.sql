-- T10 (expand): child profiles, 1–5 per household, replace profiles.child_name/child_age
-- (docs/child-profiles.md). A child is not an account: only members of the household read
-- or change its profiles (RLS via is_household_member, test with two households). Age comes
-- from the birth year only — no full date of birth is stored. Adding or changing a child's
-- data needs the parent's active policy consent (T11); deleting never does.
-- Contract (separate migration): drop profiles.child_name/child_age once every reader uses
-- child_profiles. From here on the signup trigger no longer copies child data, so nothing new
-- lands in the old columns (they are kept only so a rollback of the app keeps working).

CREATE TABLE public.child_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
 -- NULL = not given yet (legacy name-only data); the app asks for it on new profiles.
 birth_year smallint CHECK (birth_year BETWEEN 1990 AND 2200),
 interests text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(interests) <= 5),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX child_profiles_household ON public.child_profiles(household_id, created_at);

-- One-word codes in the error message: the app maps them to Vietnamese (src/lib/child-profiles.ts).
CREATE FUNCTION public.child_profiles_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_uid uuid := auth.uid();
 v_year int := extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int;
 v_name text;
 v_tag text;
 v_tags text[] := '{}'::text[];
 v_count int;
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF v_uid IS NOT NULL THEN
   -- The household is server-derived: the caller's own one unless a household they belong to is named.
   IF NEW.household_id IS NULL THEN
    SELECT p.household_id INTO NEW.household_id FROM public.profiles p WHERE p.id = v_uid;
   END IF;
   IF NEW.household_id IS NULL OR NOT public.is_household_member(NEW.household_id) THEN
    RAISE EXCEPTION 'household_scope' USING ERRCODE = '42501';
   END IF;
   NEW.created_by := v_uid;
  ELSIF NEW.household_id IS NULL THEN
   RAISE EXCEPTION 'household_scope' USING ERRCODE = '23502';
  END IF;
  NEW.created_at := now();
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
   RAISE EXCEPTION 'household_scope' USING ERRCODE = '42501';
  END IF;
  -- The creator's account was deleted (FK ON DELETE SET NULL): nothing else changes.
  IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name AND NEW.birth_year IS NOT DISTINCT FROM OLD.birth_year
     AND NEW.interests IS NOT DISTINCT FROM OLD.interests THEN
   NEW.updated_at := OLD.updated_at;
   RETURN NEW;
  END IF;
 END IF;

 IF v_uid IS NOT NULL AND NOT public._consent_active(v_uid, 'parent_policy') THEN
  RAISE EXCEPTION 'consent_required' USING ERRCODE = '42501';
 END IF;

 v_name := btrim(regexp_replace(normalize(coalesce(NEW.display_name, ''), NFC), '\s+', ' ', 'g'));
 IF v_name = '' OR char_length(v_name) > 40 OR v_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'invalid_child_name' USING ERRCODE = '22023';
 END IF;
 NEW.display_name := v_name;

 -- 0–18 years old (a legacy age went up to 18); an unchanged old value is not re-checked.
 IF NEW.birth_year IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.birth_year IS DISTINCT FROM OLD.birth_year)
    AND (NEW.birth_year > v_year OR NEW.birth_year < v_year - 18) THEN
  RAISE EXCEPTION 'invalid_birth_year' USING ERRCODE = '22023';
 END IF;

 FOREACH v_tag IN ARRAY coalesce(NEW.interests, '{}'::text[]) LOOP
  v_tag := btrim(regexp_replace(normalize(coalesce(v_tag, ''), NFC), '\s+', ' ', 'g'));
  CONTINUE WHEN v_tag = '';
  IF char_length(v_tag) > 24 OR v_tag ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'invalid_child_interest' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_tags) t WHERE lower(t) = lower(v_tag)) THEN
   v_tags := v_tags || v_tag;
  END IF;
 END LOOP;
 IF cardinality(v_tags) > 5 THEN
  RAISE EXCEPTION 'too_many_child_interests' USING ERRCODE = '22023';
 END IF;
 NEW.interests := v_tags;
 NEW.updated_at := now();

 IF TG_OP = 'INSERT' THEN
  -- At most 5 per household; the household row lock serialises concurrent inserts.
  PERFORM 1 FROM public.households h WHERE h.id = NEW.household_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.child_profiles c WHERE c.household_id = NEW.household_id;
  IF v_count >= 5 THEN
   RAISE EXCEPTION 'child_profile_limit' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.child_profiles_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER child_profiles_guard BEFORE INSERT OR UPDATE ON public.child_profiles
 FOR EACH ROW EXECUTE FUNCTION public.child_profiles_guard();

ALTER TABLE public.child_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.child_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.child_profiles TO authenticated;
GRANT INSERT (household_id, display_name, birth_year, interests) ON public.child_profiles TO authenticated;
GRANT UPDATE (display_name, birth_year, interests) ON public.child_profiles TO authenticated;
GRANT ALL ON public.child_profiles TO service_role;
-- Members only. No staff policy: support/admin roles do not read children's profiles.
CREATE POLICY child_profiles_member_read ON public.child_profiles FOR SELECT TO authenticated
 USING (public.is_household_member(household_id));
CREATE POLICY child_profiles_member_insert ON public.child_profiles FOR INSERT TO authenticated
 WITH CHECK (public.is_household_member(household_id));
CREATE POLICY child_profiles_member_update ON public.child_profiles FOR UPDATE TO authenticated
 USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));
CREATE POLICY child_profiles_member_delete ON public.child_profiles FOR DELETE TO authenticated
 USING (public.is_household_member(household_id));

-- Backfill: one child profile per account that had a child name or age. A name-only row keeps
-- no birth year; an age-only row gets the neutral name "Bé" (parents can rename it).
INSERT INTO public.child_profiles(household_id, display_name, birth_year)
SELECT p.household_id,
       coalesce(nullif(left(btrim(regexp_replace(regexp_replace(normalize(coalesce(p.child_name, ''), NFC), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 40), ''), 'Bé'),
       CASE WHEN p.child_age IS NULL THEN NULL
            ELSE (extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int - p.child_age)::smallint END
  FROM public.profiles p
 WHERE p.household_id IS NOT NULL
   AND (nullif(btrim(coalesce(p.child_name, '')), '') IS NOT NULL OR p.child_age IS NOT NULL);

-- New accounts: no child data is copied at signup any more (the profile is created in the app,
-- after the parent's consent). The old columns stay until the contract migration.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.profiles (id, display_name, family_name)
 VALUES (
  NEW.id,
  COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
  COALESCE(NEW.raw_user_meta_data->>'family_name', '')
 );
 RETURN NEW;
END $$;
