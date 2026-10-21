import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

function offlineShell(): Plugin {
  return {
    name: 'agrocontrol-public-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const assets = [
        '/index.html',
        '/favicon.svg',
        ...Object.keys(bundle)
          .filter((name) => name.startsWith('assets/'))
          .map((name) => `/${name}`),
      ]
      const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 20)
      const source = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
        .replace('__PRECACHE__', JSON.stringify(assets))
        .replace('__SHELL_VERSION__', `agrocontrol-shell-${version}`)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), offlineShell()],
  build: { target: ['es2022', 'safari16.4'] },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
