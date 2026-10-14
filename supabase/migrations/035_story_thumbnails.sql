-- PR #49 — Story thumbnails for Library/Home cards + admin settings for them.
-- A thumbnail is a small 3:2 WebP derived from the story's cover (or page art,
-- or an admin upload) in the public `illustrations` bucket at
-- <uploader uuid>/<story uuid>/thumb-<16 hex>.webp, a built-in scene thumbnail
-- (/scenes/v1/thumbs/<scene>.webp) or "icon" (topic icon on a soft tint).
-- Only server routes render thumbnails (sharp); the columns are shape-checked
-- so a row can never point outside its own story folder or at an unknown scene.

-- 1) Columns + shape checks (NULL source = "not generated yet").
ALTER TABLE public.stories
 ADD COLUMN thumbnail_path text,
 ADD COLUMN thumbnail_scene text,
 ADD COLUMN thumbnail_source text,
 ADD COLUMN thumbnail_updated_at timestamptz;
ALTER TABLE public.stories ADD CONSTRAINT story_thumbnail_path_shape CHECK (thumbnail_path IS NULL OR (
 thumbnail_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/thumb-[0-9a-f]{16}\.webp$'
 AND split_part(thumbnail_path,'/',2)=id::text));
ALTER TABLE public.stories ADD CONSTRAINT story_thumbnail_scene_known CHECK (thumbnail_scene IS NULL OR thumbnail_scene IN
 ('forest','forest-night','village','stream','beach','underwater','castle','space','bedroom','home','garden','snow','sky','rain','school','moon-festival','cave','campfire'));
ALTER TABLE public.stories ADD CONSTRAINT story_thumbnail_consistent CHECK (
 (thumbnail_source IS NULL AND thumbnail_path IS NULL AND thumbnail_scene IS NULL)
 OR (thumbnail_source IN ('cover','page','upload') AND thumbnail_path IS NOT NULL AND thumbnail_scene IS NULL)
 OR (thumbnail_source='scene' AND thumbnail_path IS NULL AND thumbnail_scene IS NOT NULL)
 OR (thumbnail_source='icon' AND thumbnail_path IS NULL AND thumbnail_scene IS NULL));

-- 2) The thumbnail follows the cover: a cover change that does not set a new
-- thumbnail in the same statement marks it "to regenerate" (never stale art).
CREATE FUNCTION public.story_thumbnail_follow_cover() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.cover_image_url IS DISTINCT FROM OLD.cover_image_url
  AND NEW.thumbnail_path IS NOT DISTINCT FROM OLD.thumbnail_path
  AND NEW.thumbnail_scene IS NOT DISTINCT FROM OLD.thumbnail_scene
  AND NEW.thumbnail_source IS NOT DISTINCT FROM OLD.thumbnail_source
  AND NEW.thumbnail_updated_at IS NOT DISTINCT FROM OLD.thumbnail_updated_at THEN
  NEW.thumbnail_path:=NULL; NEW.thumbnail_scene:=NULL; NEW.thumbnail_source:=NULL; NEW.thumbnail_updated_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.story_thumbnail_follow_cover() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER story_thumbnail_follow_cover BEFORE UPDATE OF cover_image_url ON public.stories
 FOR EACH ROW EXECUTE FUNCTION public.story_thumbnail_follow_cover();

-- 3) Admin settings (non-secret, category image, validated values).
INSERT INTO public.app_settings(key,value,label,category,is_secret) VALUES
 ('thumbnail_auto','true','Tự tạo thumbnail cho truyện','image',false),
 ('thumbnail_fallback','scene','Thumbnail khi truyện chưa có tranh','image',false),
 ('thumbnail_width','480','Chiều rộng thumbnail (px, tỉ lệ 3:2)','image',false),
 ('thumbnail_quality','72','Chất lượng WebP của thumbnail (60–90)','image',false)
ON CONFLICT(key) DO NOTHING;
ALTER TABLE public.app_settings ADD CONSTRAINT valid_thumbnail_setting CHECK (
 key NOT IN ('thumbnail_auto','thumbnail_fallback','thumbnail_width','thumbnail_quality')
 OR (is_secret IS FALSE AND category IS NOT NULL AND category='image' AND value IS NOT NULL AND CASE key
  WHEN 'thumbnail_auto' THEN value IN ('true','false')
  WHEN 'thumbnail_fallback' THEN value IN ('scene','icon')
  WHEN 'thumbnail_width' THEN value IN ('360','480','640')
  ELSE CASE WHEN value ~ '^[0-9]{2}$' THEN value::int BETWEEN 60 AND 90 ELSE false END END));

-- 4) Platform thumbnails/covers: one checked, audited statement per batch.
-- SECURITY INVOKER — RLS, the MFA platform-write guard and the staff audit
-- trigger all still apply; the optional reason lands in audit_logs.
CREATE FUNCTION public.admin_set_story_thumbnails(p_items jsonb, p_reason text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_item jsonb; v_n integer; v_count integer:=0; v_cover text;
BEGIN
 IF NOT public.has_permission('stories.write') THEN
  RAISE EXCEPTION 'Không có quyền ghi truyện nền tảng: phiên chưa xác thực hoặc đã hết hạn' USING ERRCODE='42501';
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Cần 1–200 truyện' USING ERRCODE='22023';
 END IF;
 IF p_reason IS NOT NULL THEN PERFORM set_config('app.admin_reason', public.admin_action_reason(p_reason), true); END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(v_item)<>'object' OR NOT (v_item ? 'id') OR NOT (v_item ? 'source') OR NOT (v_item ? 'expect_path') THEN
   RAISE EXCEPTION 'Mục thumbnail không hợp lệ' USING ERRCODE='22023';
  END IF;
  v_cover:=v_item->>'cover';
  IF v_cover IS NOT NULL AND (char_length(v_cover)>2048 OR v_cover !~ '^https?://') THEN
   RAISE EXCEPTION 'Ảnh bìa không hợp lệ' USING ERRCODE='22023';
  END IF;
  UPDATE public.stories SET
   thumbnail_source=v_item->>'source',
   thumbnail_path=v_item->>'path',
   thumbnail_scene=v_item->>'scene',
   thumbnail_updated_at=clock_timestamp(),
   cover_image_url=CASE WHEN v_item ? 'cover' THEN v_cover ELSE cover_image_url END
  WHERE id=(v_item->>'id')::uuid AND is_platform_content AND deleted_at IS NULL
   AND thumbnail_path IS NOT DISTINCT FROM (v_item->>'expect_path');
  GET DIAGNOSTICS v_n=ROW_COUNT;
  IF v_n<>1 THEN RAISE EXCEPTION 'Truyện đã thay đổi hoặc không phải truyện nền tảng — tải lại rồi thử lại' USING ERRCODE='40001'; END IF;
  v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_story_thumbnails(jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_story_thumbnails(jsonb,text) TO authenticated;

-- 5) Coverage for the admin card: platform per source, family as totals only.
CREATE FUNCTION public.admin_thumbnail_stats() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.has_permission('stories.read') THEN
  RAISE EXCEPTION 'Không có quyền xem truyện' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object(
  'platform', (SELECT jsonb_build_object(
    'total', count(*),
    'with_cover', count(*) FILTER (WHERE cover_image_url IS NOT NULL),
    'missing', count(*) FILTER (WHERE thumbnail_source IS NULL),
    'cover', count(*) FILTER (WHERE thumbnail_source='cover'),
    'page', count(*) FILTER (WHERE thumbnail_source='page'),
    'upload', count(*) FILTER (WHERE thumbnail_source='upload'),
    'scene', count(*) FILTER (WHERE thumbnail_source='scene'),
    'icon', count(*) FILTER (WHERE thumbnail_source='icon'))
   FROM public.stories WHERE is_platform_content AND deleted_at IS NULL),
  'family', (SELECT jsonb_build_object('total', count(*), 'missing', count(*) FILTER (WHERE thumbnail_source IS NULL))
   FROM public.stories WHERE NOT is_platform_content AND deleted_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.admin_thumbnail_stats() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_thumbnail_stats() TO authenticated;
