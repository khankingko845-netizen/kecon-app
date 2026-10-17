import { describe, expect, it } from "vitest";
import { detectEmotion, parseVoiceMarkup, stripEmotionTags } from "@/lib/elevenlabs";

const NARRATOR = "voice-narrator";
const characters = {
  "Sóc Nhỏ": { voiceId: "voice-soc", voiceName: "Giọng Sóc" },
  "Thỏ Trắng": { voiceId: "voice-tho" },
};

describe("parseVoiceMarkup", () => {
  it("tách lời kể và lời thoại, gán đúng giọng cho từng nhân vật", () => {
    const content =
      "[narrator]Ngày xưa có chú Sóc.[/narrator]\n" +
      "[character:Sóc Nhỏ]Mình đi tìm hạt dẻ![/character]\n" +
      "[character:Thỏ Trắng]Cho mình đi với![/character]";

    expect(parseVoiceMarkup(content, characters, NARRATOR, "Mẹ")).toEqual([
      { speaker: "narrator", text: "Ngày xưa có chú Sóc.", voiceId: NARRATOR, voiceName: "Mẹ" },
      { speaker: "Sóc Nhỏ", text: "Mình đi tìm hạt dẻ!", voiceId: "voice-soc", voiceName: "Giọng Sóc" },
      { speaker: "Thỏ Trắng", text: "Cho mình đi với!", voiceId: "voice-tho", voiceName: "Thỏ Trắng" },
    ]);
  });

  it("nhân vật chưa gán giọng → dùng giọng người kể nhưng giữ tên nhân vật", () => {
    const [seg] = parseVoiceMarkup("[character:Cáo Già]Hừm![/character]", characters, NARRATOR);
    expect(seg).toEqual({ speaker: "Cáo Già", text: "Hừm!", voiceId: NARRATOR, voiceName: "Cáo Già" });
  });

  it("văn bản ngoài thẻ (trước/sau) được đọc bằng giọng người kể", () => {
    const segs = parseVoiceMarkup("Mở đầu. [character:Sóc Nhỏ]Chào![/character] Kết thúc.", characters, NARRATOR);
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([
      ["narrator", "Mở đầu."],
      ["Sóc Nhỏ", "Chào!"],
      ["narrator", "Kết thúc."],
    ]);
  });

  it("bỏ qua thẻ rỗng", () => {
    const segs = parseVoiceMarkup("[narrator]   [/narrator][character:Sóc Nhỏ]A[/character]", characters, NARRATOR);
    expect(segs.map((s) => s.text)).toEqual(["A"]);
  });

  it("không có markup → toàn bộ là lời kể; nội dung rỗng → []", () => {
    expect(parseVoiceMarkup("  Truyện không có thẻ.  ", characters, NARRATOR)).toEqual([
      { speaker: "narrator", text: "Truyện không có thẻ.", voiceId: NARRATOR, voiceName: undefined },
    ]);
    expect(parseVoiceMarkup("   ", characters, NARRATOR)).toEqual([]);
  });
});

describe("detectEmotion / stripEmotionTags", () => {
  it("thẻ cảm xúc tường minh được ưu tiên hơn ngữ cảnh", () => {
    expect(detectEmotion("[thì thầm] Bé ơi, vui quá!")).toBe("whisper");
    expect(detectEmotion("[sad] what a happy day")).toBe("sad");
  });

  it.each([
    ["Sóc nhỏ thì thầm với bạn", "whisper"],
    ["Bé khóc vì nhớ mẹ", "sad"],
    ["Cả nhà cười thật vui", "happy"],
    ["Mẹ ru ngủ bé thật dịu dàng", "gentle"],
    ["Trời nắng chang chang.", "neutral"],
  ])("'%s' → %s", (text, emotion) => {
    expect(detectEmotion(text)).toBe(emotion);
  });

  // BUG (mức độ thấp, chất lượng giọng đọc): regex không theo ranh giới từ nên
  // "ôm" khớp trong "Hôm nay" (rất phổ biến) → câu trung tính bị đọc preset "gentle".
  it("'Hôm nay trời nắng.' là neutral", () => {
    expect(detectEmotion("Hôm nay trời nắng.")).toBe("neutral");
  });

  it("xoá thẻ cảm xúc trước khi gửi TTS, giữ thẻ khác", () => {
    expect(stripEmotionTags("[thì thầm] Ngủ ngon nhé [WHISPER]")).toBe("Ngủ ngon nhé");
    expect(stripEmotionTags("[narrator]Xin chào[/narrator]")).toBe("[narrator]Xin chào[/narrator]");
  });
});
