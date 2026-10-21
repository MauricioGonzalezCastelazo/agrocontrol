import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './local-e2e',
  outputDir: '../.local/local-e2e-results',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5176', channel: 'chromium', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-local', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-local', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: false,
    env: {
      VITE_ENABLE_LOCAL_WORKSPACE: 'true',
      VITE_ENABLE_PREVIEW: 'true',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_ORGANIZATION_ID: '',
    },
  },
})
