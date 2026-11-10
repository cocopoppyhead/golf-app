import { defineConfig, devices } from '@playwright/test';

// End-to-end checks against the built app (vite preview), phone-sized, with weather and
// geolocation stubbed so they run the same everywhere.
export default defineConfig({
  testDir: 'test/e2e',
  outputDir: 'test/e2e/out',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173/golf-app/',
    ...devices['Pixel 7'],
    permissions: ['geolocation'],
    geolocation: { latitude: 25.085782, longitude: 55.159951, accuracy: 8 },
    screenshot: 'only-on-failure',
    // a sandbox with its own Chromium build can point here instead of downloading one
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: { command: 'npm run build && npx vite preview --port 5173 --strictPort', url: 'http://localhost:5173/golf-app/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
