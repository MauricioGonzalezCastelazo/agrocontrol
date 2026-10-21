import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './production-e2e',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chromium' },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
