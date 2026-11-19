import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const hier = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Static-Assets-Verzeichnis muss existieren, auch wenn die PWA noch nicht gebaut wurde.
mkdirSync(hier('../web/dist'), { recursive: true });

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: hier('./wrangler.jsonc') },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(hier('./migrations')),
          EINRICHTUNGSCODE: 'test-einrichtungscode',
          DEV_LOGIN: '1',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
