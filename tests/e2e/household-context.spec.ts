import { test, expect } from "@playwright/test";
import { signInAsMockFamily, MOCK_A15_TARGET_ID, MOCK_USER_ID } from "./support/fixtures";
test("T08a self household context is private, actor-bound, independent of optional flags and absent for guests",async({context,baseURL})=>{
 await signInAsMockFamily(context,baseURL!,{userId:MOCK_A15_TARGET_ID});
 const a=await context.request.get('/api/household/context?user_id='+MOCK_USER_ID);expect(a.status()).toBe(200);expect(a.headers()['cache-control']).toContain('private, no-store');expect(a.headers().vary).toContain('Cookie');
 const ca=await a.json();expect(Object.keys(ca).sort()).toEqual(['household_id','role']);expect(ca.role).toBe('owner');
 await signInAsMockFamily(context,baseURL!,{userId:MOCK_USER_ID});const b=await context.request.get('/api/household/context');const cb=await b.json();expect(cb.household_id).not.toBe(ca.household_id);
 await context.clearCookies();expect((await context.request.get('/api/household/context')).status()).toBe(401);
});
