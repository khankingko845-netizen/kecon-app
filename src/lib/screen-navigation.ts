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
/** A solitary Create screen still needs an exit; other tab roots stay roots. */
export function backScreenHistory(history: ScreenState[]): ScreenState[] {
 if (history.length > 1) return history.slice(0, -1);
 if (history[0]?.screen === 'create') return [{ screen: 'home' }];
 return history;
}
