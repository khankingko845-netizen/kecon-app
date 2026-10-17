-- Private family photos: no public bucket or permanent public URL.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('family-avatars','family-avatars',false,1048576,ARRAY['image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=1048576,allowed_mime_types=ARRAY['image/webp'];
DROP POLICY IF EXISTS "Own family photos" ON storage.objects;
CREATE POLICY "Own family photos" ON storage.objects FOR ALL TO authenticated
USING(bucket_id='family-avatars' AND (storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK(bucket_id='family-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

-- All-or-nothing reorder for one language; rejects stale/incomplete/duplicate lists.
CREATE OR REPLACE FUNCTION public.reorder_default_voices(p_language text,p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF NOT public.has_permission('voices.manage') THEN RAISE EXCEPTION 'Không có quyền quản lý giọng' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.default_voices IN SHARE ROW EXCLUSIVE MODE;
 SELECT count(*) INTO n FROM public.default_voices WHERE language=p_language AND is_active;
 IF p_ids IS NULL OR cardinality(p_ids)<>n OR (SELECT count(DISTINCT id) FROM unnest(p_ids) AS t(id))<>n
 OR (SELECT count(*) FROM public.default_voices WHERE language=p_language AND is_active AND id=ANY(p_ids))<>n
 THEN RAISE EXCEPTION 'Danh sách giọng đã thay đổi hoặc không hợp lệ; tải lại trước khi sắp xếp' USING ERRCODE='22023'; END IF;
 UPDATE public.default_voices d SET sort_order=t.ordinality-1
 FROM unnest(p_ids) WITH ORDINALITY AS t(id,ordinality)
 WHERE d.id=t.id AND d.language=p_language AND d.sort_order<>t.ordinality-1;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.reorder_default_voices(text,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reorder_default_voices(text,uuid[]) TO authenticated;
-- Reordering is recorded by the existing immutable audit_default_voices trigger.
-- Rollback: DROP FUNCTION ...; keep the private bucket/data (never make existing photos public).
