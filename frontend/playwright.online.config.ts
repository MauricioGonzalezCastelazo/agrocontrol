import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const python = existsSync('../.venv/Scripts/python.exe')
  ? resolve('../.venv/Scripts/python.exe')
  : existsSync('../.venv/bin/python')
    ? resolve('../.venv/bin/python')
    : 'python'
export default defineConfig({
  testDir: './online-e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5175', channel: 'chromium', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: `"${python}" -m tests.browser_server`,
      cwd: '../backend',
      url: 'http://127.0.0.1:8101/health/live',
      env: { AGROCONTROL_BROWSER_TEST: '1', PYTHONPATH: '.' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
      env: {
        VITE_API_URL: 'http://127.0.0.1:8101/api/v1',
        VITE_SUPABASE_URL: 'https://agrocontrol-browser-test.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_isolated_test_key',
        VITE_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
        VITE_ENABLE_PREVIEW: 'false',
      },
    },
  ],
})
