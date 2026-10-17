-- ============================================================
-- Migration 040 · Admin › Sao lưu (docs/admin-backup.md)
--
-- The web app never runs anything on the server. Staff with backups.manage
-- (super_admin, admin — always behind an A-05 TOTP session) only write rows
-- here: settings and "Sao lưu ngay" requests. The server's backup worker
-- (deploy/prized/backup/kecon_backup.py --tick: systemd timer every 2 minutes,
-- psql as the table owner) reads them, runs the backup and reports back.
-- Additive: 1 permission, 4 tables, RPCs and 2 audit triggers. Nothing dropped.
--
--   backup_settings (1 row)  daily time (Vietnam time), snapshots kept, GitHub
--                            token (value in Supabase Vault, only last 4 here)
--   backup_requests          "Sao lưu ngay": reason 10–500, one open, ≤ 3 an hour
--   backup_runs              every run: status, step, result (never a secret)
--   backup_worker   (1 row)  heartbeat, repo, token check — written by the server
-- The backup repo and the encryption passphrase are NOT here: they stay in the
-- server's environment / files (changing them from a web page = exfiltration).
-- ============================================================

-- 1) Permission (super_admin gets every permission; admin = all but roles.manage).
INSERT INTO public.admin_permissions (key, label) VALUES
  ('backups.manage', 'Xem / chạy / cấu hình sao lưu')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;
INSERT INTO public.admin_role_permissions (role, permission) VALUES
  ('super_admin', 'backups.manage'), ('admin', 'backups.manage')
ON CONFLICT DO NOTHING;

-- A-05: any role holding backups.manage needs a fresh TOTP admin session.
CREATE OR REPLACE FUNCTION public.admin_requires_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.admin_role_permissions r ON r.role=p.role
 WHERE p.id=auth.uid() AND r.permission IN ('stories.write','categories.manage','templates.manage','roles.manage','settings.write','secrets.manage','voices.manage','moderation.manage','notifications.send','backups.manage'));
$$;

-- 2) Tables. RLS on, no policies, no grants: only the RPCs below and the owner.
CREATE TABLE public.backup_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 schedule_time time(0) NOT NULL DEFAULT '03:15' CHECK (extract(second FROM schedule_time) = 0),
 keep_daily smallint NOT NULL DEFAULT 7 CHECK (keep_daily BETWEEN 3 AND 30),
 keep_weekly smallint NOT NULL DEFAULT 4 CHECK (keep_weekly BETWEEN 0 AND 12),
 keep_monthly smallint NOT NULL DEFAULT 6 CHECK (keep_monthly BETWEEN 0 AND 24),
 version integer NOT NULL DEFAULT 1,
 -- Slots before the last time change are not "missed" (no surprise catch-up run).
 schedule_changed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 token_vault_id uuid,
 token_last4 text CHECK (token_last4 IS NULL OR char_length(token_last4) = 4),
 token_kind text CHECK (token_kind IN ('fine_grained', 'classic')),
 token_set_at timestamptz,
 token_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.backup_settings DEFAULT VALUES;

CREATE TABLE public.backup_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 requested_at timestamptz NOT NULL DEFAULT now(),
 requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'expired')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX backup_requests_one_open ON public.backup_requests ((true)) WHERE status IN ('pending', 'running');
CREATE INDEX backup_requests_recent ON public.backup_requests (requested_at DESC);

CREATE TABLE public.backup_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('scheduled', 'manual', 'cli')),
 request_id bigint UNIQUE REFERENCES public.backup_requests(id) ON DELETE SET NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'push_failed', 'restore_failed', 'failed')),
 phase text CHECK (char_length(phase) <= 40),
 exit_code integer,
 release text CHECK (char_length(release) <= 64),
 summary jsonb,
 error text CHECK (char_length(error) <= 500),
 CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE UNIQUE INDEX backup_runs_one_running ON public.backup_runs ((true)) WHERE status = 'running';
CREATE INDEX backup_runs_recent ON public.backup_runs (started_at DESC, id DESC);

CREATE TABLE public.backup_worker (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 heartbeat_at timestamptz,
 release text CHECK (char_length(release) <= 64),
 repo text CHECK (repo ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
 push_via text CHECK (push_via IN ('vault_token', 'file_token', 'deploy_key', 'none')),
 passphrase_ok boolean,
 token_check jsonb,
 snapshots jsonb,
 updated_at timestamptz
);
INSERT INTO public.backup_worker DEFAULT VALUES;

ALTER TABLE public.backup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_worker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_settings, public.backup_requests, public.backup_runs, public.backup_worker FROM PUBLIC, anon, authenticated, service_role;

-- 3) Audit: one row per real change, written in the same transaction (A-03).
CREATE FUNCTION public.audit_backup_settings_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_reason text := nullif(current_setting('app.admin_reason', true), '');
 v_source text := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'db' END;
BEGIN
 IF (OLD.schedule_time, OLD.keep_daily, OLD.keep_weekly, OLD.keep_monthly) IS DISTINCT FROM (NEW.schedule_time, NEW.keep_daily, NEW.keep_weekly, NEW.keep_monthly) THEN
  PERFORM public.audit_write('backup.settings_update', 'backup', 'settings',
   jsonb_build_object('schedule_time', to_char(OLD.schedule_time, 'HH24:MI'), 'keep_daily', OLD.keep_daily, 'keep_weekly', OLD.keep_weekly, 'keep_monthly', OLD.keep_monthly, 'version', OLD.version),
   jsonb_build_object('schedule_time', to_char(NEW.schedule_time, 'HH24:MI'), 'keep_daily', NEW.keep_daily, 'keep_weekly', NEW.keep_weekly, 'keep_monthly', NEW.keep_monthly, 'version', NEW.version),
   v_reason, NULL, NULL, v_source);
 END IF;
 IF (OLD.token_vault_id, OLD.token_last4, OLD.token_kind, OLD.token_set_at) IS DISTINCT FROM (NEW.token_vault_id, NEW.token_last4, NEW.token_kind, NEW.token_set_at) THEN
  PERFORM public.audit_write('backup.token_set', 'backup', 'github_token',
   jsonb_build_object('is_set', OLD.token_vault_id IS NOT NULL, 'last4', '…' || OLD.token_last4, 'kind', OLD.token_kind),
   jsonb_build_object('is_set', NEW.token_vault_id IS NOT NULL, 'last4', '…' || NEW.token_last4, 'kind', NEW.token_kind),
   v_reason, NULL, NULL, v_source);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER audit_backup_settings AFTER UPDATE ON public.backup_settings
 FOR EACH ROW EXECUTE FUNCTION public.audit_backup_settings_change();

CREATE FUNCTION public.audit_backup_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.audit_write('backup.run_request', 'backup', NEW.id::text, NULL, jsonb_build_object('request', NEW.id),
  NEW.reason, NULL, NULL, CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'db' END);
 RETURN NULL;
END $$;
CREATE TRIGGER audit_backup_requests AFTER INSERT ON public.backup_requests
 FOR EACH ROW EXECUTE FUNCTION public.audit_backup_request();

-- 4) Schedule. Slot = latest scheduled instant ≤ p_now (Asia/Ho_Chi_Minh, no DST).
--    The slot is done once a run that started at/after it succeeded (any kind);
--    a failed scheduled run is retried after 30 minutes, at most 3 tries a slot.
CREATE FUNCTION public.backup_schedule(p_now timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE s public.backup_settings; v_slot timestamptz; v_done boolean; v_tries integer; v_last timestamptz; v_running boolean; v_counts boolean; v_due boolean; v_next timestamptz;
BEGIN
 SELECT * INTO s FROM public.backup_settings;
 v_slot := ((p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + s.schedule_time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
 IF v_slot > p_now THEN v_slot := v_slot - interval '1 day'; END IF;
 v_done := EXISTS (SELECT 1 FROM public.backup_runs r WHERE r.started_at >= v_slot AND r.status = 'ok');
 SELECT count(*), max(r.finished_at) INTO v_tries, v_last FROM public.backup_runs r
  WHERE r.kind = 'scheduled' AND r.started_at >= v_slot AND r.status <> 'running';
 v_running := EXISTS (SELECT 1 FROM public.backup_runs r WHERE r.status = 'running');
 v_counts := s.schedule_changed_at IS NULL OR v_slot >= s.schedule_changed_at;
 v_due := v_counts AND NOT v_done AND NOT v_running AND v_tries < 3 AND (v_last IS NULL OR v_last <= p_now - interval '30 minutes');
 v_next := CASE
  WHEN v_running THEN NULL
  WHEN v_due THEN p_now
  WHEN v_counts AND NOT v_done AND v_tries < 3 THEN v_last + interval '30 minutes'
  ELSE v_slot + interval '1 day' END;
 RETURN jsonb_build_object('timezone', 'Asia/Ho_Chi_Minh', 'slot', v_slot, 'slot_done', v_done, 'tries', v_tries,
  'due', v_due, 'running', v_running, 'next_run_at', v_next);
END $$;

-- 5) Worker API — the server only (psql as owner). Not callable through the API.
--    The worker holds its flock while it polls, so a run still "running" was
--    interrupted (reboot, timeout, kill) and is closed as failed.
CREATE FUNCTION public.backup_worker_poll(p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz := now(); s public.backup_settings; w public.backup_worker; q public.backup_requests; v_kind text; v_run bigint;
 v_release text := left(p_state ->> 'release', 64); v_pass boolean := coalesce((p_state ->> 'passphrase_ok')::boolean, false); v_legacy jsonb := p_state -> 'legacy';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('kecon:backup_worker'));
 UPDATE public.backup_worker SET heartbeat_at = v_now, release = v_release, repo = p_state ->> 'repo', push_via = p_state ->> 'push_via',
  passphrase_ok = v_pass, snapshots = CASE WHEN jsonb_typeof(p_state -> 'snapshots') = 'array' THEN p_state -> 'snapshots' ELSE snapshots END,
  updated_at = v_now RETURNING * INTO w;
 UPDATE public.backup_requests q2 SET status = 'failed', updated_at = v_now FROM public.backup_runs r WHERE r.status = 'running' AND r.request_id = q2.id;
 UPDATE public.backup_runs SET status = 'failed', finished_at = v_now, phase = NULL,
  error = 'Bị gián đoạn: máy chủ khởi động lại hoặc tiến trình bị dừng giữa chừng' WHERE status = 'running';
 UPDATE public.backup_requests SET status = 'expired', updated_at = v_now WHERE status = 'pending' AND requested_at < v_now - interval '6 hours';
 -- First tick after this migration: keep the last run of the old daily job (last-run.json) as history.
 IF jsonb_typeof(v_legacy) = 'object' AND NOT EXISTS (SELECT 1 FROM public.backup_runs) THEN
  BEGIN
   INSERT INTO public.backup_runs (kind, started_at, finished_at, status, exit_code, summary)
   VALUES ('cli', (v_legacy ->> 'started_at')::timestamptz, (v_legacy ->> 'finished_at')::timestamptz, v_legacy ->> 'status',
           (v_legacy ->> 'exit_code')::integer, v_legacy -> 'summary');
  EXCEPTION WHEN others THEN NULL;  -- unreadable legacy file: just no history
  END;
 END IF;
 IF p_state ->> 'mode' = 'cli' THEN
  v_kind := 'cli';
 ELSIF p_state ->> 'mode' IS DISTINCT FROM 'peek' THEN  -- peek (--no-push test run): settings only, claims nothing
  SELECT * INTO q FROM public.backup_requests WHERE status = 'pending' ORDER BY requested_at, id LIMIT 1 FOR UPDATE;
  IF FOUND AND NOT v_pass THEN
   INSERT INTO public.backup_runs (kind, request_id, release, started_at, finished_at, status, error)
   VALUES ('manual', q.id, v_release, v_now, v_now, 'failed', 'Máy chủ chưa có mật khẩu mã hoá (passphrase) nên không sao lưu được');
   UPDATE public.backup_requests SET status = 'failed', updated_at = v_now WHERE id = q.id;
  ELSIF FOUND THEN
   v_kind := 'manual';
  ELSIF v_pass AND (public.backup_schedule(v_now) ->> 'due')::boolean THEN
   v_kind := 'scheduled';
  END IF;
 END IF;
 IF v_kind IS NOT NULL THEN
  INSERT INTO public.backup_runs (kind, request_id, release, phase)
  VALUES (v_kind, CASE WHEN v_kind = 'manual' THEN q.id END, v_release, 'start') RETURNING id INTO v_run;
  IF v_kind = 'manual' THEN UPDATE public.backup_requests SET status = 'running', updated_at = v_now WHERE id = q.id; END IF;
 END IF;
 SELECT * INTO s FROM public.backup_settings;
 RETURN jsonb_build_object(
  'run', CASE WHEN v_run IS NULL THEN NULL ELSE jsonb_build_object('id', v_run, 'kind', v_kind) END,
  'settings', jsonb_build_object('schedule_time', to_char(s.schedule_time, 'HH24:MI'), 'keep_daily', s.keep_daily,
                                 'keep_weekly', s.keep_weekly, 'keep_monthly', s.keep_monthly),
  'token', jsonb_build_object('in_vault', s.token_vault_id IS NOT NULL, 'last4', s.token_last4, 'set_at', s.token_set_at),
  'token_check', w.token_check);
END $$;

CREATE FUNCTION public.backup_worker_token() RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT d.decrypted_secret FROM public.backup_settings s JOIN vault.decrypted_secrets d ON d.id = s.token_vault_id
$$;

CREATE FUNCTION public.backup_worker_progress(p_run bigint, p_phase text) RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
 UPDATE public.backup_runs SET phase = left(p_phase, 40) WHERE id = p_run AND status = 'running';
 UPDATE public.backup_worker SET heartbeat_at = now();
$$;

CREATE FUNCTION public.backup_worker_finish(p_run bigint, p_result jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_status text := p_result ->> 'status'; v_req bigint;
BEGIN
 IF v_status IS NULL OR v_status NOT IN ('ok', 'push_failed', 'restore_failed', 'failed') THEN v_status := 'failed'; END IF;
 UPDATE public.backup_runs SET status = v_status, finished_at = now(), phase = NULL,
  exit_code = CASE WHEN jsonb_typeof(p_result -> 'exit_code') = 'number' THEN (p_result ->> 'exit_code')::integer END,
  summary = CASE WHEN jsonb_typeof(p_result -> 'summary') = 'object' THEN p_result -> 'summary' END,
  error = left(nullif(p_result ->> 'error', ''), 500)
  WHERE id = p_run AND status = 'running' RETURNING request_id INTO v_req;
 IF v_req IS NOT NULL THEN
  UPDATE public.backup_requests SET status = CASE WHEN v_status = 'ok' THEN 'done' ELSE 'failed' END, updated_at = now() WHERE id = v_req;
 END IF;
 UPDATE public.backup_worker SET heartbeat_at = now(),
  snapshots = CASE WHEN jsonb_typeof(p_result -> 'snapshots') = 'array' THEN p_result -> 'snapshots' ELSE snapshots END;
END $$;

-- Only known keys are kept: a check can never smuggle the token into the table.
CREATE FUNCTION public.backup_worker_token_check(p_check jsonb) RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
 UPDATE public.backup_worker SET updated_at = now(), token_check = jsonb_build_object(
  'status', left(p_check ->> 'status', 20), 'source', left(p_check ->> 'source', 20), 'kind', left(p_check ->> 'kind', 20),
  'last4', CASE WHEN p_check ->> 'last4' ~ '^[A-Za-z0-9_]{4}$' THEN p_check ->> 'last4' END,
  'expires_at', CASE WHEN p_check ->> 'expires_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN p_check ->> 'expires_at' END,
  'push', CASE WHEN jsonb_typeof(p_check -> 'push') = 'boolean' THEN p_check -> 'push' END,
  'private', CASE WHEN jsonb_typeof(p_check -> 'private') = 'boolean' THEN p_check -> 'private' END,
  'message', left(p_check ->> 'message', 300), 'checked_at', now());
$$;

-- 6) Admin RPCs (backups.manage + valid A-05 session via has_permission).
CREATE FUNCTION public.admin_backup_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.backup_settings; w public.backup_worker;
BEGIN
 IF NOT public.has_permission('backups.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
 SELECT * INTO s FROM public.backup_settings;
 SELECT * INTO w FROM public.backup_worker;
 RETURN jsonb_build_object(
  'now', now(),
  'settings', jsonb_build_object('schedule_time', to_char(s.schedule_time, 'HH24:MI'), 'keep_daily', s.keep_daily, 'keep_weekly', s.keep_weekly,
    'keep_monthly', s.keep_monthly, 'version', s.version, 'updated_at', s.updated_at,
    'updated_by_email', (SELECT u.email::text FROM auth.users u WHERE u.id = s.updated_by)),
  'schedule', public.backup_schedule(now()),
  'token', jsonb_build_object('is_set', s.token_vault_id IS NOT NULL, 'last4', s.token_last4, 'kind', s.token_kind, 'set_at', s.token_set_at,
    'set_by_email', (SELECT u.email::text FROM auth.users u WHERE u.id = s.token_set_by)),
  'worker', jsonb_build_object('heartbeat_at', w.heartbeat_at, 'release', w.release, 'repo', w.repo, 'push_via', w.push_via,
    'passphrase_ok', w.passphrase_ok, 'token_check', w.token_check, 'snapshots', coalesce(w.snapshots, '[]'::jsonb)),
  'runs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'phase', r.phase,
     'started_at', r.started_at, 'finished_at', r.finished_at, 'exit_code', r.exit_code, 'release', r.release, 'error', r.error,
     'summary', r.summary, 'reason', q.reason, 'requested_by_email', u.email::text) ORDER BY r.started_at DESC, r.id DESC), '[]'::jsonb)
   FROM (SELECT * FROM public.backup_runs ORDER BY started_at DESC, id DESC LIMIT 15) r
   LEFT JOIN public.backup_requests q ON q.id = r.request_id LEFT JOIN auth.users u ON u.id = q.requested_by),
  'last_success', (SELECT jsonb_build_object('id', r.id, 'kind', r.kind, 'started_at', r.started_at, 'finished_at', r.finished_at, 'summary', r.summary)
   FROM public.backup_runs r WHERE r.status = 'ok' ORDER BY r.started_at DESC, r.id DESC LIMIT 1),
  'request', (SELECT jsonb_build_object('id', q.id, 'status', q.status, 'requested_at', q.requested_at, 'reason', q.reason, 'requested_by_email', u.email::text)
   FROM public.backup_requests q LEFT JOIN auth.users u ON u.id = q.requested_by WHERE q.status IN ('pending', 'running') ORDER BY q.requested_at DESC LIMIT 1),
  'requests_last_hour', (SELECT count(*) FROM public.backup_requests q WHERE q.requested_at > now() - interval '1 hour'),
  'limits', jsonb_build_object('requests_per_hour', 3, 'keep_daily', jsonb_build_array(3, 30), 'keep_weekly', jsonb_build_array(0, 12),
    'keep_monthly', jsonb_build_array(0, 24)),
  'can_set_token', public.has_permission('secrets.manage'));
END $$;

CREATE FUNCTION public.admin_update_backup_settings(p_expected_version integer, p_schedule_time text, p_keep_daily integer,
 p_keep_weekly integer, p_keep_monthly integer, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.backup_settings; v_reason text; v_time time;
BEGIN
 IF NOT public.has_permission('backups.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
 v_reason := public.admin_action_reason(p_reason);
 IF p_schedule_time IS NULL OR p_schedule_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid time' USING ERRCODE = '22023'; END IF;
 v_time := p_schedule_time::time;
 IF p_keep_daily IS NULL OR p_keep_daily NOT BETWEEN 3 AND 30 OR p_keep_weekly IS NULL OR p_keep_weekly NOT BETWEEN 0 AND 12
    OR p_keep_monthly IS NULL OR p_keep_monthly NOT BETWEEN 0 AND 24 THEN
  RAISE EXCEPTION 'Invalid retention' USING ERRCODE = '22023';
 END IF;
 SELECT * INTO s FROM public.backup_settings FOR UPDATE;
 IF p_expected_version IS NULL OR s.version <> p_expected_version THEN RAISE EXCEPTION 'Settings changed; reload' USING ERRCODE = '40001'; END IF;
 IF (s.schedule_time, s.keep_daily::integer, s.keep_weekly::integer, s.keep_monthly::integer) = (v_time, p_keep_daily, p_keep_weekly, p_keep_monthly) THEN
  RETURN jsonb_build_object('changed', false, 'version', s.version);
 END IF;
 PERFORM set_config('app.admin_reason', v_reason, true);
 UPDATE public.backup_settings SET schedule_time = v_time, keep_daily = p_keep_daily, keep_weekly = p_keep_weekly, keep_monthly = p_keep_monthly,
  schedule_changed_at = CASE WHEN v_time <> s.schedule_time THEN now() ELSE s.schedule_changed_at END,
  version = s.version + 1, updated_at = now(), updated_by = auth.uid() RETURNING * INTO s;
 PERFORM set_config('app.admin_reason', '', true);
 RETURN jsonb_build_object('changed', true, 'version', s.version);
END $$;

CREATE FUNCTION public.admin_request_backup(p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_reason text; q public.backup_requests;
BEGIN
 IF NOT public.has_permission('backups.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
 v_reason := public.admin_action_reason(p_reason);
 PERFORM pg_advisory_xact_lock(hashtext('kecon:backup_request'));
 IF EXISTS (SELECT 1 FROM public.backup_requests WHERE status IN ('pending', 'running')) OR EXISTS (SELECT 1 FROM public.backup_runs WHERE status = 'running') THEN
  RAISE EXCEPTION 'A backup is already queued or running' USING ERRCODE = '55006';
 END IF;
 IF (SELECT count(*) FROM public.backup_requests WHERE requested_at > now() - interval '1 hour') >= 3 THEN
  RAISE EXCEPTION 'Too many backup requests this hour' USING ERRCODE = '54000';
 END IF;
 INSERT INTO public.backup_requests (requested_by, reason) VALUES (auth.uid(), v_reason) RETURNING * INTO q;
 RETURN jsonb_build_object('id', q.id, 'status', q.status, 'requested_at', q.requested_at);
END $$;

-- Write-only: the token goes to Vault, only kind + last 4 come back. The API
-- route checks it against GitHub before calling this; the server re-checks it
-- on its next tick (so a token saved by calling this directly still shows red).
CREATE FUNCTION public.admin_set_backup_token(p_token text, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_reason text; v_token text := regexp_replace(coalesce(p_token, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'); v_kind text; v_id uuid; s public.backup_settings; v_now timestamptz := now();
BEGIN
 IF NOT (public.has_permission('backups.manage') AND public.has_permission('secrets.manage')) THEN
  RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
 END IF;
 v_reason := public.admin_action_reason(p_reason);
 IF v_token !~ '^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$' THEN RAISE EXCEPTION 'Invalid token format' USING ERRCODE = '22023'; END IF;
 v_kind := CASE WHEN left(v_token, 11) = 'github_pat_' THEN 'fine_grained' ELSE 'classic' END;
 SELECT * INTO s FROM public.backup_settings FOR UPDATE;
 SELECT v.id INTO v_id FROM vault.secrets v WHERE v.id = s.token_vault_id OR v.name = 'kecon/backup/github_token'
  ORDER BY (v.id IS NOT DISTINCT FROM s.token_vault_id) DESC LIMIT 1;
 IF v_id IS NULL THEN
  v_id := vault.create_secret(v_token, 'kecon/backup/github_token', 'KểCon · token GitHub đẩy bản sao lưu (Admin › Sao lưu)');
 ELSE
  PERFORM vault.update_secret(v_id, v_token);
 END IF;
 PERFORM set_config('app.admin_reason', v_reason, true);
 UPDATE public.backup_settings SET token_vault_id = v_id, token_last4 = right(v_token, 4), token_kind = v_kind,
  token_set_at = v_now, token_set_by = auth.uid();
 PERFORM set_config('app.admin_reason', '', true);
 RETURN jsonb_build_object('last4', right(v_token, 4), 'kind', v_kind, 'set_at', v_now);
END $$;

REVOKE ALL ON FUNCTION public.audit_backup_settings_change(), public.audit_backup_request(), public.backup_schedule(timestamptz),
 public.backup_worker_poll(jsonb), public.backup_worker_token(), public.backup_worker_progress(bigint, text),
 public.backup_worker_finish(bigint, jsonb), public.backup_worker_token_check(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_backup_status(), public.admin_update_backup_settings(integer, text, integer, integer, integer, text),
 public.admin_request_backup(text), public.admin_set_backup_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_backup_status(), public.admin_update_backup_settings(integer, text, integer, integer, integer, text),
 public.admin_request_backup(text), public.admin_set_backup_token(text, text) TO authenticated;
