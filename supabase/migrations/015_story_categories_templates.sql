-- Migration 015: Story Categories (dynamic) + Seed Story Templates
-- ================================================================

-- 1. Dynamic categories table (replaces hardcoded list)
CREATE TABLE IF NOT EXISTS public.story_categories (
  id TEXT PRIMARY KEY,                       -- e.g. 'fairy_tale', 'adventure'
  label TEXT NOT NULL,                       -- Vietnamese display name
  emoji TEXT NOT NULL DEFAULT '📖',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  parent_id TEXT REFERENCES public.story_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.story_categories ENABLE ROW LEVEL SECURITY;

-- Everyone can read categories
CREATE POLICY "Anyone can read categories"
  ON public.story_categories FOR SELECT USING (true);

-- Only admins can manage
CREATE POLICY "Admins manage categories"
  ON public.story_categories FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

-- 2. Seed default categories
INSERT INTO public.story_categories (id, label, emoji, description, sort_order) VALUES
  ('fairy_tale',    'Cổ tích',           '🏰', 'Truyện cổ tích Việt Nam và thế giới',       1),
  ('adventure',     'Phiêu lưu',         '🗺️', 'Hành trình khám phá và phiêu lưu',          2),
  ('bedtime',       'Ru ngủ',            '🌙', 'Truyện nhẹ nhàng trước giờ ngủ',            3),
  ('animal',        'Động vật',          '🐾', 'Câu chuyện về các loài động vật',           4),
  ('educational',   'Học chơi',          '📚', 'Vừa học vừa chơi, phát triển tư duy',       5),
  ('moral',         'Đạo đức',           '💛', 'Bài học cuộc sống và đạo đức',              6),
  ('family',        'Gia đình',          '👨‍👩‍👧‍👦', 'Tình cảm gia đình, tình bạn',              7),
  ('science',       'Khoa học',          '🔬', 'Khám phá khoa học cho bé',                  8),
  ('folklore',      'Truyền thuyết',     '🐉', 'Truyền thuyết, thần thoại Việt Nam',        9),
  ('humor',         'Hài hước',          '😂', 'Câu chuyện vui nhộn cho bé cười',          10),
  ('music',         'Âm nhạc',           '🎵', 'Truyện kết hợp bài hát, vần điệu',        11),
  ('nature',        'Thiên nhiên',       '🌿', 'Khám phá thiên nhiên và môi trường',       12),
  ('history',       'Lịch sử',           '📜', 'Nhân vật và sự kiện lịch sử Việt Nam',     13),
  ('emotion',       'Cảm xúc',           '🫂', 'Giúp bé hiểu và quản lý cảm xúc',         14),
  ('imagination',   'Tưởng tượng',       '✨', 'Thế giới kỳ diệu và tưởng tượng',         15),
  ('custom',        'Khác',              '📝', 'Truyện tùy chỉnh',                         99)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, emoji = EXCLUDED.emoji, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- 3. Add columns to story_templates if missing
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '📖';
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS age_min INTEGER DEFAULT 0;
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS age_max INTEGER DEFAULT 12;
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS moral_lesson TEXT;
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'vi';
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.story_templates ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;

-- 4. Allow public to read active templates
DROP POLICY IF EXISTS "Public can read active templates" ON public.story_templates;
CREATE POLICY "Public can read active templates"
  ON public.story_templates FOR SELECT USING (is_active = true);

-- 5. Seed 80+ story templates across categories
INSERT INTO public.story_templates (title, description, category, emoji, age_min, age_max, moral_lesson, tags, locale, sort_order, pages) VALUES

-- === CỔ TÍCH (fairy_tale) ===
('Sọ Dừa', 'Chàng trai xấu xí nhưng tài giỏi và tấm lòng nhân hậu', 'fairy_tale', '🥥', 3, 8, 'Đừng đánh giá người khác qua vẻ bề ngoài', '{"cổ tích Việt Nam","nhân hậu"}', 'vi', 1,
 '[{"content":"Ngày xưa có đôi vợ chồng nghèo hiếm muộn. Một hôm bà vợ đi rừng, uống nước trong sọ dừa bên đường rồi có mang.","scene_description":"Túp lều tranh bên rừng xanh"},{"content":"Bà sinh ra một đứa bé tròn lông lốc, không chân không tay, giống hệt trái dừa. Hai vợ chồng buồn lắm nhưng vẫn yêu thương nuôi nấng.","scene_description":"Túp lều tranh, nôi em bé"},{"content":"Sọ Dừa lớn lên thông minh, biết nói biết cười. Cậu xin mẹ dẫn đi chăn bò cho phú ông. Bò của cậu con nào cũng béo tốt.","scene_description":"Đồng cỏ xanh, đàn bò béo tốt"},{"content":"Ba cô con gái phú ông, chỉ có cô Út là tốt bụng, mang cơm cho Sọ Dừa. Sọ Dừa thổi sáo rất hay dưới trăng.","scene_description":"Ánh trăng, tiếng sáo du dương"},{"content":"Sọ Dừa lột xác thành chàng trai tuấn tú. Chàng cưới cô Út, thi đỗ trạng nguyên, cả nhà sống hạnh phúc.","scene_description":"Đám cưới rực rỡ, cung điện"}]'),

('Tấm Cám', 'Câu chuyện về lòng hiền lành chiến thắng sự độc ác', 'fairy_tale', '👗', 4, 10, 'Ở hiền gặp lành, ở ác gặp ác', '{"cổ tích Việt Nam","công bằng"}', 'vi', 2,
 '[{"content":"Tấm mồ côi mẹ, sống với dì ghẻ và Cám. Ngày nào cũng bị bắt làm việc nặng nhọc.","scene_description":"Nhà tranh, cô gái nhỏ quét sân"},{"content":"Một hôm đi bắt tôm, Cám lừa lấy hết giỏ tôm của Tấm. Tấm khóc, ông Bụt hiện lên an ủi và cho cá bống.","scene_description":"Ao sen, ông Bụt hiện ra"},{"content":"Nhờ phép Bụt, Tấm có quần áo đẹp đi dự hội. Vua nhặt được chiếc hài, tìm đến tận nhà.","scene_description":"Lễ hội đèn lồng lung linh"},{"content":"Tấm được vua chọn làm hoàng hậu. Từ đó nàng sống hạnh phúc trong cung.","scene_description":"Cung điện hoàng gia"}]'),

('Cây Tre Trăm Đốt', 'Anh nông dân thật thà được Bụt giúp đỡ', 'fairy_tale', '🎋', 3, 8, 'Thật thà là đức tính quý', '{"cổ tích Việt Nam","thật thà"}', 'vi', 3,
 '[{"content":"Ngày xưa có anh nông dân tên Khoai, hiền lành chăm chỉ, làm thuê cho phú ông. Phú ông hứa gả con gái nếu tìm được cây tre trăm đốt.","scene_description":"Cánh đồng lúa, anh nông dân"},{"content":"Khoai vào rừng tìm mãi mà không thấy cây tre nào đủ trăm đốt. Chàng ngồi khóc, ông Bụt hiện lên.","scene_description":"Rừng tre xanh mát"},{"content":"Bụt bảo: \"Hãy nhặt các đốt tre rời rồi đọc: Khắc nhập khắc nhập.\" Khoai làm theo, các đốt tre liền dính vào nhau thành cây tre trăm đốt.","scene_description":"Ánh sáng kỳ diệu, tre dính lại"},{"content":"Phú ông định nuốt lời nhưng Khoai đọc \"Khắc nhập\" – tre dính vào lưng phú ông. Ông ta phải giữ lời hứa, Khoai cưới được vợ.","scene_description":"Đám cưới vui nhộn"}]'),

('Thạch Sanh', 'Chàng dũng sĩ diệt chằn tinh cứu công chúa', 'fairy_tale', '⚔️', 4, 10, 'Dũng cảm và chính nghĩa luôn chiến thắng', '{"cổ tích Việt Nam","dũng cảm"}', 'vi', 4,
 '[{"content":"Thạch Sanh mồ côi, sống dưới gốc đa, được thần tiên dạy võ nghệ. Một đêm, Lý Thông lừa chàng đi canh miếu thay.","scene_description":"Gốc đa cổ thụ, ánh trăng"},{"content":"Chằn tinh đến, Thạch Sanh dũng cảm chiến đấu, chém chết nó. Lý Thông cướp công, được vua thưởng.","scene_description":"Trận chiến ác liệt với quái vật"},{"content":"Công chúa bị đại bàng bắt xuống hang sâu. Thạch Sanh cầm cung thần bắn đại bàng, cứu công chúa.","scene_description":"Hang động sâu, ánh sáng cung thần"},{"content":"Sự thật phơi bày, Lý Thông bị trừng phạt. Thạch Sanh cưới công chúa, đánh cây đàn thần mời quân giặc bữa cơm – giặc cảm phục quy hàng.","scene_description":"Cung điện, tiệc hòa bình"}]'),

('Chú Cuội Cung Trăng', 'Chú Cuội bay lên cung trăng cùng cây đa', 'fairy_tale', '🌕', 3, 7, 'Hãy biết quý trọng những gì mình có', '{"cổ tích Việt Nam","trung thu"}', 'vi', 5,
 '[{"content":"Ngày xưa có chú tiều phu tên Cuội tìm được cây thuốc thần chữa bách bệnh. Chú trồng cây đa trước nhà.","scene_description":"Rừng cây, cây đa thần"},{"content":"Cuội dặn vợ: Đừng tưới cây bằng nước bẩn! Nhưng vợ Cuội vô tình quên, tưới nhầm nước bẩn.","scene_description":"Sân nhà, cây đa to"},{"content":"Cây đa bật gốc, từ từ bay lên trời. Cuội vội ôm lấy gốc cây nhưng không kịp nhả tay, bay theo lên tận cung trăng.","scene_description":"Cây đa bay lên trời, trăng tròn"},{"content":"Từ đó mỗi đêm trăng tròn, các bạn nhỏ nhìn lên thấy chú Cuội ngồi dưới gốc đa, mơ về quê nhà.","scene_description":"Trăng rằm sáng, bóng chú Cuội"}]'),

-- === PHIÊU LƯU (adventure) ===
('Hành Trình Đến Đảo Rồng', 'Hai anh em vượt biển tìm viên ngọc rồng huyền thoại', 'adventure', '🐉', 5, 10, 'Đoàn kết và kiên trì sẽ vượt qua mọi thử thách', '{"phiêu lưu","biển","rồng"}', 'vi', 1,
 '[{"content":"An và Bình là hai anh em sống ở làng chài. Nghe ông nội kể về Đảo Rồng nơi có viên ngọc ban sức mạnh, hai anh em quyết tâm lên đường.","scene_description":"Làng chài, hoàng hôn biển"},{"content":"Hai anh em đóng thuyền, vượt qua cơn bão lớn. Khi tỉnh dậy, họ thấy mình trôi dạt đến hòn đảo đầy hoa kỳ lạ.","scene_description":"Bão biển dữ dội, thuyền nhỏ"},{"content":"Trên đảo, một con rồng nhỏ bị thương. An và Bình chữa trị cho rồng. Rồng con cảm động, dẫn đường đến hang rồng mẹ.","scene_description":"Đảo rồng, rồng con dễ thương"},{"content":"Rồng mẹ thử thách: ai biết chia sẻ mới xứng đáng có ngọc. An chia nửa phần ăn cuối cùng cho em. Rồng mẹ trao ngọc – nhưng viên ngọc chính là tình anh em.","scene_description":"Hang rồng lấp lánh, rồng mẹ"}]'),

('Khu Rừng Thần Kỳ', 'Bé Minh lạc vào khu rừng nơi cây cối biết nói', 'adventure', '🌳', 3, 7, 'Yêu quý thiên nhiên và bảo vệ môi trường', '{"phiêu lưu","thiên nhiên","kỳ diệu"}', 'vi', 2,
 '[{"content":"Bé Minh đang chơi trong vườn thì phát hiện một lối mòn kỳ lạ phát sáng xanh. Tò mò, bé bước theo ánh sáng.","scene_description":"Lối mòn phát sáng xanh trong vườn"},{"content":"Minh bước vào khu rừng thần kỳ – cây cối biết nói! Cây sồi già nói: \"Chào mừng bé đến Rừng Xanh Kỳ Diệu!\"","scene_description":"Rừng cây cổ thụ, khuôn mặt cười"},{"content":"Rừng đang buồn vì thiếu nước. Minh giúp hươu cao cổ tìm suối nguồn bị tảng đá chặn. Thỏ, sóc cùng giúp đẩy đá.","scene_description":"Suối nguồn, các con vật cùng giúp"},{"content":"Nước chảy trở lại! Rừng nở hoa rực rỡ. Cây sồi tặng Minh hạt giống kỳ diệu: \"Hãy trồng nó ở nhà, rừng sẽ luôn bên con.\"","scene_description":"Rừng nở hoa rực rỡ khắp nơi"}]'),

('Phi Hành Gia Nhí', 'Bé Linh bay lên vũ trụ khám phá các hành tinh', 'adventure', '🚀', 4, 9, 'Tò mò và ham học hỏi giúp khám phá thế giới', '{"phiêu lưu","vũ trụ","khoa học"}', 'vi', 3,
 '[{"content":"Bé Linh mơ ước được bay lên vũ trụ. Sinh nhật, Linh nhận được tàu vũ trụ đồ chơi – bỗng nhiên nó phát sáng và to ra thật!","scene_description":"Phòng ngủ, tàu vũ trụ phát sáng"},{"content":"Linh bay qua Mặt Trăng – lủng lẳng nhảy trong trọng lực thấp. Gặp một chú robot thân thiện tên Tí Bo giới thiệu các hành tinh.","scene_description":"Mặt trăng, robot nhỏ dễ thương"},{"content":"Tới Sao Hỏa đỏ rực, Linh trồng cây xanh đầu tiên. Qua Sao Mộc khổng lồ, bé thấy cơn bão lớn bằng cả Trái Đất!","scene_description":"Sao Hỏa đỏ, cây xanh nhỏ"},{"content":"Về Trái Đất, Linh nhìn qua cửa sổ tàu – quê hương xanh đẹp nhất. \"Con sẽ bảo vệ Trái Đất của mình!\" Tí Bo vẫy tay tạm biệt.","scene_description":"Trái đất xanh từ vũ trụ"}]'),

-- === RU NGỦ (bedtime) ===
('Giấc Mơ Trên Mây', 'Bé Sao theo đám mây bông bay vào giấc ngủ êm', 'bedtime', '☁️', 1, 5, 'Giấc ngủ ngon giúp bé lớn khôn', '{"ru ngủ","nhẹ nhàng","mây"}', 'vi', 1,
 '[{"content":"Trời tối rồi, sao lấp lánh. Bé Sao nằm trên giường, ôm gấu bông nhìn qua cửa sổ. Một đám mây bông trắng bay tới.","scene_description":"Phòng ngủ ấm áp, trăng sao"},{"content":"\"Lên đây nào!\" Mây bông nhẹ nhàng đưa bé bay qua bầu trời đêm. Gió thì thầm hát ru.","scene_description":"Bay trên mây, trời sao lấp lánh"},{"content":"Bé thấy bạn thỏ đang ngủ trong ổ lá, bạn chim non nép vào cánh mẹ, cá nhỏ ru nhau dưới hồ sen.","scene_description":"Các bạn nhỏ đang ngủ yên bình"},{"content":"Mây bông đặt bé nhẹ nhàng xuống giường. \"Ngủ ngon nhé, mai lại có chuyến phiêu lưu mới.\" Bé mỉm cười, nhắm mắt...","scene_description":"Giường êm, ánh trăng dịu"}]'),

('Bài Hát Của Dế', 'Dế mèn hát bài ru ngủ cho cả khu vườn', 'bedtime', '🦗', 1, 5, 'Âm nhạc mang đến sự bình yên', '{"ru ngủ","âm nhạc","vườn"}', 'vi', 2,
 '[{"content":"Trong khu vườn nhỏ, khi mặt trời lặn, dế mèn Ri Ri lấy đàn ra. Đêm nay là phiên Ri Ri hát ru cho cả vườn.","scene_description":"Khu vườn lúc hoàng hôn, dế nhỏ"},{"content":"\"Tình tình tính... ngủ đi nào...\" Bông hoa cúc gật gù, nhắm cánh. Bướm nhỏ đậu trên lá, khép đôi cánh lại.","scene_description":"Hoa cúc nhắm cánh, bướm ngủ"},{"content":"Cóc con ngáp một cái, cuộn tròn bên viên đá. Ốc sên thụt vào vỏ. Cả khu vườn yên tĩnh dần.","scene_description":"Khu vườn yên bình đêm trăng"},{"content":"Ri Ri hát nhỏ dần... nhỏ dần... Bé cũng nhắm mắt theo nhịp đàn dịu dàng. Chúc bé ngủ ngon!","scene_description":"Đêm trăng, tiếng đàn nhỏ dần"}]'),

('Ngôi Sao Nhỏ', 'Ngôi sao rơi xuống vườn nhà bé, cần được đưa về trời', 'bedtime', '⭐', 2, 6, 'Giúp đỡ bạn bè là niềm vui', '{"ru ngủ","sao","kỳ diệu"}', 'vi', 3,
 '[{"content":"Bé Mây thấy một vệt sáng rơi xuống vườn. Chạy ra xem – một ngôi sao nhỏ đang run rẩy trên cỏ, nhấp nháy yếu ớt.","scene_description":"Vườn đêm, ngôi sao nhỏ phát sáng"},{"content":"\"Mình bị rơi, nhớ các bạn sao lắm,\" ngôi sao thì thầm. Bé Mây ôm sao vào lòng: \"Mình sẽ giúp bạn về nhà!\"","scene_description":"Bé ôm ngôi sao ấm áp"},{"content":"Bé hát một bài ru – ngôi sao sáng dần lên. Sáng hơn, sáng hơn nữa... rồi nhẹ nhàng bay lên cao.","scene_description":"Ngôi sao bay lên bầu trời đêm"},{"content":"Lên đến trời, ngôi sao nhấp nháy ba cái – tạm biệt bé Mây. Mỗi đêm, bé nhìn lên sẽ thấy ngôi sao sáng nhất nháy cho mình.","scene_description":"Bầu trời đầy sao, một sao sáng nhất"}]'),

-- === ĐỘNG VẬT (animal) ===
('Chú Voi Biết Bay', 'Chú voi con mơ ước bay như chim nhưng tìm ra tài năng thật', 'animal', '🐘', 3, 7, 'Mỗi người đều có tài năng riêng', '{"động vật","tự tin","tài năng"}', 'vi', 1,
 '[{"content":"Voi con Pon ước mơ bay như chim. Pon thử nhảy từ đồi cao nhưng rơi bịch xuống. Các bạn cười: \"Voi mà bay sao được!\"","scene_description":"Đồi cỏ, voi con nhảy vui"},{"content":"Pon buồn lắm. Cú mèo già bảo: \"Không phải ai cũng bay được, nhưng ai cũng có điều đặc biệt. Hãy tìm tài năng của mình.\"","scene_description":"Đêm trăng, cú mèo trên cành"},{"content":"Mùa mưa, suối tràn ngập đường. Các bạn nhỏ kẹt bên này bờ. Pon lội xuống – nước chỉ tới bụng! Pon cõng từng bạn qua suối.","scene_description":"Suối nước, voi cõng bạn qua"},{"content":"Mọi người reo hò: \"Pon là người hùng!\" Pon hiểu ra: không cần bay, mình đã có sức mạnh giúp mọi người. Đó mới là tuyệt vời nhất!","scene_description":"Bạn bè vui mừng ôm voi"}]'),

('Cuộc Đua Của Rùa', 'Rùa nhỏ chậm mà chắc, không bỏ cuộc', 'animal', '🐢', 3, 7, 'Kiên trì và không bỏ cuộc', '{"động vật","kiên trì","đua"}', 'vi', 2,
 '[{"content":"Rừng tổ chức cuộc đua lớn. Thỏ nhanh nhất, hươu chân dài nhất. Rùa nhỏ Min cũng đăng ký – ai cũng ngạc nhiên.","scene_description":"Cổng xuất phát, các con vật"},{"content":"\"Bịch bịch bịch\" – Min bò từng bước chậm rãi. Thỏ chạy nhanh rồi ngủ gật. Hươu chạy lạc đường.","scene_description":"Đường đua rừng xanh"},{"content":"Min không dừng lại, không nản chí. Bước này rồi bước kia. Mặt trời lặn, trăng lên, Min vẫn bò.","scene_description":"Hoàng hôn chuyển sang đêm"},{"content":"Sáng hôm sau, Min tới đích đầu tiên! Cả rừng vỗ tay. Min cười: \"Mình chậm nhưng mình không bao giờ bỏ cuộc!\"","scene_description":"Vạch đích, confetti, mọi người vỗ tay"}]'),

('Bạn Mèo Đi Lạc', 'Mèo con đi lạc tìm đường về nhà nhờ giúp đỡ của bạn bè', 'animal', '🐱', 2, 6, 'Đừng ngại nhờ giúp đỡ khi cần', '{"động vật","tình bạn","dũng cảm"}', 'vi', 3,
 '[{"content":"Miu Miu – chú mèo con lông trắng – mải đuổi bướm mà đi lạc. Trời tối dần, Miu Miu sợ lắm, kêu \"meo meo\" thật to.","scene_description":"Con đường lạ, mèo con đáng thương"},{"content":"Chó con Bobby nghe tiếng gọi, chạy tới: \"Bạn đi lạc à? Để mình giúp!\" Bobby đánh hơi, dẫn Miu đi.","scene_description":"Chó con dẫn đường, trời hoàng hôn"},{"content":"Qua cầu gãy, cá chép cõng hai bạn qua sông. Đến ngã ba, chim sẻ bay cao chỉ đường từ trên trời.","scene_description":"Cầu gỗ, sông nhỏ, chim sẻ"},{"content":"\"Nhà mình kia rồi!\" Miu Miu nhảy vào lòng mẹ. \"Cảm ơn các bạn!\" – Miu Miu hiểu rằng có bạn bè thật tuyệt vời.","scene_description":"Nhà ấm, mèo mẹ ôm mèo con"}]'),

-- === ĐẠO ĐỨC (moral) ===
('Cậu Bé Nói Dối', 'Cậu bé chăn cừu nói dối bị mất lòng tin', 'moral', '🐺', 4, 9, 'Nói dối sẽ mất lòng tin của mọi người', '{"đạo đức","trung thực","bài học"}', 'vi', 1,
 '[{"content":"Cậu bé Tùng chăn cừu trên đồi. Buồn chán, cậu hét to: \"Sói! Sói!\" Cả làng chạy lên – chẳng có con sói nào. Tùng cười khoái chí.","scene_description":"Đồi cỏ, đàn cừu, cậu bé"},{"content":"Hôm sau Tùng lại hét: \"Sói đến rồi!\" Mọi người lại chạy lên... lại bị lừa. Ai cũng bực mình.","scene_description":"Dân làng tức giận"},{"content":"Một ngày, sói thật sự đến! Tùng hét thật to: \"Sói! Cứu!\" Nhưng không ai tin, không ai lên nữa.","scene_description":"Sói thật xuất hiện, đàn cừu sợ"},{"content":"Tùng mất mấy con cừu, khóc nức nở. Ông nội ôm cháu: \"Nói dối một lần, cả đời mất tin. Hãy nhớ bài học này con nhé.\"","scene_description":"Ông ôm cháu, hoàng hôn buồn"}]'),

('Hai Bàn Tay', 'Bàn tay phải kiêu ngạo, bàn tay trái buồn tủi, rồi cả hai hiểu cần nhau', 'moral', '🤝', 3, 7, 'Hợp tác và tôn trọng lẫn nhau', '{"đạo đức","hợp tác","khiêm tốn"}', 'vi', 2,
 '[{"content":"Bàn tay phải của bé Hà rất kiêu: \"Mình viết được, cầm đũa được, mình giỏi nhất!\" Tay trái buồn lắm.","scene_description":"Hai bàn tay, tay phải vui tay trái buồn"},{"content":"Một hôm, tay phải bị bó bột. Hà phải dùng tay trái – ăn cơm, mặc áo, mở cửa. Tay trái cố gắng hết mình.","scene_description":"Tay phải bó bột, tay trái giúp"},{"content":"Tay phải lành, hai tay cùng vỗ – tiếng vỗ tay vang lên. \"Mình không thể vỗ một tay được,\" tay phải nhận ra.","scene_description":"Hai tay cùng vỗ, âm thanh vui"},{"content":"Từ đó hai tay hợp tác: tay phải viết, tay trái giữ giấy. Cùng nhau, mọi việc đều hoàn hảo hơn.","scene_description":"Hai tay cùng làm việc vui vẻ"}]'),

-- === GIA ĐÌNH (family) ===
('Bữa Cơm Của Bà', 'Bé về quê ăn cơm với bà, hiểu tình yêu gia đình', 'family', '👵', 2, 7, 'Trân trọng tình cảm gia đình', '{"gia đình","bà","tình yêu"}', 'vi', 1,
 '[{"content":"Hè đến, bé Bông về quê thăm bà. Bà mừng lắm, dắt bé ra vườn hái rau, bắt cá dưới ao.","scene_description":"Vườn quê, bà cháu hái rau"},{"content":"Bà nấu cơm bếp củi, khói bay thơm phức. Canh chua cá lóc, rau muống xào, trứng chiên – toàn món bé thích.","scene_description":"Bếp củi, nồi canh bốc khói"},{"content":"Hai bà cháu ngồi ăn cơm dưới gốc mít. Bà kể chuyện ngày xưa, tiếng cười vang cả xóm.","scene_description":"Gốc mít, mâm cơm, trăng lên"},{"content":"Tối, bà quạt cho bé ngủ, hát: \"À ơi... con ơi con ngủ cho ngon...\" Bé ôm bà: \"Con thương bà nhất!\"","scene_description":"Giường tre, bà quạt cho cháu ngủ"}]'),

('Em Bé Mới Sinh', 'Anh/chị lớn đón em bé mới, học cách chia sẻ tình yêu', 'family', '👶', 2, 6, 'Yêu thương không bao giờ chia nhỏ, chỉ nhân lên', '{"gia đình","anh chị em","chia sẻ"}', 'vi', 2,
 '[{"content":"Bé Na nghe mẹ bảo: sắp có em bé rồi! Na vui nhưng cũng lo – liệu ba mẹ có còn thương mình không?","scene_description":"Bé gái lo lắng, mẹ bầu"},{"content":"Em bé sinh ra nhỏ xíu, đỏ hỏn. Na nhìn em – tay em bé tí, nắm chặt ngón tay Na. Tim Na ấm áp lạ.","scene_description":"Bệnh viện, em bé nắm tay chị"},{"content":"Na giúp mẹ lấy tã, hát ru em ngủ. Ba khen: \"Con gái ba giỏi quá, là chị hai tuyệt vời!\"","scene_description":"Na bế em, ba mẹ cười"},{"content":"Na hiểu ra: tình yêu giống như ngọn nến – thắp thêm một ngọn, ánh sáng không bớt đi mà cả nhà càng ấm hơn.","scene_description":"Gia đình bốn người, ánh nến ấm"}]'),

-- === KHOA HỌC (science) ===
('Giọt Nước Du Hành', 'Theo hành trình giọt nước từ mây xuống biển và trở lại', 'science', '💧', 3, 8, 'Nước là quý giá, hãy tiết kiệm nước', '{"khoa học","nước","chu kỳ"}', 'vi', 1,
 '[{"content":"Giọt nước Tí sống trên đám mây. Một ngày, mây quá nặng – \"Tí ơi, đến lượt con rơi rồi!\" Tí hồi hộp nhảy xuống.","scene_description":"Đám mây, giọt nước rơi"},{"content":"Tí rơi thành mưa, chảy vào suối. Suối đưa Tí qua rừng, qua ruộng lúa – lúa uống nước, vươn cao xanh tốt.","scene_description":"Suối chảy qua ruộng lúa xanh"},{"content":"Tí chảy ra sông rồi tới biển mênh mông. Biển ấm quá – Tí nhẹ dần, bay lên thành hơi nước. Lên cao, gặp mây cũ!","scene_description":"Biển xanh, hơi nước bay lên"},{"content":"\"Mình lại ở đây rồi!\" Tí vui. Vòng quay sẽ tiếp tục mãi – mưa, suối, sông, biển, mây. Đó là chu trình nước kỳ diệu!","scene_description":"Sơ đồ chu trình nước dễ thương"}]'),

('Tại Sao Trời Xanh?', 'Bé hỏi mẹ tại sao trời xanh và khám phá ánh sáng', 'science', '🔵', 4, 9, 'Hỏi và tìm hiểu là cách học tốt nhất', '{"khoa học","ánh sáng","tò mò"}', 'vi', 2,
 '[{"content":"\"Mẹ ơi, tại sao trời xanh?\" bé Tí hỏi. Mẹ cười: \"Hay lắm! Để mẹ con mình làm thí nghiệm nhé!\"","scene_description":"Bé chỉ lên trời xanh, mẹ cười"},{"content":"Mẹ lấy đèn pin chiếu qua cốc nước pha sữa. Ánh sáng vàng biến thành xanh! \"Ánh sáng có 7 màu cầu vồng đấy con.\"","scene_description":"Thí nghiệm đèn pin và cốc nước"},{"content":"\"Bầu trời như cốc sữa khổng lồ. Không khí tán xạ ánh sáng xanh mạnh nhất, nên ta thấy trời xanh!\"","scene_description":"Tia sáng bị tán xạ trong khí quyển"},{"content":"\"Vậy hoàng hôn đỏ vì sao?\" – \"Vì lúc đó ánh sáng đi xa hơn, chỉ còn màu đỏ tới mắt mình!\" Bé Tí: \"Khoa học thú vị quá!\"","scene_description":"Hoàng hôn đỏ cam đẹp"}]'),

-- === TRUYỀN THUYẾT (folklore) ===
('Sự Tích Hồ Gươm', 'Vua Lê Lợi trả gươm cho Rùa Vàng ở Hồ Hoàn Kiếm', 'folklore', '⚔️', 5, 10, 'Hòa bình quý hơn chiến tranh', '{"lịch sử","Lê Lợi","Hà Nội"}', 'vi', 1,
 '[{"content":"Ngày xưa nước ta bị giặc Minh đô hộ. Long Vương thương dân, gửi thanh gươm thần cho Lê Lợi đánh giặc.","scene_description":"Thanh gươm phát sáng dưới hồ"},{"content":"Lê Lợi cầm gươm thần, dẫn nghĩa quân chiến đấu mười năm ròng. Gươm chém đâu thắng đó, giặc Minh bị đuổi sạch.","scene_description":"Trận chiến, gươm sáng chói"},{"content":"Đất nước thanh bình, vua dạo thuyền trên hồ. Rùa Vàng nổi lên: \"Xin bệ hạ hoàn gươm cho Long Vương.\"","scene_description":"Hồ xanh, rùa vàng nổi lên"},{"content":"Vua trao gươm, rùa ngậm gươm lặn xuống. Từ đó hồ mang tên Hồ Hoàn Kiếm – nhắc nhở: hòa bình quý hơn vạn gươm đao.","scene_description":"Hồ Hoàn Kiếm, Tháp Rùa"}]'),

('Sơn Tinh Thủy Tinh', 'Hai vị thần tranh tài, giải thích hiện tượng lũ lụt', 'folklore', '🏔️', 4, 9, 'Thiên nhiên mạnh mẽ, con người cần kiên cường', '{"truyền thuyết","thiên nhiên","Việt Nam"}', 'vi', 2,
 '[{"content":"Vua Hùng có công chúa Mỵ Nương xinh đẹp. Hai chàng trai đến cầu hôn: Sơn Tinh – thần núi, và Thủy Tinh – thần nước.","scene_description":"Cung điện, hai chàng trai"},{"content":"Vua ra điều kiện: ai mang lễ vật đến trước sẽ cưới công chúa. Sơn Tinh mang sính lễ đến sớm hơn.","scene_description":"Lễ vật rực rỡ, sáng sớm"},{"content":"Thủy Tinh tức giận, dâng nước lũ ngập trời. Sơn Tinh nâng núi lên cao, nước dâng bao nhiêu núi cao bấy nhiêu.","scene_description":"Bão lũ dữ dội, núi mọc cao"},{"content":"Hàng năm Thủy Tinh vẫn dâng nước trả thù, tạo ra mùa lũ. Nhưng Sơn Tinh luôn thắng – núi non Việt Nam vẫn đứng vững.","scene_description":"Núi non hùng vĩ sau bão"}]'),

-- === HÀI HƯỚC (humor) ===
('Chú Hề Quên Cười', 'Chú hề quên cách cười phải học lại từ đầu', 'humor', '🤡', 3, 7, 'Nụ cười là điều quý giá nhất', '{"hài hước","nụ cười","vui nhộn"}', 'vi', 1,
 '[{"content":"Chú hề Tròn Xoe nổi tiếng nhất rạp xiếc. Nhưng sáng nay thức dậy, chú quên mất cách cười! Nhìn gương – mặt nghiêm như tượng.","scene_description":"Chú hề buồn nhìn gương"},{"content":"Chú hỏi voi: \"Làm sao để cười?\" Voi quấn vòi vào chân mình, ngã lăn quay – Tròn Xoe vẫn không cười nổi.","scene_description":"Voi ngã lăn, chú hề nghiêm mặt"},{"content":"Khỉ con ném chuối trúng đầu chú, vẹt nhái giọng chú, hải cẩu vỗ tay – chú vẫn không cười. Cả rạp xiếc buồn xo.","scene_description":"Các con vật cố gây cười"},{"content":"Một em bé ôm chú: \"Con thương chú hề!\" Tim Tròn Xoe ấm áp – khóe miệng tự nhiên cong lên – CƯỜI! Hóa ra cười vì yêu thương, không phải vì buồn cười!","scene_description":"Em bé ôm chú hề, cả rạp cười"}]'),

-- === CẢM XÚC (emotion) ===
('Quái Vật Giận Dữ', 'Bé học cách thuần phục cơn giận thành bạn thân', 'emotion', '😤', 3, 8, 'Cảm xúc giận dữ không xấu, quan trọng là cách xử lý', '{"cảm xúc","giận dữ","quản lý"}', 'vi', 1,
 '[{"content":"Mỗi khi bé Khoa giận, một con quái vật đỏ xuất hiện – nó gầm gào, đạp đổ đồ chơi, la hét om sòm.","scene_description":"Quái vật đỏ phá phòng, bé sợ"},{"content":"\"Mình ghét quái vật này!\" Khoa khóc. Mẹ bảo: \"Con ơi, quái vật đó là cảm xúc của con. Nó không xấu, chỉ cần được hiểu.\"","scene_description":"Mẹ ôm bé, quái vật nhỏ lại"},{"content":"Mẹ dạy: khi quái vật đến, hít sâu – 1, 2, 3. Nói: \"Mình biết mình đang giận.\" Quái vật từ đỏ chuyển sang hồng, nhỏ lại.","scene_description":"Bé hít thở, quái vật đổi màu"},{"content":"Dần dần, quái vật thành bạn nhỏ dễ thương. Khi Khoa giận, bạn nhỏ nhắc: \"Hít thở nào!\" Khoa cười: \"Cảm ơn bạn giận của mình!\"","scene_description":"Quái vật nhỏ dễ thương, bé cười"}]'),

('Hũ Nước Mắt', 'Bé khóc nhiều quá nên được thần tiên cho hũ đựng nước mắt', 'emotion', '😢', 3, 7, 'Khóc là bình thường, nhưng cũng cần vui lên', '{"cảm xúc","khóc","mạnh mẽ"}', 'vi', 2,
 '[{"content":"Bé Bi hay khóc lắm – ngã khóc, mất đồ chơi khóc, ai nói gì cũng khóc. Một đêm, tiên bé hiện ra tặng hũ thủy tinh.","scene_description":"Phòng ngủ, tiên bé phát sáng"},{"content":"\"Mỗi lần khóc, hãy hứng nước mắt vào đây. Khi đầy, điều kỳ diệu sẽ xảy ra!\" Bi tò mò, cầm hũ theo mọi lúc.","scene_description":"Hũ thủy tinh lấp lánh"},{"content":"Bi khóc khi đau, nước mắt chảy vào hũ. Nhưng dần dần, Bi bắt đầu tự lau nước mắt: \"Mình thử nín thử xem.\" Hũ đầy rất chậm.","scene_description":"Bé lau nước mắt, hũ đầy một nửa"},{"content":"Khi hũ đầy, nước mắt biến thành ngọc trai lấp lánh! Tiên bé nói: \"Nước mắt của con quý lắm – nhưng nụ cười còn quý hơn.\" Bi cười rạng rỡ.","scene_description":"Hũ ngọc trai, bé cười rạng rỡ"}]'),

-- === TƯỞNG TƯỢNG (imagination) ===
('Thành Phố Trong Tủ Đồ', 'Mở tủ đồ ra thấy cả thành phố thu nhỏ bên trong', 'imagination', '🏙️', 3, 8, 'Trí tưởng tượng là siêu năng lực', '{"tưởng tượng","kỳ diệu","phiêu lưu"}', 'vi', 1,
 '[{"content":"Bé Tin mở tủ quần áo – bên trong không phải quần áo mà là cả một thành phố thu nhỏ! Nhà cao tầng bằng hộp giấy, đường phố bằng dây ruy băng.","scene_description":"Tủ mở ra thành phố thu nhỏ kỳ diệu"},{"content":"Cư dân là các nút áo, cúc quần, kẹp tóc – tất cả biết nói! Ông nút áo già bảo: \"Chào mừng đến Thành phố Tủ Đồ!\"","scene_description":"Nút áo, cúc quần biết nói cười"},{"content":"Thành phố đang có vấn đề: chiếc tất lẻ bị lạc, áo len bị rối chỉ, dây giày buồn vì bị quên. Tin giúp từng người bạn.","scene_description":"Bé giúp đỡ các cư dân nhỏ"},{"content":"Thành phố vui trở lại! Khi Tin bước ra, tủ đóng lại bình thường. Nhưng mỗi lần mở tủ, Tin đều mỉm cười – biết bạn bè trong đó đang vui.","scene_description":"Bé mỉm cười đóng tủ"}]'),

-- === ÂM NHẠC (music) ===
('Ban Nhạc Rừng Xanh', 'Các con vật lập ban nhạc nhưng không ai hợp ai', 'music', '🎵', 3, 7, 'Mỗi người một vai trò, cùng nhau tạo nên bản nhạc hay', '{"âm nhạc","hợp tác","bạn bè"}', 'vi', 1,
 '[{"content":"Gấu muốn hát, Khỉ muốn gõ trống, Ếch muốn thổi kèn, Dế muốn kéo đàn. Bốn bạn lập Ban Nhạc Rừng Xanh!","scene_description":"Bốn con vật cầm nhạc cụ"},{"content":"Nhưng khi chơi cùng nhau – ồn ào kinh khủng! Ai cũng muốn to nhất, nhanh nhất. Chim sẻ bay đi vì đau tai.","scene_description":"Âm nhạc hỗn loạn, chim bay"},{"content":"Cú mèo dạy: \"Âm nhạc là LẮNG NGHE nhau. Gấu hát trước, Dế đệm nhẹ, Khỉ giữ nhịp, Ếch vào điểm nhấn.\"","scene_description":"Cú mèo chỉ huy, bốn bạn lắng nghe"},{"content":"Bốn bạn thử lại – lần này lắng nghe nhau. Giai điệu bay khắp rừng, tất cả thú rừng nhảy múa. Buổi hòa nhạc tuyệt vời nhất!","scene_description":"Hòa nhạc rừng, mọi vật nhảy múa"}]'),

-- === THIÊN NHIÊN (nature) ===
('Bốn Mùa Kể Chuyện', 'Bốn mùa Xuân Hạ Thu Đông mỗi mùa kể câu chuyện riêng', 'nature', '🍃', 3, 8, 'Mỗi mùa đều đẹp và đặc biệt', '{"thiên nhiên","bốn mùa","Việt Nam"}', 'vi', 1,
 '[{"content":"Xuân đến, cây đào nở hoa hồng rực. Xuân kể: \"Mình mang mưa phùn cho lúa mọc, mang Tết cho mọi nhà sum vầy.\"","scene_description":"Mùa xuân, hoa đào, pháo hoa Tết"},{"content":"Hạ cười nắng vàng: \"Mình cho ve sầu hát, cho bé được nghỉ hè, ăn kem và tắm biển!\" Cánh diều bay cao trên đồng.","scene_description":"Mùa hè, biển xanh, diều bay"},{"content":"Thu nhẹ nhàng: \"Mình mang trăng tròn cho bé rước đèn, mang cốm xanh thơm lừng.\" Lá vàng rơi xoay trong gió.","scene_description":"Mùa thu, trăng rằm, đèn lồng"},{"content":"Đông trầm lặng: \"Mình cho không khí se lạnh để cả nhà quây quần bên bếp lửa.\" Bốn mùa cùng nói: \"Mỗi chúng mình đều đặc biệt!\"","scene_description":"Mùa đông, gia đình bên bếp lửa"}]'),

-- === LỊCH SỬ (history) ===
('Hai Bà Trưng Cưỡi Voi', 'Hai Bà Trưng dũng cảm đánh đuổi giặc ngoại xâm', 'history', '🐘', 5, 10, 'Phụ nữ Việt Nam dũng cảm và kiên cường', '{"lịch sử","Hai Bà Trưng","yêu nước"}', 'vi', 1,
 '[{"content":"Ngày xưa, nước Việt bị giặc phương Bắc cai trị tàn bạo. Hai chị em Trưng Trắc, Trưng Nhị là con gái Lạc tướng, văn võ song toàn.","scene_description":"Hai người phụ nữ dũng cảm"},{"content":"Giặc giết chồng Trưng Trắc. Hai bà phất cờ khởi nghĩa: \"Một xin rửa sạch nước thù! Hai xin đem lại nghiệp xưa họ Hùng!\"","scene_description":"Cờ phất, quân khởi nghĩa"},{"content":"Cưỡi voi ra trận, hai bà dẫn quân đánh 65 thành. Giặc sợ chạy tan tác. Đất nước giành lại độc lập!","scene_description":"Hai bà cưỡi voi, trận chiến"},{"content":"Hai Bà Trưng trở thành nữ vương đầu tiên của nước Việt. Hàng năm, mùng 6 tháng 2 âm lịch, cả nước tưởng nhớ hai bà.","scene_description":"Đền thờ Hai Bà Trưng"}]'),

-- === HỌC CHƠI (educational) ===
('Bảng Chữ Cái Phiêu Lưu', 'Các chữ cái đi phiêu lưu để ghép thành từ', 'educational', '🔤', 2, 5, 'Học chữ cái qua câu chuyện vui', '{"học chơi","chữ cái","ABC"}', 'vi', 1,
 '[{"content":"Chữ A kiêu hãnh: \"Mình đứng đầu bảng chữ cái!\" Chữ B cười: \"Nhưng một mình A không làm được từ nào đâu!\"","scene_description":"Các chữ cái vui nhộn"},{"content":"A rủ B đi tìm bạn. Gặp chữ C: \"ABC – chúng mình là bộ ba!\" Rồi gặp thêm M, E, Ê, O, I...","scene_description":"Các chữ cái đi cùng nhau"},{"content":"Cùng nhau ghép: M-E = ME. B-A = BA. M-Ẹ = MẸ! \"BA MẸ! Từ đầu tiên!\" Các chữ vỡ òa vui sướng.","scene_description":"Chữ ghép thành từ BA MẸ"},{"content":"Từ đó 29 chữ cái luôn đi cùng nhau – ghép thành bao nhiêu từ đẹp: YÊU, VUI, BẠN, SÁCH, TRƯỜNG... Bé thử ghép nhé!","scene_description":"Nhiều chữ ghép thành từ rực rỡ"}]'),

('Phép Tính Vui', 'Bé học cộng trừ qua câu chuyện trái cây', 'educational', '🧮', 3, 6, 'Toán học ở xung quanh chúng ta', '{"học chơi","toán","cộng trừ"}', 'vi', 2,
 '[{"content":"Bé Đậu có 3 quả táo đỏ. Bạn Gấu cho thêm 2 quả. \"3 cộng 2 bằng mấy nhỉ?\" Đậu đếm: 1, 2, 3, 4, 5. \"Bằng 5!\"","scene_description":"5 quả táo đỏ, bé đếm vui"},{"content":"Đậu chia cho Thỏ 1 quả: 5 trừ 1 bằng 4! Cho Sóc 2 quả: 4 trừ 2 bằng 2! \"Toán thú vị ghê!\"","scene_description":"Chia táo cho bạn bè"},{"content":"Đi chợ với mẹ: 4 quả cam + 3 quả cam = 7 quả cam. Mua 10 kẹo, ăn 3 còn 7. Toán ở khắp nơi!","scene_description":"Chợ, trái cây nhiều màu sắc"},{"content":"Tối về, Đậu đếm sao trên trời: \"1, 2, 3... nhiều quá đếm không hết!\" Mẹ cười: \"Từ từ con nhé, toán sẽ giúp con đếm được hết!\"","scene_description":"Bé đếm sao, bầu trời đêm"}]')

ON CONFLICT DO NOTHING;

