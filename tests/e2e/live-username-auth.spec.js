import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4181';
const enabled = process.env.LIVE_AUTH_E2E === '1';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

test('real username signup, login and recovery-code reset', async ({ page }) => {
  test.skip(!enabled, 'Set LIVE_AUTH_E2E=1 with Supabase service variables to run the destructive temporary-account flow.');
  expect(supabaseUrl).toBeTruthy();
  expect(serviceKey).toBeTruthy();

  const username = `web_${crypto.randomBytes(6).toString('hex')}`;
  const password = `Start9-${crypto.randomUUID()}`;
  const nextPassword = `Next9-${crypto.randomUUID()}`;
  const browserErrors = [];
  let userId = '';
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });

  try {
    await page.goto(`${baseUrl}/#/signup`, { waitUntil: 'networkidle' });
    await page.getByLabel('이름').fill('브라우저 통합 점검');
    await page.getByLabel('아이디').fill(username);
    await page.locator('#signup-password').fill(password);
    await page.locator('input[name="consent"]').check();
    await page.getByRole('button', { name: '회원가입' }).click();

    await expect(page.getByRole('heading', { name: '계정 복구 코드를 저장하세요' })).toBeVisible({ timeout: 20_000 });
    const firstRecoveryCode = (await page.locator('#recovery-code').innerText()).trim();
    expect(firstRecoveryCode).toMatch(/^(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    const session = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.endsWith(':supabase-session'));
      return key ? JSON.parse(localStorage.getItem(key)) : null;
    });
    userId = session?.user?.id || '';
    expect(userId).toMatch(/^[0-9a-f-]{36}$/i);
    await page.getByRole('button', { name: '저장 완료' }).click();
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${baseUrl}/#/login`);
    await page.getByLabel('아이디').fill(username.toUpperCase());
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page.getByRole('heading', { name: /브라우저 통합 점검님.*읽는 힘/ }).first()).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${baseUrl}/#/reset-password`);
    await page.getByLabel('아이디').fill(username);
    await page.getByLabel('복구 코드').fill(firstRecoveryCode);
    await page.getByLabel('새 비밀번호', { exact: true }).fill(nextPassword);
    await page.getByLabel('새 비밀번호 확인').fill(nextPassword);
    await page.getByRole('button', { name: '비밀번호 변경' }).click();

    await expect(page.getByRole('heading', { name: '계정 복구 코드를 저장하세요' })).toBeVisible({ timeout: 20_000 });
    const rotatedRecoveryCode = (await page.locator('#recovery-code').innerText()).trim();
    expect(rotatedRecoveryCode).not.toBe(firstRecoveryCode);
    expect(browserErrors).toEqual([]);
  } finally {
    if (userId && supabaseUrl && serviceKey) {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      }).catch(() => null);
    }
  }
});
