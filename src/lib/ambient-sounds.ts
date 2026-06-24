/**
 * Ambient Sound System for KểCon
 *
 * Maps scene descriptions to ambient sound categories,
 * and provides pre-built ambient sound URLs + ElevenLabs generation.
 */

export interface AmbientCategory {
  id: string;
  label: string;
  emoji: string;
  keywords: string[];
  prompt: string; // For AI sound generation
}

export const AMBIENT_CATEGORIES: AmbientCategory[] = [
  {
    id: "forest",
    label: "Rừng cây",
    emoji: "🌲",
    keywords: ["rừng", "cây", "lá", "forest", "tree", "jungle", "woods", "vườn", "cỏ", "hoa"],
    prompt: "peaceful forest ambience with birds chirping, gentle wind through leaves, soft rustling",
  },
  {
    id: "night",
    label: "Đêm yên",
    emoji: "🌙",
    keywords: ["đêm", "tối", "trăng", "sao", "night", "moon", "stars", "ngủ", "khuya", "midnight"],
    prompt: "calm night ambience with crickets, gentle wind, distant owl hooting, peaceful silence",
  },
  {
    id: "ocean",
    label: "Biển cả",
    emoji: "🌊",
    keywords: ["biển", "sóng", "cá", "ocean", "sea", "wave", "beach", "bờ", "thuyền", "boat"],
    prompt: "ocean waves gently crashing on shore, seagulls in distance, calm sea breeze",
  },
  {
    id: "rain",
    label: "Mưa nhẹ",
    emoji: "🌧️",
    keywords: ["mưa", "rain", "ướt", "nước", "wet", "storm", "giông", "sấm"],
    prompt: "gentle rain falling on window, soft thunder in distance, cozy indoor atmosphere",
  },
  {
    id: "castle",
    label: "Lâu đài",
    emoji: "🏰",
    keywords: ["lâu đài", "castle", "vương quốc", "kingdom", "hoàng", "royal", "công chúa", "princess", "hoàng tử", "prince"],
    prompt: "medieval castle ambience, stone hall echo, distant trumpet, crackling fireplace",
  },
  {
    id: "adventure",
    label: "Phiêu lưu",
    emoji: "⚔️",
    keywords: ["phiêu lưu", "adventure", "chạy", "run", "bay", "fly", "nhảy", "jump", "exciting"],
    prompt: "adventure music ambience, exciting undertone, wind rushing, footsteps on path",
  },
  {
    id: "home",
    label: "Nhà ấm",
    emoji: "🏠",
    keywords: ["nhà", "home", "bếp", "kitchen", "phòng", "room", "gia đình", "family", "ấm"],
    prompt: "cozy home ambience, ticking clock, gentle humming, warm fireplace crackling",
  },
  {
    id: "playful",
    label: "Vui nhộn",
    emoji: "🎈",
    keywords: ["vui", "cười", "chơi", "fun", "play", "laugh", "happy", "nhảy", "dance", "party"],
    prompt: "playful children's ambience, gentle xylophone, bouncy background, giggles",
  },
  {
    id: "suspense",
    label: "Hồi hộp",
    emoji: "😱",
    keywords: ["sợ", "tối", "bí ẩn", "mysterious", "scary", "dark", "shadow", "bóng", "ma"],
    prompt: "gentle suspense ambience, soft heartbeat, mysterious undertone, creaking door",
  },
  {
    id: "lullaby",
    label: "Ru ngủ",
    emoji: "💤",
    keywords: ["ngủ", "sleep", "ru", "lullaby", "giấc mơ", "dream", "gối", "pillow", "nệm"],
    prompt: "gentle lullaby music box, white noise undertone, very soft wind, peaceful breathing",
  },
  {
    id: "magic",
    label: "Phép thuật",
    emoji: "✨",
    keywords: ["phép", "magic", "thần", "fairy", "tiên", "wand", "bùa", "spell", "biến"],
    prompt: "magical fairy tale ambience, sparkling sounds, gentle chimes, enchanted atmosphere",
  },
  {
    id: "underwater",
    label: "Dưới nước",
    emoji: "🐠",
    keywords: ["dưới nước", "underwater", "cá", "fish", "đại dương", "deep", "san hô", "coral"],
    prompt: "underwater ambience, bubbles rising, whale song in distance, gentle water current",
  },
];

/**
 * Match a scene description to the best ambient category.
 * Returns the category ID or null if no good match.
 */
export function matchAmbientCategory(sceneDescription: string): string | null {
  if (!sceneDescription) return null;
  const lower = sceneDescription.toLowerCase();

  let bestMatch: { id: string; score: number } | null = null;

  for (const cat of AMBIENT_CATEGORIES) {
    let score = 0;
    for (const keyword of cat.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        score += keyword.length; // Longer keyword matches are more specific
      }
    }
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: cat.id, score };
    }
  }

  return bestMatch?.id || null;
}

/**
 * Get the ambient category info.
 */
export function getAmbientCategory(categoryId: string): AmbientCategory | undefined {
  return AMBIENT_CATEGORIES.find((c) => c.id === categoryId);
}

/**
 * Generate ambient sound using ElevenLabs Sound Effects API.
 * Returns audio blob.
 */
export async function generateAmbientSound(
  apiKey: string,
  prompt: string,
  durationSeconds: number = 10
): Promise<Blob> {
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: durationSeconds,
      prompt_influence: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || `Sound generation failed: ${res.status}`);
  }

  return res.blob();
}
