import { bindings, defineConfig, triggers } from 'cf/config';

// Resource IDs are public configuration. Keep the production binding across
// deploys; forks and separate environments can override it at build time.
const accountsDatabaseId = process.env.CPLAYER_ACCOUNTS_D1_ID || '77c720f6-2625-4bdf-9c4f-0d8110bdcdd7';

export default defineConfig({
  worker: {
    name: 'cplayer5',
    entrypoint: './sites/worker.js',
    compatibilityDate: '2026-11-07',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    previewUrls: true,
    triggers: [triggers.scheduled({ schedule: '*/15 * * * *' })],
    domains: ['music.505zc.tech'],
    env: {
      ASSETS: bindings.assets(),
      API_RATE_LIMIT: bindings.rateLimit({ namespace: '1001', simple: { limit: 360, period: 60 } }),
      ACCOUNTS_DB: bindings.d1({ id: accountsDatabaseId }),
      AUTH_URL: bindings.json('https://music.505zc.tech'),
    },
    // Keep homepage metadata rewriting and all APIs in the Worker. Other
    // assets can be served directly without invoking JavaScript.
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/', '/index.html', '/api/*', '/admin', '/library', '/artist/*', '/album/*', '/playlist/*', '/robots.txt', '/sitemap.xml'],
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
  },
});
