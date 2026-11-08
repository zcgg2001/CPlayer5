import { BACKGROUNDS, RENDERERS, normalizeTuning } from './registry.js';
const KEY = 'cp_lyricStudio_v1';
export const DEFAULT_STUDIO = Object.freeze({
  version: 1, view: 'auto', background: 'common', color: '#edbda5', font: 'sans-serif', align: 'center',
  lineHeight: 1.6, opacity: 1, subtitleOpacity: .7, motion: .65, backgroundOpacity: .65,
  blur: 24, quality: 'auto', translation: true, romanization: false, upcoming: true,
  audioReactive: true, fountain: true, fountainStrength: .45, offset: 0, lead: 180, image: '', backgroundUrl: '', modes: {},
});
export function normalizeStudio(value = {}) {
  const output = { ...DEFAULT_STUDIO, modes: {} };
  const ranges = { lineHeight: [1.2, 2.4], opacity: [.3, 1], subtitleOpacity: [.2, 1], motion: [0, 1], fountainStrength: [.1, 1], backgroundOpacity: [0, 1], blur: [0, 60], offset: [-10000, 10000], lead: [0, 500] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (Number.isFinite(value?.[key])) output[key] = Math.max(min, Math.min(max, value[key]));
  for (const key of ['translation', 'romanization', 'upcoming', 'audioReactive', 'fountain']) if (typeof value?.[key] === 'boolean') output[key] = value[key];
  for (const [key, valid] of Object.entries({ view: ['auto', 'list', 'stage'], background: BACKGROUNDS.map(x => x[0]), font: ['sans-serif', 'serif', 'monospace'], align: ['left', 'center', 'right'], quality: ['auto', 'low', 'medium', 'high'] })) if (valid.includes(value?.[key])) output[key] = value[key];
  if (/^#[0-9a-f]{6}$/i.test(value?.color)) output.color = value.color;
  if (typeof value?.image === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(value.image) && value.image.length < 1_000_000) output.image = value.image;
  try { const url = new URL(value?.backgroundUrl); if (url.protocol === 'https:' && !url.username && !url.password) output.backgroundUrl = url.href; } catch { /* Blank or malformed. */ }
  for (const mode of RENDERERS) if (value?.modes?.[mode.id]) output.modes[mode.id] = normalizeTuning(mode.id, value.modes[mode.id]);
  return output;
}
export function readStudio(storage) { try { return normalizeStudio(JSON.parse(storage.getItem(KEY))); } catch { return normalizeStudio(); } }
export function saveStudio(storage, value) { try { storage.setItem(KEY, JSON.stringify(normalizeStudio(value))); return true; } catch { return false; } }
export function importStudio(text) { const data = JSON.parse(text); if (data?.version !== 1 || typeof data !== 'object') throw new Error('不支持此配置版本'); return normalizeStudio({ ...data, offset: 0 }); }
