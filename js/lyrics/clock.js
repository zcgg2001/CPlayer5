// Sample the media clock instead of integrating elapsed wall time (buffering/seek/rate-safe).
export function createLyricClock(audio, render, {
  document: page = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  visible = () => true,
} = {}) {
  let frame = null, destroyed = false, buffering = false;
  const sample = () => render(Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0);
  const running = () => !destroyed && !buffering && !page.hidden && !audio.paused && !audio.ended && audio.readyState >= 2 && visible();
  function stop() { if (frame !== null) cancelFrame(frame); frame = null; }
  function tick() { frame = null; if (destroyed) return; sample(); if (running()) frame = requestFrame(tick); }
  function sync() { stop(); if (destroyed) return; sample(); if (running()) frame = requestFrame(tick); }
  const events = ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange', 'ended', 'emptied'];
  function mediaChange(event) {
    if (event.type === 'waiting') buffering = true;
    if (['playing', 'play', 'seeked', 'emptied'].includes(event.type)) buffering = false;
    sync();
  }
  events.forEach(event => audio.addEventListener(event, mediaChange));
  const fallback = () => { if (frame === null && !page.hidden) sync(); };
  audio.addEventListener('timeupdate', fallback);
  page.addEventListener('visibilitychange', sync);
  return { sync, destroy() { destroyed = true; stop(); events.forEach(event => audio.removeEventListener(event, mediaChange)); audio.removeEventListener('timeupdate', fallback); page.removeEventListener('visibilitychange', sync); } };
}
