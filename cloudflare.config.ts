import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'cplayer5',
    entrypoint: './sites/worker.js',
    compatibilityDate: '2026-11-07',
    workersDev: true,
    env: { ASSETS: bindings.assets() },
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
