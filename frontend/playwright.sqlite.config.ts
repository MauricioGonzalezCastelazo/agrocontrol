import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const python = existsSync('../.venv/Scripts/python.exe')
  ? resolve('../.venv/Scripts/python.exe')
  : existsSync('../.venv/bin/python')
    ? resolve('../.venv/bin/python')
    : 'python'
export default defineConfig({
  testDir: './sqlite-e2e',
  outputDir: '../.local/sqlite-e2e-results',
  workers: 1,
  timeout: 90000,
  reporter: 'list',
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:5177', channel: 'chromium', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-sqlite', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-sqlite', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: `"${python}" -m tests.sqlite_browser_server`,
      cwd: '../backend',
      url: 'http://127.0.0.1:8102/health/live',
      env: { AGROCONTROL_SQLITE_BROWSER_TEST: '1' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177',
      reuseExistingServer: false,
      env: {
        VITE_ENABLE_LOCAL_WORKSPACE: 'true',
        VITE_LEGACY_LOCAL_TESTS: 'false',
        VITE_LOCAL_API_URL: 'http://127.0.0.1:8102/api/v1',
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
        VITE_ORGANIZATION_ID: '',
      },
    },
  ],
})
