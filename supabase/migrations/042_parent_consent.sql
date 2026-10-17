-- T11 — Server-side parent consent with a versioned policy (docs/parent-consent.md).
-- Replaces the localStorage banner (ComplianceLayer): the app opens only once the
-- signed-in parent accepted the CURRENT version of the parent privacy policy; a new
-- version asks again. Withdrawal stops new server-side processing until the parent
-- accepts again: paid AI / TTS / clone / illustration (consume_usage), parent
-- reminders (parent_notify_claim) and — in the API routes — first-party events,
-- push registration, share links and avatar uploads (consent_check).
-- A PIN-holding account must prove the PIN (parent proof, migration 036) to accept or
-- withdraw; without a PIN the account holder attests (client-side adult question).
-- Additive (expand only). New versions are published by a later migration: published
-- documents are immutable and the consent rows keep the exact version + SHA-256.

-- 1) Policy documents: public, versioned, immutable once inserted.
CREATE TABLE public.consent_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('parent_policy')),
 version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
 locale text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi','en','ja')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
 summary text NOT NULL CHECK (char_length(summary) BETWEEN 20 AND 1500),
 body text NOT NULL CHECK (char_length(body) BETWEEN 200 AND 40000),
 body_sha256 text NOT NULL DEFAULT '',
 published_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (kind, locale, version)
);
CREATE FUNCTION public.consent_documents_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,extensions AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  -- What the parent reads: title + summary + full text (UTF-8).
  NEW.body_sha256 := encode(digest(convert_to(NEW.title || E'\n\n' || NEW.summary || E'\n\n' || NEW.body, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Consent documents are immutable: publish a new version' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER consent_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.consent_documents
 FOR EACH ROW EXECUTE FUNCTION public.consent_documents_guard();
ALTER TABLE public.consent_documents ADD CONSTRAINT consent_documents_sha CHECK (body_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.consent_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consent_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consent_documents TO anon, authenticated;
CREATE POLICY consent_documents_published ON public.consent_documents FOR SELECT TO anon, authenticated
 USING (published_at <= now());

-- 2) Consent records: one row per acceptance; withdrawal only stamps withdrawn_at.
CREATE TABLE public.consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
 document_id uuid NOT NULL REFERENCES public.consent_documents(id),
 kind text NOT NULL,
 version integer NOT NULL,
 body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
 method text NOT NULL CHECK (method IN ('parent_pin','account_holder')),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,
 withdraw_method text CHECK (withdraw_method IS NULL OR withdraw_method IN ('parent_pin','account_holder')),
 user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
 CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at),
 CHECK ((withdrawn_at IS NULL) = (withdraw_method IS NULL))
);
CREATE UNIQUE INDEX consents_active_document ON public.consents(user_id, document_id) WHERE withdrawn_at IS NULL;
CREATE INDEX consents_user_kind ON public.consents(user_id, kind, accepted_at DESC);
CREATE FUNCTION public.consents_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 -- Evidence is append-only: the record itself never changes; an open record can be
 -- withdrawn once (never re-opened); household_id may only be cleared (SET NULL).
 IF (NEW.id, NEW.user_id, NEW.document_id, NEW.kind, NEW.version, NEW.body_sha256, NEW.method, NEW.accepted_at, NEW.user_agent)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.document_id, OLD.kind, OLD.version, OLD.body_sha256, OLD.method, OLD.accepted_at, OLD.user_agent)
  OR (OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at, NEW.withdraw_method) IS DISTINCT FROM (OLD.withdrawn_at, OLD.withdraw_method))
  OR (NEW.household_id IS DISTINCT FROM OLD.household_id AND NEW.household_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Consent records are append-only' USING ERRCODE = '42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consents_guard BEFORE UPDATE ON public.consents FOR EACH ROW EXECUTE FUNCTION public.consents_guard();
ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consents TO authenticated;
CREATE POLICY consents_own ON public.consents FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3) Helpers (internal): the current version is the highest published one; a
--    translation shares its version number, so consent is checked per version.
CREATE FUNCTION public._consent_current_version(p_kind text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT max(d.version) FROM public.consent_documents d WHERE d.kind = p_kind AND d.published_at <= now()
$$;
CREATE FUNCTION public._consent_current_document(p_kind text, p_locale text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT d.id FROM public.consent_documents d
  WHERE d.kind = p_kind AND d.published_at <= now() AND d.version = public._consent_current_version(p_kind)
  ORDER BY (d.locale = coalesce(p_locale, 'vi')) DESC, (d.locale = 'vi') DESC, d.created_at
  LIMIT 1
$$;
CREATE FUNCTION public._consent_active(p_uid uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_uid IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.consents c
   WHERE c.user_id = p_uid AND c.kind = p_kind AND c.withdrawn_at IS NULL
     AND c.version = public._consent_current_version(p_kind))
$$;
CREATE FUNCTION public._consent_has_pin(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.parental_pins p WHERE p.user_id = p_uid AND p.pin_hash IS NOT NULL)
$$;

-- 4) Client API.
-- Light check for API routes (true = the caller may use personal-data features).
CREATE FUNCTION public.consent_check() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public._consent_active(auth.uid(), 'parent_policy')
$$;

-- Current policy + the caller's state. The full text comes along when consent is
-- required (the gate shows it) or on request (Bố mẹ › Quyền riêng tư & dữ liệu).
CREATE FUNCTION public.consent_status(p_locale text DEFAULT 'vi', p_full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_doc public.consent_documents%ROWTYPE; v_acc public.consents%ROWTYPE;
 v_prev public.consents%ROWTYPE; v_required boolean; v_withdrawn timestamptz; v_history jsonb;
BEGIN
 IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 SELECT * INTO v_doc FROM public.consent_documents d WHERE d.id = public._consent_current_document('parent_policy', p_locale);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_document'); END IF;
 SELECT * INTO v_acc FROM public.consents c
  WHERE c.user_id = v_uid AND c.kind = 'parent_policy' AND c.withdrawn_at IS NULL AND c.version = v_doc.version
  ORDER BY c.accepted_at DESC LIMIT 1;
 v_required := NOT FOUND;
 IF v_required THEN
  SELECT * INTO v_prev FROM public.consents c
   WHERE c.user_id = v_uid AND c.kind = 'parent_policy' AND c.withdrawn_at IS NULL AND c.version < v_doc.version
   ORDER BY c.version DESC, c.accepted_at DESC LIMIT 1;
  SELECT max(c.withdrawn_at) INTO v_withdrawn FROM public.consents c WHERE c.user_id = v_uid AND c.kind = 'parent_policy';
 END IF;
 IF p_full THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'accepted_at', h.accepted_at, 'method', h.method,
    'withdrawn_at', h.withdrawn_at) ORDER BY h.accepted_at DESC), '[]'::jsonb) INTO v_history
   FROM (SELECT * FROM public.consents c WHERE c.user_id = v_uid AND c.kind = 'parent_policy' ORDER BY c.accepted_at DESC LIMIT 20) h;
 END IF;
 RETURN jsonb_build_object('ok', true, 'kind', 'parent_policy', 'required', v_required,
  'has_pin', public._consent_has_pin(v_uid),
  'document', jsonb_build_object('id', v_doc.id, 'version', v_doc.version, 'locale', v_doc.locale, 'title', v_doc.title,
    'summary', v_doc.summary, 'body_sha256', v_doc.body_sha256, 'published_at', v_doc.published_at)
    || CASE WHEN v_required OR p_full THEN jsonb_build_object('body', v_doc.body) ELSE '{}'::jsonb END,
  'accepted', CASE WHEN v_required THEN NULL
    ELSE jsonb_build_object('version', v_acc.version, 'accepted_at', v_acc.accepted_at, 'method', v_acc.method) END,
  'previous', CASE WHEN v_prev.id IS NULL THEN NULL
    ELSE jsonb_build_object('version', v_prev.version, 'accepted_at', v_prev.accepted_at) END,
  'withdrawn_at', v_withdrawn,
  'history', v_history);
END $$;

-- Accept exactly the version the parent saw (id + SHA-256). Idempotent.
CREATE FUNCTION public.consent_accept(p_document uuid, p_body_sha256 text, p_proof text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_uid uuid := auth.uid(); v_doc public.consent_documents%ROWTYPE; v_current integer;
 v_method text := 'account_holder'; v_ua text; v_row public.consents%ROWTYPE; v_already boolean := false;
BEGIN
 IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 SELECT * INTO v_doc FROM public.consent_documents d WHERE d.id = p_document AND d.published_at <= now();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
 v_current := public._consent_current_version(v_doc.kind);
 IF v_doc.version IS DISTINCT FROM v_current OR p_body_sha256 IS DISTINCT FROM v_doc.body_sha256 THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'current_version', v_current);
 END IF;
 IF public._consent_has_pin(v_uid) THEN
  IF public.parent_gate_check(p_proof) IS NULL THEN
   RETURN jsonb_build_object('ok', false, 'reason', 'parent_proof_required');
  END IF;
  v_method := 'parent_pin';
 END IF;
 BEGIN
  v_ua := left(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', 300);
 EXCEPTION WHEN others THEN v_ua := NULL;
 END;
 INSERT INTO public.consents(user_id, household_id, document_id, kind, version, body_sha256, method, user_agent)
  VALUES (v_uid, public.current_household_id(), v_doc.id, v_doc.kind, v_doc.version, v_doc.body_sha256, v_method, v_ua)
  ON CONFLICT (user_id, document_id) WHERE withdrawn_at IS NULL DO NOTHING
  RETURNING * INTO v_row;
 IF v_row.id IS NULL THEN
  v_already := true;
  SELECT * INTO v_row FROM public.consents c WHERE c.user_id = v_uid AND c.document_id = v_doc.id AND c.withdrawn_at IS NULL;
 END IF;
 RETURN jsonb_build_object('ok', true, 'already', v_already, 'version', v_row.version,
  'accepted_at', v_row.accepted_at, 'method', v_row.method);
END $$;

-- Withdraw every open consent of the kind. The app closes until the parent accepts again.
CREATE FUNCTION public.consent_withdraw(p_kind text DEFAULT 'parent_policy', p_proof text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_uid uuid := auth.uid(); v_method text := 'account_holder'; v_n integer;
BEGIN
 IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('parent_policy') THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_kind'); END IF;
 IF public._consent_has_pin(v_uid) THEN
  IF public.parent_gate_check(p_proof) IS NULL THEN
   RETURN jsonb_build_object('ok', false, 'reason', 'parent_proof_required');
  END IF;
  v_method := 'parent_pin';
 END IF;
 UPDATE public.consents SET withdrawn_at = now(), withdraw_method = v_method
  WHERE user_id = v_uid AND kind = p_kind AND withdrawn_at IS NULL;
 GET DIAGNOSTICS v_n = ROW_COUNT;
 RETURN jsonb_build_object('ok', true, 'withdrawn', v_n);
END $$;

-- 5) Paid processing (story / ai / tts / voice_clone / illustration, every route via
--    guardUsage) needs consent: consume_usage keeps its name and arguments, the
--    016 quota logic moves behind it unchanged.
ALTER FUNCTION public.consume_usage(text, integer, boolean) RENAME TO _consume_usage_quota;
REVOKE ALL ON FUNCTION public._consume_usage_quota(text, integer, boolean) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.consume_usage(p_kind text, p_amount integer DEFAULT 1, p_byo boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated'); END IF;
 -- Staff (admin roles) audition voices and build the platform catalogue in /admin, which
 -- the parent policy does not cover; their own family use is still gated in the app.
 IF NOT public._consent_active(auth.uid(), 'parent_policy') AND NOT public.is_staff() THEN
  RETURN jsonb_build_object('allowed', false, 'reason', 'consent_required');
 END IF;
 RETURN public._consume_usage_quota(p_kind, p_amount, p_byo);
END $$;

-- 6) Parent reminders (036) go only to families with a valid consent.
CREATE OR REPLACE FUNCTION public.parent_notify_claim(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_day date := public.missions_local_date(p_now); v_hour int := extract(hour FROM p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::int;
 v_out jsonb := '[]'::jsonb; r record; v_nights int;
BEGIN
 IF NOT public.feature_enabled('missions') THEN RETURN v_out; END IF;
 FOR r IN SELECT p.user_id FROM public.parent_notify_prefs p
   WHERE p.enabled AND p.hour = v_hour
    AND public._consent_active(p.user_id, 'parent_policy')
    AND EXISTS(SELECT 1 FROM public.parent_devices d WHERE d.user_id=p.user_id AND NOT EXISTS(SELECT 1 FROM public.push_subscriptions ps WHERE ps.endpoint=d.endpoint))
    AND NOT EXISTS(SELECT 1 FROM public.parent_notification_log l WHERE l.user_id=p.user_id AND l.local_date=v_day)
   ORDER BY p.user_id LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) LOOP
  INSERT INTO public.parent_notification_log(user_id, local_date, status) VALUES (r.user_id, v_day, 'queued') ON CONFLICT DO NOTHING;
  CONTINUE WHEN NOT FOUND;
  SELECT count(DISTINCT x.local_date) INTO v_nights FROM public.listen_sessions x
   WHERE x.user_id=r.user_id AND x.counted AND x.local_date BETWEEN public.missions_week_start(v_day) AND v_day;
  v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'date', v_day, 'title', 'Tuần của bé',
   'body', CASE WHEN v_nights = 0 THEN 'Tối nay cả nhà mình cùng đọc một truyện ngắn nhé?'
     ELSE 'Tuần này bé đã nghe truyện ' || v_nights || ' tối. Mở “Tuần của bé” để xem gợi ý trò chuyện.' END,
   'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth)), '[]'::jsonb)
     FROM public.parent_devices d WHERE d.user_id=r.user_id AND NOT EXISTS(SELECT 1 FROM public.push_subscriptions ps WHERE ps.endpoint=d.endpoint))));
 END LOOP;
 RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.consent_documents_guard(), public.consents_guard(), public._consent_current_version(text),
 public._consent_current_document(text, text), public._consent_active(uuid, text), public._consent_has_pin(uuid)
 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consent_check(), public.consent_status(text, boolean), public.consent_accept(uuid, text, text),
 public.consent_withdraw(text, text), public.consume_usage(text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consent_check(), public.consent_status(text, boolean), public.consent_accept(uuid, text, text),
 public.consent_withdraw(text, text), public.consume_usage(text, integer, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.parent_notify_claim(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_notify_claim(timestamptz, integer) TO service_role;

-- 7) Version 1 of the parent policy (Vietnamese). Honest description of what the
--    app does today; the legal review and store-ready text are T27 (a new version).
INSERT INTO public.consent_documents(kind, version, locale, title, summary, body) VALUES (
 'parent_policy', 1, 'vi', 'Chính sách quyền riêng tư cho bố mẹ',
 $kc_summary$- KểCon là ứng dụng để bố mẹ kể truyện cùng con. Tài khoản do bố mẹ hoặc người giám hộ tạo và quản lý.
- KểCon lưu những gì bố mẹ nhập và tạo trong app: thông tin tài khoản, tên và tuổi của bé, truyện, ảnh, giọng ghi âm, lịch sử nghe.
- Để tạo truyện, tranh và giọng đọc, phần nội dung cần thiết được gửi tới nhà cung cấp AI (như OpenAI, Google Gemini, Anthropic, CometAPI, OpenRouter, ElevenLabs, Fish Audio).
- Không quảng cáo, không bán dữ liệu, không dùng công cụ theo dõi của bên thứ ba.
- Bố mẹ xem lại chính sách, xuất hoặc xoá dữ liệu và rút đồng ý trong Bố mẹ › Quyền riêng tư & dữ liệu.$kc_summary$,
 $kc_body$## 1. Văn bản này là gì
Đây là bản 1 của chính sách quyền riêng tư dành cho bố mẹ dùng KểCon. Văn bản mô tả cách ứng dụng đang xử lý dữ liệu ở thời điểm phát hành. Khi cách xử lý thay đổi, KểCon phát hành bản mới và ứng dụng hỏi lại bố mẹ trước khi dùng tiếp. Các bản cũ vẫn được lưu để đối chiếu.

## 2. Ai dùng KểCon
- Tài khoản do người lớn (bố mẹ hoặc người giám hộ) tạo và quản lý. Bé dùng app cùng bố mẹ hoặc dưới sự trông nom của bố mẹ; bé không tự tạo tài khoản.
- Người bấm đồng ý xác nhận mình là bố mẹ hoặc người giám hộ của bé. Nếu đã đặt mã PIN phụ huynh, app yêu cầu nhập PIN trước khi ghi nhận đồng ý; nếu chưa có PIN, app hỏi một câu hỏi dành cho người lớn.

## 3. Dữ liệu KểCon lưu
- Tài khoản: email, thông tin đăng nhập (mật khẩu do hệ thống đăng nhập lưu dạng băm, hoặc đăng nhập bằng Google), tên hiển thị, tên gia đình, ảnh đại diện nếu bố mẹ tải lên.
- Về bé: tên gọi, tuổi hoặc nhóm tuổi và các lựa chọn bố mẹ nhập để cá nhân hoá truyện.
- Nội dung: truyện bố mẹ tạo hoặc tải lên; tranh vẽ hay ảnh trang sách khi dùng Vẽ truyện hoặc Chụp sách; bản ghi âm giọng bố mẹ hoặc người thân khi tạo giọng đọc của gia đình.
- Hoạt động trong app: truyện đã nghe, nhiệm vụ và thẻ sưu tầm, giới hạn thời gian dùng, mã PIN phụ huynh (chỉ lưu dạng băm).
- Kỹ thuật: thiết bị nhận thông báo (chỉ khi bố mẹ bật), sự kiện sử dụng để đo chất lượng sản phẩm, số lượt dùng tính năng AI để tính hạn mức và chống lạm dụng.
- Bằng chứng đồng ý: phiên bản chính sách, mã băm nội dung, thời điểm đồng ý hoặc rút đồng ý, cách xác nhận (mã PIN hoặc người giữ tài khoản) và thông tin trình duyệt (user agent). KểCon không lưu địa chỉ IP trong bằng chứng này.

## 4. KểCon dùng dữ liệu để làm gì
- Cung cấp tính năng: tạo và kể truyện, giọng đọc của gia đình, nhiệm vụ, nhắc bố mẹ.
- Bảo vệ tài khoản, giới hạn lượt dùng và ngăn lạm dụng.
- Đo chất lượng sản phẩm bằng số liệu tổng hợp, ví dụ bao nhiêu gia đình nghe hết một truyện.
- KểCon không hiển thị quảng cáo, không bán dữ liệu và không dùng dữ liệu của bé để lập hồ sơ quảng cáo.

## 5. Nhà cung cấp dịch vụ nhận dữ liệu
Chỉ phần dữ liệu cần cho từng yêu cầu được gửi đi:
- Tạo chữ và tranh bằng AI: tuỳ cấu hình hiện hành của KểCon, một trong các nhà cung cấp OpenAI, Anthropic, Google (Gemini), OpenRouter hoặc cổng tương thích OpenAI (hiện là CometAPI). Dữ liệu gửi đi là nội dung của yêu cầu: chủ đề, tên và tuổi của bé nếu bố mẹ đưa vào truyện, ảnh tranh vẽ hoặc trang sách khi dùng các tính năng đó.
- Giọng đọc: ElevenLabs hoặc Fish Audio nhận văn bản cần đọc; khi tạo giọng của gia đình, nhà cung cấp nhận bản ghi âm giọng nói.
- Nếu bố mẹ nhập API key riêng, yêu cầu được gửi tới nhà cung cấp đó bằng tài khoản của chính bố mẹ.
- Hạ tầng: cơ sở dữ liệu và file nằm trên máy chủ do KểCon vận hành; kết nối có thể đi qua Cloudflare; thông báo đẩy đi qua dịch vụ push của trình duyệt (Google, Mozilla, Apple); bản sao lưu nằm trong một kho riêng tư trên GitHub.
- Các nhà cung cấp này có thể đặt máy chủ ngoài Việt Nam và xử lý dữ liệu theo điều khoản của họ.

## 6. Lưu trữ bao lâu
- Tài khoản, truyện, ảnh và giọng ghi âm: lưu cho tới khi bố mẹ xoá.
- Sự kiện đo chất lượng tự xoá sau 90 ngày; sổ chi phí AI bỏ liên kết với tài khoản sau 90 ngày.
- Sao lưu chạy hằng ngày, giữ tối đa 7 bản theo ngày, 4 bản theo tuần và 6 bản theo tháng. Vì vậy dữ liệu đã xoá có thể còn trong bản sao lưu tối đa khoảng 6 tháng.
- Trong bản sao lưu, cơ sở dữ liệu (tài khoản, PIN đã băm, bằng chứng đồng ý…), giọng ghi âm và ảnh gia đình được mã hoá AES-256; chữ, tranh và audio của truyện, kể cả truyện của gia đình, được lưu dạng đọc được trong kho riêng tư đó.
- Giọng của gia đình đã tạo ở nhà cung cấp giọng nói được lưu ở đó cho tới khi bị xoá. Việc tự động xoá giọng ở nhà cung cấp khi bố mẹ rút đồng ý giọng nói sẽ có trong bản cập nhật về đồng ý giọng nói.

## 7. Quyền của bố mẹ
- Xem lại chính sách và lịch sử đồng ý trong Bố mẹ › Quyền riêng tư & dữ liệu.
- Xuất dữ liệu (tệp JSON) và xoá dữ liệu (truyện, giọng, người thân và lịch sử dùng để gợi ý truyện) ngay trong app.
- Rút đồng ý bất cứ lúc nào. Sau khi rút, máy chủ KểCon dừng các xử lý mới (tạo truyện, tranh và giọng đọc bằng AI; ghi sự kiện đo chất lượng; gửi nhắc bố mẹ; tạo link chia sẻ; tải ảnh đại diện) và app chỉ mở lại khi bố mẹ đồng ý lại. Dữ liệu đã lưu không tự xoá khi rút đồng ý; muốn xoá, bố mẹ dùng Xoá toàn bộ dữ liệu.
- App chưa có nút tự xoá hẳn tài khoản; bố mẹ liên hệ người quản trị KểCon để xoá tài khoản.

## 8. Bảo mật
- Kết nối được mã hoá (HTTPS); mỗi gia đình chỉ truy cập được dữ liệu của mình.
- Mã PIN phụ huynh và mật khẩu chỉ lưu dạng băm; API key của nhà cung cấp nằm trong kho bí mật được mã hoá.
- Nhân viên quản trị phải xác thực hai lớp; các thao tác quản trị quan trọng được ghi nhật ký.

## 9. An toàn cho trẻ
- Không quảng cáo, không trò chuyện với người lạ.
- Link chia sẻ truyện có hạn dùng và thu hồi được.
- Khu vực của bố mẹ (cài đặt, gói cước, chia sẻ) chỉ mở sau mã PIN hoặc câu hỏi dành cho người lớn.

## 10. Thay đổi và liên hệ
- Mỗi lần chính sách thay đổi, bản mới có số phiên bản mới; app hiện lại màn đồng ý và chỉ dùng tiếp khi bố mẹ đồng ý bản mới.
- Đây là bản dùng cho giai đoạn thử nghiệm. Điều khoản pháp lý đầy đủ (theo Luật Bảo vệ dữ liệu cá nhân và các quy định về trẻ em) sẽ được rà soát và phát hành ở bản sau.
- Câu hỏi về quyền riêng tư: liên hệ người quản trị KểCon đã mời gia đình dùng thử.$kc_body$);
