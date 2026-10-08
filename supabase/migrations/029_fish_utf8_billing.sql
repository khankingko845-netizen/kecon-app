-- R-01: Fish TTS submitted text is billed in UTF-8 bytes, not characters.
-- Expand-only: no historical ledger/rate UPDATE, no price seed, no guessed backfill.
ALTER TABLE public.ai_price_rates
 ADD COLUMN billing_unit text,
 ADD COLUMN price_version integer NOT NULL DEFAULT 1;
-- Per-byte rates need precision; existing numeric values are unchanged.
ALTER TABLE public.ai_price_rates ALTER COLUMN unit_usd TYPE numeric(24,12);
ALTER TABLE public.ai_price_rates ADD CONSTRAINT ai_price_unit_version CHECK (
 (price_version=1 AND billing_unit IS NULL) OR
 (price_version=2 AND provider='fishaudio' AND kind='tts' AND billing_unit='utf8_bytes' AND billing_unit IS NOT NULL)
);
ALTER TABLE public.ai_cost_ledger
 ADD COLUMN billing_unit text,
 ADD COLUMN usage_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.ai_cost_ledger ADD CONSTRAINT ai_usage_unit_version CHECK (
 (usage_version=1 AND billing_unit IS NULL) OR
 (usage_version=2 AND provider='fishaudio' AND kind='tts' AND billing_unit='utf8_bytes' AND billing_unit IS NOT NULL AND units IS NOT NULL AND units=trunc(units))
);
ALTER TABLE public.ai_cost_ledger ADD CONSTRAINT ai_fish_cost_version CHECK (
 usage_version<>2 OR estimated_usd IS NULL OR coalesce(
 price_snapshot->>'billing_unit'='utf8_bytes' AND price_snapshot->>'price_version'='2',false)
);

CREATE OR REPLACE FUNCTION public.set_ai_price(p_provider text,p_model text,p_kind text,p_input numeric,p_output numeric,p_unit numeric,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
 IF NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_provider='fishaudio' THEN RAISE EXCEPTION 'Fish requires explicit UTF-8 byte pricing v2' USING ERRCODE='22023'; END IF;
 SELECT to_jsonb(r) INTO prev FROM public.ai_price_rates r WHERE provider=p_provider AND model=p_model AND kind=p_kind FOR UPDATE;
 INSERT INTO public.ai_price_rates(provider,model,kind,input_per_million,output_per_million,unit_usd,source)
 VALUES(p_provider,p_model,p_kind,p_input,p_output,p_unit,p_source)
 ON CONFLICT(provider,model,kind) DO UPDATE SET input_per_million=p_input,output_per_million=p_output,unit_usd=p_unit,source=p_source,updated_at=now();
 SELECT to_jsonb(r) INTO nxt FROM public.ai_price_rates r WHERE provider=p_provider AND model=p_model AND kind=p_kind;

END $$;
REVOKE ALL ON FUNCTION public.set_ai_price(text,text,text,numeric,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_ai_price(text,text,text,numeric,numeric,numeric,text) TO authenticated;

-- Old callers may still set non-Fish prices; old Fish writes are rejected.
CREATE FUNCTION public.set_ai_price_v2(p_provider text,p_model text,p_kind text,p_input numeric,p_output numeric,p_unit numeric,p_source text,p_billing_unit text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_provider='fishaudio' THEN
  IF p_kind IS DISTINCT FROM 'tts' OR p_billing_unit IS DISTINCT FROM 'utf8_bytes' THEN
   RAISE EXCEPTION 'Fish requires UTF-8 byte pricing' USING ERRCODE='22023';
  END IF;
  IF p_unit IS NOT NULL AND p_unit<>round(p_unit,12) THEN
   RAISE EXCEPTION 'Price precision exceeds supported unit' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.ai_price_rates(provider,model,kind,input_per_million,output_per_million,unit_usd,source,billing_unit,price_version)
  VALUES(p_provider,p_model,p_kind,p_input,p_output,p_unit,p_source,p_billing_unit,2)
  ON CONFLICT(provider,model,kind) DO UPDATE SET input_per_million=p_input,output_per_million=p_output,unit_usd=p_unit,source=p_source,billing_unit=p_billing_unit,price_version=2,updated_at=now();
 ELSE
  IF p_billing_unit IS NOT NULL THEN RAISE EXCEPTION 'Invalid provider billing unit' USING ERRCODE='22023'; END IF;
  PERFORM public.set_ai_price(p_provider,p_model,p_kind,p_input,p_output,p_unit,p_source);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_ai_price_v2(text,text,text,numeric,numeric,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_ai_price_v2(text,text,text,numeric,numeric,numeric,text,text) TO authenticated;

-- Keep raw historical estimates/snapshots intact, but exclude incompatible Fish
-- estimates from aggregates. NULL is unknown; an explicit compatible zero is zero.
CREATE FUNCTION public.effective_ai_cost(r public.ai_cost_ledger) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN r.provider='fishaudio' AND r.kind='tts' THEN
  CASE WHEN r.usage_version=2 AND r.billing_unit='utf8_bytes'
   AND r.price_snapshot->>'billing_unit'='utf8_bytes' AND r.price_snapshot->>'price_version'='2'
   THEN r.estimated_usd ELSE NULL END
 ELSE r.estimated_usd END
$$;
REVOKE ALL ON FUNCTION public.effective_ai_cost(public.ai_cost_ledger) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.effective_ai_cost(public.ai_cost_ledger) TO service_role;

CREATE OR REPLACE FUNCTION public.measurement_summary(p_days integer DEFAULT 14) RETURNS jsonb
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
 sum(public.effective_ai_cost(ai_cost_ledger)) FILTER(WHERE payer='platform') AS estimated_usd,
 count(*) FILTER(WHERE payer='platform' AND public.effective_ai_cost(ai_cost_ledger) IS NULL) AS unknown_cost,
 count(*) FILTER(WHERE payer='byo') AS byo_attempts,
 coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,
 count(*) FILTER(WHERE payer='platform' AND provider='fishaudio' AND kind='tts' AND usage_version=1) AS legacy_unit_attempts
 FROM public.ai_cost_ledger WHERE created_at>=since GROUP BY 1,2,3) d;
 SELECT jsonb_build_object('attempts',count(*),'estimated_usd',sum(public.effective_ai_cost(ai_cost_ledger)) FILTER(WHERE payer='platform'),
 'unknown_cost',count(*) FILTER(WHERE payer='platform' AND public.effective_ai_cost(ai_cost_ledger) IS NULL),'pending',count(*) FILTER(WHERE status='pending'),'byo_attempts',count(*) FILTER(WHERE payer='byo'),
 'legacy_unit_attempts',count(*) FILTER(WHERE payer='platform' AND provider='fishaudio' AND kind='tts' AND usage_version=1))
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

