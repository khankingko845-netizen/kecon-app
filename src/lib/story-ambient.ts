import type { AmbientType } from "@/lib/audio-engine";
/** Use scene descriptions, not stray words inside dialogue. Unknown means silence. */
export function ambientForScene(
  scene: string,
  authored?: string | null,
): AmbientType | null {
  const explicit: Record<string, AmbientType> = {
    forest: "forest",
    night: "night",
    ocean: "waves",
    rain: "rain",
    lullaby: "lullaby",
    underwater: "waves",
  };
  if (authored && explicit[authored]) return explicit[authored];
  const t = scene.toLowerCase();
  if (/mưa|\brain\b/.test(t)) return "rain";
  if (/biển|đại dương|\bocean\b|\bbeach\b/.test(t)) return "waves";
  if (/rừng|\bforest\b|\bwoods\b/.test(t)) return "forest";
  if (/đêm|trăng|\bnight\b|\bmoon\b/.test(t)) return "night";
  return null;
}
