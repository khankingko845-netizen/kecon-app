-- A-05: signed JWT AAL2 + fresh TOTP for writers, server-owned idle sessions.
-- No MFA secret/code stored here. GoTrue owns enrollment, challenges, rate limits.
CREATE TABLE public.admin_sessions (
 session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 auth_at bigint NOT NULL,
 last_activity timestamptz NOT NULL DEFAULT now(),
 closed boolean NOT NULL DEFAULT false
);
CREATE INDEX admin_sessions_user ON public.admin_sessions(user_id);
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_sessions FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_requires_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.admin_role_permissions r ON r.role=p.role
 WHERE p.id=auth.uid() AND r.permission IN ('stories.write','categories.manage','templates.manage','roles.manage','settings.write','secrets.manage','voices.manage','moderation.manage','notifications.send'));
$$;
CREATE FUNCTION public.admin_claim_session() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN auth.jwt()->>'session_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (auth.jwt()->>'session_id')::uuid END;
$$;
CREATE FUNCTION public.admin_claim_proof() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(max((a->>'timestamp')::bigint),0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(auth.jwt()->'amr')='array' THEN auth.jwt()->'amr' ELSE '[]'::jsonb END) a
 WHERE a->>'timestamp' ~ '^[0-9]{1,12}$' AND (NOT public.admin_requires_mfa() OR a->>'method'='totp');
$$;
CREATE FUNCTION public.admin_mfa_valid() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT public.admin_requires_mfa() OR (auth.jwt()->>'aal'='aal2' AND public.admin_claim_proof()>0
 AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=auth.uid() AND f.factor_type='totp' AND f.status='verified'));
$$;
CREATE FUNCTION public.admin_session_valid() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(public.admin_mfa_valid(),false) AND EXISTS(
 SELECT 1 FROM public.admin_sessions s JOIN auth.sessions a ON a.id=s.session_id AND a.user_id=s.user_id
 WHERE s.session_id=public.admin_claim_session() AND s.user_id=auth.uid() AND NOT s.closed
 AND s.last_activity>now()-interval '30 minutes' AND s.auth_at<=public.admin_claim_proof());
$$;

-- Bootstrap exposes only the caller's state, never staff data or secrets.
CREATE FUNCTION public.admin_access_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.admin_sessions; v_state text; v_required boolean:=public.admin_requires_mfa();
BEGIN
 IF NOT public.is_staff() THEN RETURN jsonb_build_object('state','forbidden','requires_mfa',false,'expires_at',NULL); END IF;
 SELECT * INTO s FROM public.admin_sessions WHERE session_id=public.admin_claim_session() AND user_id=auth.uid();
 IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=public.admin_claim_session() AND user_id=auth.uid()) THEN v_state:='session_required';
 ELSIF NOT COALESCE(public.admin_mfa_valid(),false) THEN v_state:='mfa_required';
 ELSIF s.session_id IS NULL THEN v_state:='session_required';
 ELSIF s.closed OR s.last_activity<=now()-interval '30 minutes' THEN v_state:='session_expired';
 ELSIF s.auth_at>public.admin_claim_proof() THEN v_state:='mfa_required';
 ELSE v_state:='ready'; END IF;
 RETURN jsonb_build_object('state',v_state,'requires_mfa',v_required,'expires_at',CASE WHEN v_state='ready' THEN s.last_activity+interval '30 minutes' END);
END; $$;
CREATE FUNCTION public.open_admin_session() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_sid uuid:=public.admin_claim_session(); v_proof bigint:=public.admin_claim_proof(); s public.admin_sessions; changed boolean;
BEGIN
 IF NOT public.is_staff() THEN RETURN public.admin_access_status(); END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=v_sid AND user_id=auth.uid()) THEN RETURN public.admin_access_status(); END IF;
 SELECT * INTO s FROM public.admin_sessions WHERE session_id=v_sid FOR UPDATE;
 IF NOT COALESCE(public.admin_mfa_valid(),false) OR v_proof<extract(epoch FROM now())-300 OR v_proof>extract(epoch FROM now())+30
 OR (s.session_id IS NOT NULL AND (s.closed OR s.last_activity<=now()-interval '30 minutes') AND v_proof<=s.auth_at)
 THEN RETURN jsonb_build_object('state','mfa_required','requires_mfa',public.admin_requires_mfa(),'expires_at',NULL); END IF;
 changed:=s.session_id IS NULL OR s.closed OR s.last_activity<=now()-interval '30 minutes';
 INSERT INTO public.admin_sessions(session_id,user_id,auth_at,last_activity,closed) VALUES(v_sid,auth.uid(),v_proof,now(),false)
 ON CONFLICT(session_id) DO UPDATE SET auth_at=GREATEST(admin_sessions.auth_at,EXCLUDED.auth_at),last_activity=now(),closed=false WHERE admin_sessions.user_id=auth.uid();
 IF changed THEN PERFORM public.audit_write('admin_session.open','admin_session',NULL,NULL,jsonb_build_object('idle_minutes',30,'requires_mfa',public.admin_requires_mfa()),NULL,NULL,NULL,'api'); END IF;
 RETURN public.admin_access_status();
END; $$;
CREATE FUNCTION public.touch_admin_session() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.admin_sessions SET last_activity=now() WHERE session_id=public.admin_claim_session() AND user_id=auth.uid() AND public.admin_session_valid();
 RETURN public.admin_access_status();
END; $$;
CREATE FUNCTION public.close_admin_session() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.admin_sessions SET closed=true WHERE session_id=public.admin_claim_session() AND user_id=auth.uid() AND NOT closed;
 IF FOUND THEN PERFORM public.audit_write('admin_session.close','admin_session',NULL,NULL,NULL,NULL,NULL,NULL,'api'); END IF;
 RETURN public.admin_access_status();
END; $$;
REVOKE ALL ON FUNCTION public.admin_requires_mfa(),public.admin_claim_session(),public.admin_claim_proof(),public.admin_mfa_valid(),public.admin_session_valid(),public.admin_access_status(),public.open_admin_session(),public.touch_admin_session(),public.close_admin_session() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_access_status(),public.open_admin_session(),public.touch_admin_session(),public.close_admin_session(),public.admin_session_valid() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_permission(p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.admin_session_valid() AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.admin_role_permissions r ON r.role=p.role WHERE p.id=auth.uid() AND r.permission=p_permission);
$$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.admin_session_valid() AND EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role IN ('admin','super_admin'));
$$;

-- Owner policies cannot let an expired admin edit their own platform content.
CREATE FUNCTION public.guard_admin_platform_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE platform boolean; v_story uuid;
BEGIN
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
REVOKE ALL ON FUNCTION public.guard_admin_platform_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER admin_platform_write BEFORE INSERT OR UPDATE OR DELETE ON public.stories FOR EACH ROW EXECUTE FUNCTION public.guard_admin_platform_write();
CREATE TRIGGER admin_platform_page_write BEFORE INSERT OR UPDATE OR DELETE ON public.story_pages FOR EACH ROW EXECUTE FUNCTION public.guard_admin_platform_write();
CREATE TRIGGER admin_platform_character_write BEFORE INSERT OR UPDATE OR DELETE ON public.story_characters FOR EACH ROW EXECUTE FUNCTION public.guard_admin_platform_write();

-- Preserve profile protection; close legacy raw-role plan bypass.
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- auth.uid() NULL = service role, SQL editor hoặc trigger hệ thống
  -- (vd: tạo profile khi đăng ký). Anon không ghi được profiles nhờ RLS.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.role INTO caller_role FROM public.profiles p WHERE p.id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_permission('roles.manage') THEN
      NEW.role := 'user';
    END IF;
    IF (COALESCE(caller_role, '') NOT IN ('admin', 'super_admin') OR NOT public.admin_session_valid()) THEN
      NEW.current_plan := 'free';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.has_permission('roles.manage') THEN
      RAISE EXCEPTION 'Chỉ super_admin được đổi vai trò người dùng'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.id = auth.uid() THEN
      RAISE EXCEPTION 'Không tự đổi vai trò của chính mình'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.current_plan IS DISTINCT FROM OLD.current_plan
     AND (COALESCE(caller_role, '') NOT IN ('admin', 'super_admin') OR NOT public.admin_session_valid()) THEN
    RAISE EXCEPTION 'Chỉ admin được đổi gói cước'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Removing a verified factor immediately revokes all console leases, even if
-- an already issued AAL2 JWT has not expired and another factor still exists.
CREATE FUNCTION public.revoke_admin_on_factor_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status='verified' AND (TG_OP='DELETE' OR NEW.status IS DISTINCT FROM OLD.status) THEN
  UPDATE public.admin_sessions SET closed=true WHERE user_id=OLD.user_id AND NOT closed;
  IF FOUND THEN PERFORM public.audit_write('admin_session.revoke','admin_session',OLD.user_id::text,NULL,NULL,'Phương thức xác thực thay đổi',NULL,NULL,'system'); END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.revoke_admin_on_factor_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER revoke_admin_factor AFTER DELETE OR UPDATE OF status ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION public.revoke_admin_on_factor_change();
