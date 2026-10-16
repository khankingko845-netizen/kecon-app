-- ============================================================
-- Migration 041 · Admin › Sao lưu: every UPDATE has a WHERE (docs/admin-backup.md)
--
-- Supabase loads pg-safeupdate for API sessions (role authenticator): an
-- UPDATE or DELETE without a WHERE clause is rejected ("UPDATE requires a
-- WHERE clause"), also inside SECURITY DEFINER functions. 040 updated its
-- single-row tables without one, so saving the schedule or the GitHub token in
-- Admin › Sao lưu failed on the real stack (the PGlite tests have no
-- safeupdate; tests/db/migrations.test.ts now checks every function instead).
-- Same bodies as 040 plus `WHERE id` (the boolean primary key of the one row).
-- The worker functions (psql as owner, not affected) get it too, for the check.
-- CREATE OR REPLACE keeps owner and grants. Nothing else changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_update_backup_settings(p_expected_version integer, p_schedule_time text, p_keep_daily integer,
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
  version = s.version + 1, updated_at = now(), updated_by = auth.uid() WHERE id RETURNING * INTO s;
 PERFORM set_config('app.admin_reason', '', true);
 RETURN jsonb_build_object('changed', true, 'version', s.version);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_backup_token(p_token text, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
  token_set_at = v_now, token_set_by = auth.uid() WHERE id;
 PERFORM set_config('app.admin_reason', '', true);
 RETURN jsonb_build_object('last4', right(v_token, 4), 'kind', v_kind, 'set_at', v_now);
END $$;

CREATE OR REPLACE FUNCTION public.backup_worker_poll(p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz := now(); s public.backup_settings; w public.backup_worker; q public.backup_requests; v_kind text; v_run bigint;
 v_release text := left(p_state ->> 'release', 64); v_pass boolean := coalesce((p_state ->> 'passphrase_ok')::boolean, false); v_legacy jsonb := p_state -> 'legacy';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('kecon:backup_worker'));
 UPDATE public.backup_worker SET heartbeat_at = v_now, release = v_release, repo = p_state ->> 'repo', push_via = p_state ->> 'push_via',
  passphrase_ok = v_pass, snapshots = CASE WHEN jsonb_typeof(p_state -> 'snapshots') = 'array' THEN p_state -> 'snapshots' ELSE snapshots END,
  updated_at = v_now WHERE id RETURNING * INTO w;
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

CREATE OR REPLACE FUNCTION public.backup_worker_progress(p_run bigint, p_phase text) RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
 UPDATE public.backup_runs SET phase = left(p_phase, 40) WHERE id = p_run AND status = 'running';
 UPDATE public.backup_worker SET heartbeat_at = now() WHERE id;
$$;

CREATE OR REPLACE FUNCTION public.backup_worker_finish(p_run bigint, p_result jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
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
  snapshots = CASE WHEN jsonb_typeof(p_result -> 'snapshots') = 'array' THEN p_result -> 'snapshots' ELSE snapshots END WHERE id;
END $$;

CREATE OR REPLACE FUNCTION public.backup_worker_token_check(p_check jsonb) RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
 UPDATE public.backup_worker SET updated_at = now(), token_check = jsonb_build_object(
  'status', left(p_check ->> 'status', 20), 'source', left(p_check ->> 'source', 20), 'kind', left(p_check ->> 'kind', 20),
  'last4', CASE WHEN p_check ->> 'last4' ~ '^[A-Za-z0-9_]{4}$' THEN p_check ->> 'last4' END,
  'expires_at', CASE WHEN p_check ->> 'expires_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN p_check ->> 'expires_at' END,
  'push', CASE WHEN jsonb_typeof(p_check -> 'push') = 'boolean' THEN p_check -> 'push' END,
  'private', CASE WHEN jsonb_typeof(p_check -> 'private') = 'boolean' THEN p_check -> 'private' END,
  'message', left(p_check ->> 'message', 300), 'checked_at', now()) WHERE id;
$$;
