import type { VoiceProfile, Story, StoryTheme, SoundOption } from "./types";

export const voiceProfiles: VoiceProfile[] = [
  {
    id: "me-lan",
    name: "Mẹ Lan",
    role: "Ấm áp",
    gradient: "from-pink-400 to-pink-600",
    storyCount: 28,
    quality: 92,
    date: "15/3/2025",
    gender: "female",
  },
  {
    id: "bo-hung",
    name: "Bố Hùng",
    role: "Trầm ấm",
    gradient: "from-blue-500 to-blue-700",
    storyCount: 15,
    quality: 88,
    date: "16/3/2025",
    gender: "male",
  },
  {
    id: "ba-ngoai",
    name: "Bà Ngoại",
    role: "Hiền từ",
    gradient: "from-amber-400 to-amber-500",
    storyCount: 12,
    quality: 75,
    date: "20/3/2025",
    gender: "female",
  },
];

export const stories: Story[] = [
  {
    id: "ho-guom",
    title: "Sự Tích Hồ Gươm",
    duration: "8 phút",
    voiceId: "bo-hung",
    voiceName: "Bố Hùng",
    category: "Cổ tích",
    gradient: "from-amber-400 to-amber-500",
    icon: "flame",
  },
  {
    id: "tho-con",
    title: "Thỏ Con Dũng Cảm",
    duration: "6 phút",
    voiceId: "me-lan",
    voiceName: "Mẹ Lan",
    category: "AI",
    gradient: "from-emerald-400 to-emerald-600",
    icon: "rabbit",
  },
  {
    id: "tam-cam",
    title: "Tấm Cám",
    duration: "12 phút",
    voiceId: "ba-ngoai",
    voiceName: "Bà Ngoại",
    category: "Cổ tích",
    gradient: "from-violet-400 to-violet-600",
    icon: "castle",
  },
  {
    id: "tien-ca",
    title: "Nàng Tiên Cá",
    duration: "10 phút",
    voiceId: "me-lan",
    voiceName: "Mẹ Lan",
    category: "Quốc tế",
    gradient: "from-pink-400 to-pink-500",
    icon: "wand",
  },
  {
    id: "vu-tru",
    title: "Du Hành Vũ Trụ",
    duration: "7 phút",
    voiceId: "bo-hung",
    voiceName: "Bố Hùng",
    category: "AI",
    gradient: "from-blue-500 to-blue-700",
    icon: "rocket",
  },
  {
    id: "su-tu",
    title: "Sư Tử Gan Dạ",
    duration: "5 phút",
    voiceId: "ba-ngoai",
    voiceName: "Bà Ngoại",
    category: "AI",
    gradient: "from-amber-400 to-amber-500",
    icon: "paw",
  },
];

export const storyThemes: StoryTheme[] = [
  { id: "cotich", name: "Cổ Tích VN", icon: "castle" },
  { id: "phieuluu", name: "Phiêu Lưu", icon: "rocket" },
  { id: "ngungon", name: "Ngủ Ngon", icon: "moon" },
  { id: "dongvat", name: "Động Vật", icon: "paw" },
  { id: "hocchoi", name: "Học & Chơi", icon: "blocks" },
  { id: "tuviet", name: "Tự Viết", icon: "pencil" },
];

export const soundOptions: SoundOption[] = [
  { id: "rain", name: "Mưa", icon: "cloud-rain" },
  { id: "waves", name: "Sóng", icon: "waves" },
  { id: "music", name: "Nhạc", icon: "music" },
  { id: "night", name: "Đêm", icon: "bug" },
];

export const familyTree = {
  grandparents: [
    { ...voiceProfiles[2], active: true },
    { id: "ong-ngoai", name: "Ông Ngoại", role: "", gradient: "from-gray-300 to-gray-400", storyCount: 0, quality: 0, date: "", gender: "male" as const },
  ],
  parents: [voiceProfiles[0], voiceProfiles[1]],
  children: [
    { id: "be-minh", name: "Bé Minh", role: "Người nghe", gradient: "from-emerald-400 to-emerald-600", gender: "male" as const },
    { id: "be-mai", name: "Bé Mai", role: "Người nghe", gradient: "from-pink-400 to-pink-500", gender: "female" as const },
  ],
};
