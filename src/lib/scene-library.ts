/**
 * Bundled scene art (AI-generated for KểCon, clay picture-book style) so every
 * book page has a matching picture even when AI illustration is off.
 * Pure: shared by the story writer (allowed ids) and the reader.
 */
export const SCENE_IDS = [
  "forest",
  "forest-night",
  "village",
  "stream",
  "beach",
  "underwater",
  "castle",
  "space",
  "bedroom",
  "home",
  "garden",
  "snow",
  "sky",
  "rain",
  "school",
  "moon-festival",
  "cave",
  "campfire",
] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const SCENE_LABEL: Record<SceneId, string> = {
  forest: "Khu rừng",
  "forest-night": "Rừng đêm",
  village: "Làng quê",
  stream: "Bờ suối",
  beach: "Bãi biển",
  underwater: "Đáy biển",
  castle: "Lâu đài",
  space: "Vũ trụ",
  bedroom: "Phòng ngủ",
  home: "Trong nhà",
  garden: "Khu vườn",
  snow: "Núi tuyết",
  sky: "Trên mây",
  rain: "Ngày mưa",
  school: "Trường học",
  "moon-festival": "Đêm Trung thu",
  cave: "Hang kho báu",
  campfire: "Lửa trại",
};

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === "string" && (SCENE_IDS as readonly string[]).includes(value);
}

export function sceneArtUrl(id: SceneId): string {
  return `/scenes/v1/${id}.webp`;
}

/** Ordered: the first matching rule wins (specific places before generic ones). */
const RULES: [SceneId, RegExp][] = [
  ["moon-festival", /trung thu|rước đèn|đèn ông sao|bánh nướng|bánh dẻo|cung trăng|mid-autumn|lantern festival|mooncake/],
  ["underwater", /đáy biển|dưới biển|dưới nước|san hô|thủy cung|underwater|coral|under the sea/],
  ["space", /vũ trụ|hành tinh|tên lửa|phi thuyền|mặt trăng|sao hỏa|thiên hà|space|planet|rocket|galaxy|spaceship/],
  ["cave", /hang động|kho báu|trong hang|cave|treasure|grotto/],
  ["campfire", /lửa trại|cắm trại|bếp lửa|campfire|camping|bonfire/],
  ["castle", /lâu đài|cung điện|hoàng cung|vương quốc|castle|palace|kingdom/],
  ["snow", /tuyết|băng giá|núi băng|snow|winter|ice|frozen/],
  ["beach", /bãi biển|bờ biển|biển xanh|bãi cát|sóng biển|beach|seaside|shore|ocean/],
  ["stream", /suối|dòng sông|bờ sông|ao sen|hồ nước|stream|river|pond|lake/],
  ["rain", /trời mưa|cơn mưa|mưa rơi|giọt mưa|rain|storm|puddle/],
  ["sky", /bầu trời|đám mây|trên mây|cầu vồng|bay lên cao|sky|cloud|rainbow|flying high/],
  ["school", /trường|lớp học|cô giáo|sân chơi|school|classroom|playground|teacher/],
  ["bedroom", /phòng ngủ|giường|đi ngủ|chăn ấm|gối|bedroom|bed|blanket|pillow/],
  ["garden", /khu vườn|vườn hoa|vườn rau|bông hoa|garden|flower|vegetable/],
  ["village", /làng|đồng lúa|cánh đồng|cây đa|lũy tre|giếng|ruộng|village|rice field|countryside|farm/],
  ["home", /trong nhà|căn bếp|nhà bếp|bàn ăn|mái nhà|ngôi nhà|home|kitchen|house|living room/],
  ["forest-night", /(rừng|forest|woods).{0,40}(đêm|trăng|tối|night|moon)|(đêm|trăng|night|moon).{0,40}(rừng|forest|woods)|đom đóm|firefl/],
  ["forest", /rừng|cây cối|bìa rừng|forest|woods|jungle|tree/],
];

const THEME_DEFAULT: Record<string, SceneId> = {
  cotich: "village",
  phieuluu: "forest",
  ngungon: "bedroom",
  dongvat: "forest",
  hocchoi: "garden",
  tuviet: "sky",
};

/** Night-only settings for bedtime pages without a clear place. */
const NIGHTLIKE = /đêm|buổi tối|trăng|ngôi sao|ngủ|night|moon|star|sleep/;

/**
 * Pick scene art for a page: authored id → place keywords in the scene /
 * illustration text → (night words) → theme default.
 */
export function sceneForPage(input: {
  sceneId?: string | null;
  sceneDescription?: string | null;
  illustration?: string | null;
  text?: string | null;
  theme?: string | null;
}): SceneId {
  if (isSceneId(input.sceneId)) return input.sceneId;
  const scene = `${input.sceneDescription ?? ""} ${input.illustration ?? ""}`.toLowerCase();
  for (const [id, re] of RULES) if (re.test(scene)) return id;
  const text = (input.text ?? "").toLowerCase();
  for (const [id, re] of RULES) if (re.test(text)) return id;
  if (NIGHTLIKE.test(`${scene} ${text}`)) return input.theme === "phieuluu" ? "forest-night" : "bedroom";
  return THEME_DEFAULT[input.theme ?? ""] ?? "forest";
}
