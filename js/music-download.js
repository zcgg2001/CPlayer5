import { normalizeMediaUrl } from './security.js';

export const DOWNLOAD_QUALITY_OPTIONS = Object.freeze([
  { level: 'standard', label: '标准 128K' },
  { level: 'exhigh', label: '极高 320K' },
  { level: 'lossless', label: '无损' },
  { level: 'hires', label: 'Hi-Res' },
  { level: 'jymaster', label: '超清母带' },
]);

const FALLBACKS = Object.freeze({
  standard: ['standard'],
  exhigh: ['exhigh', 'standard'],
  lossless: ['lossless', 'exhigh', 'standard'],
  hires: ['hires', 'lossless', 'exhigh', 'standard'],
  jymaster: ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'],
});

export function downloadFallbackLevels(level) {
  return [...(FALLBACKS[level] || FALLBACKS.jymaster)];
}

export async function resolveDownloadSong({ id, level, requestSong, baseUrl }) {
  for (const candidate of downloadFallbackLevels(level)) {
    const song = await requestSong(id, candidate);
    const url = normalizeMediaUrl(song?.url, { baseUrl });
    if (url) return { ...song, url, requestedLevel: level, resolvedLevel: candidate };
  }
  throw new Error('No downloadable audio available');
}

export function downloadFilename(song, level) {
  const clean = value => String(value || '未知').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim() || '未知';
  const label = DOWNLOAD_QUALITY_OPTIONS.find(option => option.level === level)?.label.replace(/\s+\d+K$/, '') || '标准';
  const extension = new URL(song.url).pathname.match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)?.[1] || 'mp3';
  return clean(song.name) + ' - ' + clean(song.artist) + ' - ' + label + '.' + extension;
}

export async function saveAudioBlob({ url, filename, fetchImpl = fetch, documentRef = document, urlApi = URL }) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error('Download request failed: ' + response.status);
  const blob = await response.blob();
  if (!blob.size) throw new Error('Downloaded audio was empty');
  const objectUrl = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  documentRef.body.append(anchor);
  anchor.click();
  documentRef.body.removeChild(anchor);
  urlApi.revokeObjectURL(objectUrl);
}
