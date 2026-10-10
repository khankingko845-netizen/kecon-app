/**
 * Character presets for "Tạo truyện" step 2. Each preset has its own clay
 * portrait (public/characters/v1, distinct from the theme tiles) and an
 * English look that is reused in illustration prompts so AI pictures match
 * the card the child picked.
 */
import type { VoiceType } from "@/lib/story-brief";

export interface CharacterPreset {
  id: string;
  /** Story name (what the writer must use). */
  name: string;
  /** Short kind shown under the name. */
  kind: string;
  /** Vietnamese brief for the writer. */
  description: string;
  voiceType: VoiceType;
  appearance: string;
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  { id: "bunny", name: "Thỏ Bông", kind: "Bạn thú rừng", description: "cô thỏ trắng nhỏ tò mò, hay hỏi, rất tốt bụng", voiceType: "girl", appearance: "small white bunny with long floppy ears, rosy cheeks and a mint-green neckerchief" },
  { id: "astronaut", name: "Phi hành gia Tí", kind: "Du hành vũ trụ", description: "cậu bé phi hành gia mê khám phá các vì sao", voiceType: "boy", appearance: "little boy astronaut with brown hair in a white and purple spacesuit with a round clear helmet" },
  { id: "princess", name: "Công chúa Mây", kind: "Công chúa", description: "cô công chúa nhỏ hiền lành, thích giúp đỡ mọi người", voiceType: "girl", appearance: "little princess with black hair in two buns, a small golden crown and a purple and coral gown" },
  { id: "cuoi", name: "Chú Cuội", kind: "Cổ tích Việt", description: "chú Cuội ngồi gốc cây đa trên cung trăng, hay kể chuyện", voiceType: "boy", appearance: "cheerful boy with short black hair in a brown and orange traditional Vietnamese outfit, near a banyan tree" },
  { id: "fairy", name: "Tiên Nhỏ", kind: "Cô tiên nhỏ", description: "cô tiên tí hon có đôi cánh biết phát sáng", voiceType: "girl", appearance: "tiny fairy girl with a blonde ponytail, mint-green translucent wings and a coral dress" },
  { id: "explorer", name: "Nhà thám hiểm Bo", kind: "Bạn tìm kho báu", description: "cậu bé thám hiểm dũng cảm luôn mang bản đồ kho báu", voiceType: "boy", appearance: "boy explorer with a yellow safari hat, green vest, brown backpack, holding a treasure map" },
  { id: "dragon", name: "Rồng Xanh", kind: "Rồng con", description: "chú rồng con xanh lá hiền lành, mới tập bay", voiceType: "creature", appearance: "friendly green baby dragon with small purple wings, orange back spikes and a cream belly" },
  { id: "robot", name: "Rô-bốt Bíp", kind: "Bạn rô-bốt", description: "chú rô-bốt tròn vo vui tính, nói chuyện kêu bíp bíp", voiceType: "creature", appearance: "round purple and white robot with glowing teal eyes, a little antenna light and orange arms" },
  { id: "hero", name: "Siêu nhân Nhí", kind: "Siêu anh hùng", description: "cậu bé siêu nhân nhỏ thích giúp đỡ người khác", voiceType: "boy", appearance: "little superhero boy in a purple suit with a yellow star, an orange cape and green trousers" },
];

export function characterArtUrl(presetId: string | null | undefined): string {
  return presetId && CHARACTER_PRESETS.some((p) => p.id === presetId)
    ? `/characters/v1/${presetId}.webp`
    : "/characters/v1/custom.webp";
}

export const VOICE_TYPE_LABEL: Record<VoiceType, string> = {
  girl: "Bé gái",
  boy: "Bé trai",
  woman: "Cô / mẹ",
  man: "Chú / bố",
  grandma: "Bà",
  grandpa: "Ông",
  creature: "Con vật / sinh vật",
};

export const CHARACTER_TRAITS = ["dũng cảm", "tốt bụng", "hài hước", "tò mò", "nhút nhát", "thông minh", "hay giúp đỡ", "tinh nghịch"] as const;
