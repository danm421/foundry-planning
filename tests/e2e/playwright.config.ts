import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  use: {
    headless: true,
    baseURL: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
