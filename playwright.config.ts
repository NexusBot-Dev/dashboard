import { defineConfig, devices } from '@playwright/test';
import { APP_URL, BOT_URL, appEnv } from './tests/e2e/support/env.mjs';

// E2E-Tests gegen das gebaute Dashboard mit Fake-Bot, Fake-Discord und echter MariaDB.
// Lokal: MariaDB starten (Zugang über E2E_DB_*), dann `npm run test:e2e`.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Ein Worker: alle Tests teilen sich Fake-Bot und Datenbank
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optional ein vorhandenes Chromium nutzen statt `npx playwright install`
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: [
    {
      command: 'node tests/e2e/support/fake-backends.mjs',
      url: `${BOT_URL}/__test/health`,
      reuseExistingServer: false,
    },
    {
      command: 'npm run build && node dist/server/entry.mjs',
      url: `${APP_URL}/`,
      env: appEnv(),
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
