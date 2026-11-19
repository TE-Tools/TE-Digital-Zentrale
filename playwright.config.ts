import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests (Phase 7): echte PWA + Worker lokal, auf Desktop- und Handy-Größe.
 * Vorher: npm run build (der Server liefert apps/web/dist aus).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8788',
    trace: 'retain-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'handy', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:8788/api/gesundheit',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
