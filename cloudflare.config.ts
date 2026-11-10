import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'cplayer5',
    entrypoint: './sites/worker.js',
    compatibilityDate: '2026-11-07',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    previewUrls: true,
    domains: ['music.505zc.tech'],
    env: {
      ASSETS: bindings.assets(),
      // Opt in after creating the database and applying migrations. Secrets are
      // uploaded separately; never put provider secrets in this config.
      ...(process.env.CPLAYER_ACCOUNTS_D1_ID ? {
        ACCOUNTS_DB: bindings.d1({ id: process.env.CPLAYER_ACCOUNTS_D1_ID }),
        AUTH_URL: bindings.json('https://music.505zc.tech'),
      } : {}),
    },
    // Keep homepage metadata rewriting and all APIs in the Worker. Other
    // assets can be served directly without invoking JavaScript.
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/', '/index.html', '/api/*'],
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
  },
});
