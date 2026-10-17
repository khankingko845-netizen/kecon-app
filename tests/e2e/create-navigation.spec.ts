import { test, expect } from '@playwright/test';
import { signInAsMockFamily } from './support/fixtures';
async function openCreate(page: import('@playwright/test').Page) {
 await page.getByRole('navigation', {name:'Điều hướng chính'}).getByRole('button',{name:'Tạo',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Tạo truyện mới',exact:true})).toBeVisible();
}
test('Create tab from Home: Back exits first wizard step to Home', async ({page,context,baseURL})=>{
 await signInAsMockFamily(context,baseURL!);await page.goto('/');await expect(page.getByTestId('home-explore')).toBeVisible();await openCreate(page);await page.getByRole('button',{name:'Quay lại',exact:true}).click();await expect(page.getByTestId('home-explore')).toBeVisible();await expect(page.getByRole('heading',{name:'Tạo truyện mới',exact:true})).toHaveCount(0);
});
test('Create tab from Library: Back returns to Library rather than staying trapped', async ({page,context,baseURL})=>{
 await signInAsMockFamily(context,baseURL!);await page.goto('/');const nav=page.getByRole('navigation',{name:'Điều hướng chính'});await nav.getByRole('button',{name:'Thư viện',exact:true}).click();await expect(nav.getByRole('button',{name:'Thư viện',exact:true})).toHaveAttribute('aria-current','page');await openCreate(page);await page.getByRole('button',{name:'Quay lại',exact:true}).click();await expect(nav.getByRole('button',{name:'Thư viện',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('heading',{name:'Tạo truyện mới',exact:true})).toHaveCount(0);
});
test('Wizard Back first moves one step, then exits; entering twice leaves no trap', async ({page,context,baseURL})=>{
 await signInAsMockFamily(context,baseURL!);await page.goto('/');await openCreate(page);await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();await expect(page.getByRole('progressbar',{name:'Tiến độ tạo truyện'})).toHaveAttribute('aria-valuenow','2');await page.getByRole('button',{name:'Bước trước',exact:true}).click();await expect(page.getByRole('progressbar',{name:'Tiến độ tạo truyện'})).toHaveAttribute('aria-valuenow','1');await page.getByRole('button',{name:'Quay lại',exact:true}).click();await expect(page.getByTestId('home-explore')).toBeVisible();await openCreate(page);await page.getByRole('button',{name:'Quay lại',exact:true}).click();await expect(page.getByTestId('home-explore')).toBeVisible();
});
