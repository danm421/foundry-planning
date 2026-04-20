// Requires: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, WEB_APP_URL, ADMIN_APP_URL env vars.
// Requires: both apps/web and apps/admin running (see README), and a seeded superadmin in the admin Clerk instance.

import { test, expect } from '@playwright/test';

const ADMIN = process.env.ADMIN_APP_URL ?? 'http://localhost:3001';
const WEB = process.env.WEB_APP_URL ?? 'http://localhost:3000';

test.describe.configure({ mode: 'serial' });

test('admin impersonates advisor end-to-end', async ({ page, context }) => {
  // 1. Sign in as seeded admin via Clerk (test instance)
  await page.goto(`${ADMIN}/`);
  // Clerk test mode exposes a programmatic sign-in helper — fill in seeded admin email/password.
  // If using magic links, swap to Clerk's testing token approach per `@clerk/testing`.
  await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /continue|sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`${ADMIN}/$`));

  // 2. Navigate to advisor detail
  await page.goto(`${ADMIN}/advisors/user_e2e_advisor`);
  await page.getByLabel(/reason/i).fill('e2e-test run');
  await page.getByRole('button', { name: /impersonate/i }).click();

  // 3. Lands on web app /clients with banner
  await page.waitForURL(new RegExp(`${WEB}/clients`));
  await expect(page.getByText(/Impersonating/i)).toBeVisible();

  // 4. Edit a known client field
  await page.getByRole('link', { name: /e2e client/i }).click();
  await page.getByLabel(/first name/i).fill('E2E-Updated');
  await page.getByRole('button', { name: /save/i }).click();

  // 5. End session
  await page.getByRole('button', { name: /end session/i }).click();
  await page.waitForURL(new RegExp(`${ADMIN}/$`));

  // 6. Verify audit rows
  await page.goto(`${ADMIN}/audit?advisor=user_e2e_advisor`);
  await expect(page.getByText('impersonation.start')).toBeVisible();
  await expect(page.getByText('client.update')).toBeVisible();
  await expect(page.getByText('impersonation.end')).toBeVisible();
});
