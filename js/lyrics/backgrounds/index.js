import { normalizeTuning } from '../registry.js';
export function createBackground(host) {
  const layer = document.createElement('div'); layer.className = 'lyric-background'; layer.setAttribute('aria-hidden', 'true');
  const glow = document.createElement('div'); glow.className = 'lyric-background-glow';
  const art = document.createElement('img'); art.className = 'lyric-background-art'; art.alt = '';
  layer.append(glow, art); host.prepend(layer);
  let settings, scene, disposed = false, loading = false, canvasNeeded = false, frame, source = '', imageToken = 0, lastTime = 0, lastBands;
  const observer = new ResizeObserver(() => { if (settings) update(lastTime, lastBands); }); observer.observe(host);
  function setSettings(value) {
    settings = value;
    layer.dataset.background = value.background;
    layer.style.setProperty('--lyric-color', value.color);
    layer.style.setProperty('--bg-opacity', value.backgroundOpacity);
    layer.style.setProperty('--bg-blur', `${value.blur}px`);
    canvasNeeded = ['sora', 'latent'].includes(value.background) || ['diorama', 'fume', 'machi', 'nebbia', 'pendolo', 'hanabi', 'lumiere'].includes(value.mode);
    if (canvasNeeded && !scene && !loading) {
      loading = true;
      import('./canvas.js').then(module => {
        loading = false; if (disposed || !canvasNeeded) return;
        scene = module.createCanvasScene(layer); scene.setSettings(settings, normalizeTuning(settings.mode, settings.modes[settings.mode])); update(lastTime, lastBands);
      }).catch(() => { loading = false; });
    }
    if (scene) scene.setSettings(value, normalizeTuning(value.mode, value.modes[value.mode]));
    if (!canvasNeeded && scene) { scene.destroy(); scene = null; }
    if (value.background === 'url' && value.backgroundUrl) {
      if (!frame || frame.src !== value.backgroundUrl) {
        frame?.remove(); frame = document.createElement('iframe'); frame.title = '自定义背景'; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer'; frame.tabIndex = -1; frame.src = value.backgroundUrl; layer.prepend(frame);
      }
    } else { frame?.remove(); frame = null; }
  }
  function setArtwork(url) {
    const next = settings.image || url || '';
    if (next === source) return;
    source = next; const token = ++imageToken;
    layer.style.removeProperty('--cover-color');
    art.onerror = () => { if (token === imageToken) art.hidden = true; };
    art.hidden = !next; if (next) art.src = next; else art.removeAttribute('src');
    if (!next) return;
    const image = new Image(); image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (disposed || token !== imageToken) return;
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 16, 16);
        const pixels = context.getImageData(0, 0, 16, 16).data; let best = [237, 189, 165], score = 0;
        for (let i = 0; i < pixels.length; i += 4) { const rgb = [...pixels.slice(i, i + 3)], min = Math.min(...rgb), max = Math.max(...rgb), s = (max - min) * (1 - Math.abs((min + max) / 2 - 140) / 255); if (pixels[i + 3] > 180 && s > score) { best = rgb; score = s; } }
        layer.style.setProperty('--cover-color', `rgb(${best.join(' ')})`);
      } catch { /* CORS or opaque cover: use the user's theme color. */ }
    };
    image.src = next;
  }
  function update(time, bands = { low: 0, mid: 0, high: 0 }) {
    if (!settings) return;
    lastTime = time; lastBands = bands;
    const t = settings.motion ? time / 1000 : 0, power = settings.audioReactive ? bands.low : 0;
    glow.style.transform = `translate(${Math.sin(t * .08) * 6}%, ${Math.cos(t * .06) * 5}%) scale(${1 + power * .15}) rotate(${Math.sin(t * .04) * 12}deg)`;
    scene?.render(time, bands);
  }
  return { setSettings, setArtwork, update, destroy() { disposed = true; imageToken++; observer.disconnect(); scene?.destroy(); frame?.remove(); layer.remove(); } };
}
