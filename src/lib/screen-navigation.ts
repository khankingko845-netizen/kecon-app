import type { Screen } from '@/lib/types';
export interface ScreenState {
 screen: Screen;
 data?: Record<string, string>;
}
/** Create is a full-screen flow (no tab bar), so retain the visible origin. */
export function tabScreenHistory(current: ScreenState, screen: Screen): ScreenState[] {
 if (screen === 'create' && current.screen !== 'create') return [current, { screen }];
 return [{ screen }];
}
/**
 * Screens that can be the only history entry without being a tab root: they
 * open straight from a link (`/?screen=…`, e.g. the G-07 reminder), so Back
 * goes to the screen they are normally reached from.
 */
const SOLITARY_BACK: Partial<Record<Screen, Screen>> = { 'parent-week': 'settings', sky: 'home' };
/** A solitary Create screen still needs an exit; other tab roots stay roots. */
export function backScreenHistory(history: ScreenState[]): ScreenState[] {
 if (history.length > 1) return history.slice(0, -1);
 if (history[0]?.screen === 'create') return [{ screen: 'home' }];
 const parent = history.length === 1 ? SOLITARY_BACK[history[0].screen] : undefined;
 return parent ? [{ screen: parent }] : history;
}
/**
 * G-07: screens a notification click may open inside the app. The service
 * worker opens `/?screen=parent-week` in a new window, or — when the app is
 * already open — posts the same URL to it. Navigation still goes through the
 * feature flag and the parent gate.
 */
const NOTIFICATION_SCREENS: readonly Screen[] = ['parent-week'];
export function notificationScreen(url: string | null | undefined, origin: string): Screen | null {
 if (!url) return null;
 try {
  const target = new URL(url, origin);
  if (target.origin !== origin) return null;
  const screen = target.searchParams.get('screen');
  return screen && (NOTIFICATION_SCREENS as readonly string[]).includes(screen) ? (screen as Screen) : null;
 } catch {
  return null;
 }
}
