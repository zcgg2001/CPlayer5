import { packager } from '@electron/packager';
import { readFileSync } from 'node:fs';
// Use checksums shipped with the pinned Electron package; keep checksum verification
// while avoiding a redundant remote SHASUMS request on every local build.
const checksums = JSON.parse(readFileSync(new URL('../node_modules/electron/checksums.json', import.meta.url), 'utf8'));
const paths = await packager({ dir: 'desktop', out: 'desktop/dist', name: 'CPlayer5', electronVersion: '45.2.3', download: { checksums }, overwrite: true, asar: true, prune: false, ignore: [/\/dist($|\/)/], platform: process.platform, arch: process.arch });
console.log(paths.join('\n'));
