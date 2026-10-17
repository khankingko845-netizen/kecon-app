## Bổ sung research — Nhịp kể, khoảng nghỉ & âm thanh để bé nghe hiểu 2026-10-08

**Đề xuất:** bổ sung một bước “Đạo diễn câu chuyện” sau khi bố mẹ duyệt nội dung: `StoryRevision → PerformancePlan → ProviderCompiler → AudioManifest → SoundTimeline`. Mục tiêu là truyện rõ ý, sinh động và dễ chịu, không phải phủ tiếng động liên tục hay kéo thời gian nghe vô hạn. Phần này là **research/contract đề xuất, chưa deploy, chưa có benchmark trả phí hoặc test với trẻ thật**. Baseline thực đã xác minh: merge `55076ce`, staging `55076ce-1123` (T08b); T09a đang triển khai riêng.

### 1. Cơ sở và giới hạn bằng chứng

Meta-analysis 43 nghiên cứu/2.147 trẻ cho thấy lợi ích nhỏ của truyện tăng cường công nghệ về hiểu truyện và từ vựng biểu đạt; multimedia như nhạc/âm thanh có thể có ích, trong khi hotspots/game/dictionary tương tác dễ gây phân tán. Đây là bằng chứng về **storybook đa phương tiện**, không phải thử nghiệm riêng audio tiếng Việt của KểCon và không chứng minh “càng nhiều SFX càng thu hút”. Cần nghe A/B và kiểm tra hiểu truyện, không suy ra tỷ lệ tăng retention. [Source](https://pubmed.ncbi.nlm.nih.gov/26640299/)

### 2. Nhịp kể là dữ liệu, không phải rắc dấu ba chấm

- Giữ `displayText` nguyên bản. `spokenText` chuẩn hoá tiếng Việt, từ điển phát âm và version riêng; không bỏ dấu, kéo ký tự hoặc viết hoa cả câu để ép cảm xúc.
- Mỗi segment: `speakerId, text, delivery, intensity, emphasisSpans, pauseAfterMs, sceneId`; cast không thay đổi khi “nhấn mạnh”. `pauseAfterMs` là khoảng nghỉ có chủ đích sau một ranh giới câu/đoạn tự nhiên, không phải mỗi từ một request. Validation giới hạn cường độ, độ dài, speaker/span và tổng thời lượng.
- **Mốc thử nghiệm ban đầu, không phải chuẩn phát triển trẻ:** nhịp giữa câu 200–500 ms, nhấn điểm quan trọng 500–800 ms, chuyển cảnh 600–1.200 ms. Không cộng máy móc lên mọi dấu câu; nghe lại cả đoạn để tránh truyện đứt vụn. Ru ngủ giảm độ tương phản, kết êm và không bất ngờ hét/cười lớn.
- Phân biệt *nghỉ theo diễn xuất trong câu* và *khoảng yên lặng sau segment*. Chỉ lớp sau có thể lập lịch số mili-giây chính xác; audio tag/punctuation mang tính xác suất. Không cắt giữa âm tiết để chèn im lặng. Nếu sửa prosody/spokenText phải render lại segment liên quan; nếu chỉ đổi mức âm nền/SFX ngoài lời nói thì không gọi TTS lại.
- “Nghe vui ban ngày”: narrator ấm, biến thiên nhẹ, lời thoại có tính cách; “Kể dịu”: narrator ổn định; “Ru ngủ”: nhịp đều, SFX tắt mặc định. Nhiều vai 2–3 nhân vật là opt-in, mapping xuyên truyện; không âm thầm đổi voice khi lỗi.

### 3. Compiler theo đúng model — không gửi tag tuỳ ý

Eleven v3/v4 **không hỗ trợ SSML `<break>`**; dùng tag/punctuation/text structure phù hợp. Tài liệu nói các model hỗ trợ break có thể nghỉ tới 3 giây nhưng quá nhiều break gây bất ổn/noise; speed quá cực đoan cũng có thể giảm chất lượng. Vì vậy Flash/Turbo, v3 và v4 phải có capability adapter riêng và nghe kiểm chứng với từng voice; không tự đổi mặc định sang v4 hay coi quảng cáo model là kết quả KểCon. [Source](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)

Fish S2/S2.1 dùng `[bracket]`, có `[pause]`/emotion cues; S1 dùng `(parenthesis)` và danh sách ngôn ngữ khác. Cues là mô tả ngôn ngữ học được, không phải lệnh bảo đảm độ dài nghỉ hay danh tính nhân vật. Không lấy hướng dẫn speaker markers trong **STT** để áp thẳng vào TTS. [Source](https://docs.fish.audio/developer-guide/models-pricing/models-overview)

- App allowlist delivery đã test, không chuyển raw instruction của LLM thành control. Tags không hỗ trợ phải bị chặn ở compiler, không để đọc ra chữ. SFX xe/con vật không nhét vào text TTS; dùng asset độc lập để dễ kiểm soát, thay thế và không tốn credit khi phát lại.
- Preview dùng 2–3 câu thật có narrator → thoại → narrator, đúng voice/model/compiler như final; cache theo identity, báo rõ lần sinh mới dùng credit. Không lấy preview mặc định tiếng Anh làm bằng chứng tiếng Việt.
- Chia theo câu/nhịp tự nhiên, có context khi endpoint hỗ trợ; cache cần tính cả context thực gửi, dictionary/compiler/cast/revision. Sửa đoạn có thể làm đổi context đoạn liền kề; không hứa chỉ đổi đúng một từ audio. Eleven có endpoint trả character timing/normalized alignment; cần map `spokenText` về `displayText`, không dùng character index nguyên bản sau normalizer. [Source](https://elevenlabs.io/docs/overview/capabilities/text-to-speech) [Source](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)

### 4. SoundTimeline: lời kể chính, nền theo cảnh, tiếng động theo hành động

Tách **Narration / Ambience / SFX**. Ví dụ một cảnh sóc đi tới suối:

| Mốc | Lời kể/diễn xuất | Âm bổ trợ đề xuất |
| --- | --- | --- |
| Mở cảnh rừng | Kể ấm, cùng narrator | Rừng nhẹ; không bật suối chỉ vì câu nhắc “sắp tới suối” |
| “Sóc bước qua lá khô.” | Nhấn nhẹ hành động, nghỉ tự nhiên | 1 cue bước/lá ngắn tại hành động, không lặp mỗi câu |
| Đến bờ suối | Nghỉ chuyển cảnh êm | Crossfade rừng → suối theo cue đã duyệt |
| Sóc nói | Cùng narrator diễn tinh nghịch nhẹ hoặc cast opt-in | Duck nền; không chèn tiếng kêu che phụ âm |
| Kết truyện | Chậm lại vừa phải, kết êm | Fade-out; không tự phát truyện tiếp để kéo dài phiên |

Đây là storyboard minh hoạ, **chưa có file bước chân/xe/con vật mới được duyệt**. Thư viện hiện có 8 file T17; chỉ mở rộng bằng file có license/provenance/checksum và quyền phân phối. “Con vật nói” là voice acting lời thoại; tiếng kêu con vật là SFX, không hứa TTS nhái mọi loài.

- Cue: `assetId/version, sceneId, anchorSegmentId, anchorTokenId? / offsetMs, duration, gainEnvelope, allowInBedtime`. Neo từ timing audio thật, không đoán bằng timer đếm chữ; chưa có alignment thì chỉ neo ranh giới segment.
- Chỉ chọn âm có ngữ cảnh rõ; câu giả định/phủ định/hồi tưởng không tự kích hoạt cảnh hiện tại. Không khớp → yên lặng. Giới hạn lớp, headroom, fade/crossfade; duck dưới giọng kể, kể cả lời nhỏ. Không coi thông số peak/loudness là chứng nhận an toàn thính lực trên mọi thiết bị.
- Seek/pause/chuyển trang/cancel/offline phải huỷ lịch cũ và response tải muộn, không phát đè hoặc tiếng động “ma”. Test iOS/Zalo/autoplay/user gesture; giọng/âm nền/SFX có điều khiển riêng và bố mẹ tắt dễ dàng.

### 5. Nghe chất lượng nhưng app nhẹ, ít tốn credit

MDN khuyến nghị media element cho track dài và AudioBuffer cho asset ngắn trong bộ nhớ. Đề xuất stream narration dài qua HTMLAudioElement, chỉ decode SFX ngắn có giới hạn; AudioContext dùng mixer/timeline, tải lười audio module và prefetch có ngân sách. Không bundle cả kho voice vào JS hay decode mọi bản truyện thành PCM cùng lúc. [Source](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) [Source](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

**Ví dụ toán học, không phải đo thực tế:** 6 phút mono PCM float32 24 kHz ≈34,56 MB trong RAM; MP3 128 kbps cùng thời lượng ≈5,76 MB truyền tải. File nén nhỏ không có nghĩa decode cũng nhẹ. Codec/bitrate cần A/B tiếng Việt + iOS/Android/offline trước quyết định.

- Audio narration immutable + manifest; SFX và mixer riêng. Đổi volume/SFX không tái sinh lời kể. Thuật ngữ/licensing/tenant identity đầy đủ; voice riêng không chia cache chéo hộ.
- Kho truyện cố định có narration pre-rendered; cá nhân hoá bằng **đoạn nguyên câu** ở vị trí tự nhiên, không ghép một âm “tên bé” giữa từ làm mất nhịp. Dự toán các đoạn mới và preview, không gọi LLM/TTS lại phần thân không đổi. Không đảm bảo ghép mọi tên giữ được chất lượng trước eval.
- Single-flight/idempotency/retry segment/reserve quota theo T21; không trừ/gọi lặp do double tap. Cost/story-ready và cost/phút dùng thật, cache hit, retry waste, thời gian tới audio đầu và RAM là chỉ số chính. Chưa có số tiết kiệm thực đo.
- File dài range/CDN/private signed URL + offline có quota LRU; bản master/export manifest/checksum + backup binary và restore drill thuộc R06/A14, không coi DB dump là đủ chuyển server. Giọng clone/provider ID có thể không chuyển được giữa tài khoản/nhà cung cấp, dù audio đã xuất có quyền dùng.

### 6. Gate và cập nhật backlog

1. **R-02a:** 50 câu tiếng Việt + từ lỗi thực tế, normalizer/dictionary/display-spoken mapping; sửa phát âm trước làm màu giọng.
2. **R-03a / T16:** PerformancePlan enum + pause/emphasis budget; compiler capability, preview=final, identity/context fingerprint. Scaffold/tests có thể làm song song; chưa phát hành voice riêng khi thiếu T11/T12 và chưa phát hành truyện AI cho bé khi thiếu T14/T15.
3. **R-05a / T17:** Timeline tại ranh giới segment, rồi alignment; 5–10 scene blind nghe lời kể đơn thuần vs phối âm, cùng script. Gate nghe rõ lời/khớp cảnh/độ dễ chịu/độ lặp + seek/pause/offline/cancel, không chỉ “nhiều SFX”.
4. **Eval có ngân sách và đồng ý phù hợp:** phụ huynh Việt nghe trước; test với trẻ chỉ theo quy trình consent, thời lượng phù hợp và có nút dừng. Hỏi bé kể lại ý chính/nhân vật, chấm hiểu và thích nghe, không chỉ completion/replay. Không lưu raw tên bé/lời nói/âm thanh vào analytics mới chỉ để đo hấp dẫn.
5. **R-04/R-06/T21:** template/audio manifest đa phiên bản, quyền tài sản, cache và backup/restore để giải pháp diễn cảm không làm credit/dung lượng tăng không kiểm soát.

**Chưa xác minh:** khoảng nghỉ tốt nhất theo nhóm tuổi; tag tuân thủ với voice thật; điểm anchor chính xác; chất lượng phát âm/diễn cảm; quyền file mới; benchmark RAM/tốc độ/credit; hiểu truyện thực tế. Không gọi benchmark trả phí hoặc tự đổi key/model/giá chỉ để hoàn thành research.

