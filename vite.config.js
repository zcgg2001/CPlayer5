import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

const staticEntry = '\0cplayer-static-assets';

export default defineConfig({
  // Preserve the existing HTML, ES modules and service-worker asset URLs.
  // Vite bundles only the Worker; the normal build provides public files.
  publicDir: 'dist/static',
  plugins: [
    {
      name: 'cplayer-static-assets',
      resolveId(id) { if (id === 'virtual:cplayer-static-assets') return staticEntry; },
      load(id) { if (id === staticEntry) return 'export {};'; },
      generateBundle(_options, bundle) {
        for (const [name, chunk] of Object.entries(bundle)) {
          if (chunk.type === 'chunk' && chunk.facadeModuleId === staticEntry) delete bundle[name];
        }
      },
    },
    cloudflare(),
  ],
  build: {
    outDir: '.cloudflare/build',
    rollupOptions: { input: 'virtual:cplayer-static-assets' },
  },
  server: { host: '127.0.0.1', port: 8793, strictPort: true },
  preview: { host: '127.0.0.1', port: 8794, strictPort: true },
});
