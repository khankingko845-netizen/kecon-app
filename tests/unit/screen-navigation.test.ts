import { describe, expect, it } from 'vitest';
import { backScreenHistory, tabScreenHistory, type ScreenState } from '@/lib/screen-navigation';
describe('full-screen Create back navigation',()=>{
 it.each(['home','library','profiles','settings'] as const)('Create retains visible %s origin',screen=>{const origin={screen};const entered=tabScreenHistory(origin,'create');expect(entered).toEqual([origin,{screen:'create'}]);expect(backScreenHistory(entered)).toEqual([origin]);});
 it('keeps origin data and does not mutate history',()=>{const origin:ScreenState={screen:'library',data:{category:'animal'}};const entered=tabScreenHistory(origin,'create');const before=JSON.stringify(entered);expect(backScreenHistory(entered)).toEqual([origin]);expect(JSON.stringify(entered)).toBe(before);expect(origin.data).toEqual({category:'animal'});});
 it('solitary Create falls back to Home',()=>expect(backScreenHistory([{screen:'create'}])).toEqual([{screen:'home'}]));
 it('other root tabs retain existing semantics',()=>{const h:ScreenState[]=[{screen:'home'}];expect(backScreenHistory(h)).toBe(h);expect(tabScreenHistory({screen:'home'},'library')).toEqual([{screen:'library'}]);});
 it('nested navigation pops once, no duplicate Create origins',()=>{expect(backScreenHistory([{screen:'library'},{screen:'create'},{screen:'recording'}])).toEqual([{screen:'library'},{screen:'create'}]);expect(tabScreenHistory({screen:'create'},'create')).toEqual([{screen:'create'}]);});
});
