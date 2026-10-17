-- T07: first-party milestones (no content/PII) and one row per outbound AI attempt.
CREATE TABLE public.analytics_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 event_name text NOT NULL CHECK(event_name IN ('signup','home_view','first_listen','story_created')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,event_name)
);
CREATE INDEX analytics_events_time ON public.analytics_events(created_at,event_name);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.analytics_events TO service_role;

CREATE TABLE public.ai_price_rates (
 provider text NOT NULL CHECK(provider IN ('openai','gemini','anthropic','custom','elevenlabs','fishaudio')),
 model text NOT NULL CHECK(model ~ '^[A-Za-z0-9_.:/-]{1,120}$'),
 kind text NOT NULL CHECK(kind IN ('llm','image','tts','clone','ambient')),
 input_per_million numeric(16,8) CHECK(input_per_million BETWEEN 0 AND 1000000),
 output_per_million numeric(16,8) CHECK(output_per_million BETWEEN 0 AND 1000000),
 unit_usd numeric(16,8) CHECK(unit_usd BETWEEN 0 AND 1000000),
 source text NOT NULL CHECK(length(source) BETWEEN 10 AND 240 AND source ~ '^https://[^?#[:space:]]+$'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,model,kind),
 CHECK((kind='llm' AND input_per_million IS NOT NULL AND output_per_million IS NOT NULL AND unit_usd IS NULL) OR (kind<>'llm' AND unit_usd IS NOT NULL AND input_per_million IS NULL AND output_per_million IS NULL))
);
ALTER TABLE public.ai_price_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_price_rates FROM anon,authenticated;
GRANT SELECT ON public.ai_price_rates TO authenticated;
GRANT ALL ON public.ai_price_rates TO service_role;
CREATE POLICY rates_read ON public.ai_price_rates FOR SELECT TO authenticated USING(public.has_permission('analytics.view') OR public.has_permission('settings.read'));

CREATE TABLE public.ai_cost_ledger (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL,
 user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 feature text NOT NULL CHECK(feature ~ '^[a-z_.-]{1,60}$'),
 provider text NOT NULL CHECK(provider IN ('openai','gemini','anthropic','custom','elevenlabs','fishaudio')),
 model text NOT NULL CHECK(model ~ '^[A-Za-z0-9_.:/-]{1,120}$'),
 kind text NOT NULL CHECK(kind IN ('llm','image','tts','clone','ambient')),
 payer text NOT NULL CHECK(payer IN ('platform','byo')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 input_tokens bigint CHECK(input_tokens BETWEEN 0 AND 1000000000),
 output_tokens bigint CHECK(output_tokens BETWEEN 0 AND 1000000000),
 units numeric(14,3) CHECK(units BETWEEN 0 AND 1000000000),
 estimated_usd numeric(20,8) CHECK(estimated_usd>=0),
 price_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 duration_ms bigint CHECK(duration_ms>=0),
 CHECK((status='pending' AND finished_at IS NULL AND estimated_usd IS NULL) OR (status<>'pending' AND finished_at IS NOT NULL)),
 CHECK(status<>'failed' OR estimated_usd IS NULL)
);
CREATE INDEX ai_cost_ledger_daily ON public.ai_cost_ledger(created_at,provider,feature);
ALTER TABLE public.ai_cost_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_cost_ledger FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.ai_cost_ledger TO service_role;
-- No client event/price/cost CRUD, including staff: only bounded RPCs expose aggregates.
CREATE FUNCTION public.record_measurement_event(p_event text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer; u uuid:=auth.uid();
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 IF p_event NOT IN ('home_view','first_listen') THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND role='user') THEN RETURN false; END IF;
 -- One lifetime milestone; time and actor come from DB, never the browser.
 INSERT INTO public.analytics_events(user_id,event_name) VALUES(u,p_event) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.record_measurement_event(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_measurement_event(text) TO authenticated;

CREATE FUNCTION public.measurement_milestone_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='profiles' THEN
  INSERT INTO public.analytics_events(user_id,event_name) VALUES(NEW.id,'signup') ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='stories' AND NEW.user_id IS NOT NULL AND NOT NEW.is_platform_content THEN
  INSERT INTO public.analytics_events(user_id,event_name) VALUES(NEW.user_id,'story_created') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.measurement_milestone_trigger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER measurement_signup AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.measurement_milestone_trigger();
CREATE TRIGGER measurement_story AFTER INSERT ON public.stories FOR EACH ROW EXECUTE FUNCTION public.measurement_milestone_trigger();

CREATE FUNCTION public.set_ai_price(p_provider text,p_model text,p_kind text,p_input numeric,p_output numeric,p_unit numeric,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
 IF NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(r) INTO prev FROM public.ai_price_rates r WHERE provider=p_provider AND model=p_model AND kind=p_kind FOR UPDATE;
 INSERT INTO public.ai_price_rates(provider,model,kind,input_per_million,output_per_million,unit_usd,source)
 VALUES(p_provider,p_model,p_kind,p_input,p_output,p_unit,p_source)
 ON CONFLICT(provider,model,kind) DO UPDATE SET input_per_million=p_input,output_per_million=p_output,unit_usd=p_unit,source=p_source,updated_at=now();
 SELECT to_jsonb(r) INTO nxt FROM public.ai_price_rates r WHERE provider=p_provider AND model=p_model AND kind=p_kind;

END $$;
REVOKE ALL ON FUNCTION public.set_ai_price(text,text,text,numeric,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_ai_price(text,text,text,numeric,numeric,numeric,text) TO authenticated;

CREATE FUNCTION public.measurement_summary(p_days integer DEFAULT 14) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE since timestamptz; costs jsonb; funnel jsonb; totals jsonb;
BEGIN
 IF NOT public.has_permission('analytics.view') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
 PERFORM public.prune_measurement();
 -- UTC calendar days, including today, not a rolling partial first day.
 since:=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-make_interval(days=>p_days-1);
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.day DESC,d.provider,d.feature),'[]') INTO costs FROM (
 SELECT (created_at AT TIME ZONE 'UTC')::date AS day,provider,feature,count(*) AS attempts,
 count(*) FILTER(WHERE status='succeeded') AS succeeded,count(*) FILTER(WHERE status='failed') AS failed,
 count(*) FILTER(WHERE status='pending') AS pending,
 sum(estimated_usd) FILTER(WHERE payer='platform') AS estimated_usd,
 count(*) FILTER(WHERE payer='platform' AND estimated_usd IS NULL) AS unknown_cost,
 count(*) FILTER(WHERE payer='byo') AS byo_attempts,
 coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens
 FROM public.ai_cost_ledger WHERE created_at>=since GROUP BY 1,2,3) d;
 SELECT jsonb_build_object('attempts',count(*),'estimated_usd',sum(estimated_usd) FILTER(WHERE payer='platform'),
 'unknown_cost',count(*) FILTER(WHERE payer='platform' AND estimated_usd IS NULL),'pending',count(*) FILTER(WHERE status='pending'),'byo_attempts',count(*) FILTER(WHERE payer='byo'))
 INTO totals FROM public.ai_cost_ledger WHERE created_at>=since;
 SELECT jsonb_build_object('signup',count(*),'home_view',count(*) FILTER(WHERE home>=signup),
 'first_listen',count(*) FILTER(WHERE home>=signup AND listen>=home),
 'story_created',count(*) FILTER(WHERE home>=signup AND story>=home)) INTO funnel FROM (
 SELECT s.user_id,s.created_at signup,
 (SELECT created_at FROM public.analytics_events e WHERE e.user_id=s.user_id AND event_name='home_view') home,
 (SELECT created_at FROM public.analytics_events e WHERE e.user_id=s.user_id AND event_name='first_listen') listen,
 (SELECT created_at FROM public.analytics_events e WHERE e.user_id=s.user_id AND event_name='story_created') story
 FROM public.analytics_events s JOIN public.profiles p ON p.id=s.user_id AND p.role='user'
 WHERE s.event_name='signup' AND s.created_at>=since) f;
 RETURN jsonb_build_object('days',p_days,'since',since,'timezone','UTC','costs',costs,'totals',totals,'funnel',funnel);
END $$;
REVOKE ALL ON FUNCTION public.measurement_summary(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.measurement_summary(integer) TO authenticated;

CREATE FUNCTION public.audit_ai_price_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.audit_write('pricing.update','pricing',NEW.provider||':'||NEW.model||':'||NEW.kind,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),NULL,NULL,NULL,'db');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_ai_price_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_ai_price_rates AFTER INSERT OR UPDATE ON public.ai_price_rates FOR EACH ROW EXECUTE FUNCTION public.audit_ai_price_change();

CREATE FUNCTION public.prune_measurement() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM public.analytics_events WHERE created_at<now()-interval '90 days';
 UPDATE public.ai_cost_ledger SET user_id=NULL WHERE user_id IS NOT NULL AND created_at<now()-interval '90 days';
 DELETE FROM public.ai_cost_ledger WHERE created_at<now()-interval '365 days';
END $$;
REVOKE ALL ON FUNCTION public.prune_measurement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prune_measurement() TO service_role;
