// Read-only smoke probe; prints metadata and audio signatures, never signed URLs or cookies.
import worker from '../sites/worker.js';
import { MUSIC_CHANNELS } from '../js/music-channels.js';
const base = process.argv[2] || 'http://local';
const sources = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(MUSIC_CHANNELS);
const request = (path, options) => base === 'http://local'
  ? worker.fetch(new Request(new URL(path, base), options), {})
  : fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(55_000) });
let failed = false;
for (const source of sources) {
  for (const keyword of ['青花瓷', '晴天', '稻香']) {
    const row = { source, keyword };
    try {
      const response = await request(`/api/v1/music/search?${new URLSearchParams({source,keyword,limit:'10'})}`);
      const result = await response.json();
      row.search = response.status; row.count = result.data?.length || 0;
      if (!response.ok || !row.count) throw new Error(result.error?.message || 'Empty search');
      const song = result.data[0]; row.name = song.name;
      const resolve = await request(`/api/v1/music/song?${new URLSearchParams({source,id:String(song.id),level:'lossless'})}`);
      const data = await resolve.json(); row.resolve = resolve.status;
      if (!resolve.ok || !data.data?.url) throw new Error(data.error?.message || 'No audio URL');
      row.format = data.data.format;
      const audio = await request(data.data.url, {headers:{range:'bytes=0-4095'}});
      row.audio = audio.status;
      if (!audio.ok) throw new Error((await audio.json()).error?.message || 'Audio failed');
      const reader = audio.body.getReader(); const chunk = await reader.read();
      row.bytes = chunk.value?.length || 0;
      row.signature = Buffer.from(chunk.value?.slice(0,8) || []).toString('hex');
      await reader.cancel();
      if (!row.bytes) throw new Error('Empty audio');
    } catch (error) { row.error = error.message; failed = true; }
    console.log(JSON.stringify(row));
  }
}
process.exitCode = failed ? 1 : 0;
