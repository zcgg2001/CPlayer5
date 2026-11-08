import { createLyricClock } from './clock.js';
import { normalizeDocument, seekTime } from './document.js';
import { rendererFor, normalizeTuning } from './registry.js';
import { createStage } from './renderers/stage.js';
import { createLyricText } from './renderers/words.js';
import { createBackground } from './backgrounds/index.js';
import { createMusicFountain } from './backgrounds/fountain.js';

export function elementVisible(element) {
  return !document.hidden && !element.closest('[inert], [aria-hidden="true"]:not(#lyricEffectPreview)') && (element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : element.getClientRects().length > 0);
}

function createSurface(scroller, { onSeek, onFollow, preview = false }) {
  const host = document.createElement('div'); host.className = 'lyric-surface'; host.dataset.preview = String(preview);
  scroller.before(host); host.append(scroller); scroller.dataset.lyricRuntime = 'true';
  const background = createBackground(host), stage = createStage(host, { onSeek: preview ? undefined : onSeek });
  const fountainHost = preview ? host : document.getElementById(scroller.id === 'lyricsScroller' ? 'desktopLayout' : 'mobileMainView');
  const fountain = fountainHost ? createMusicFountain(fountainHost) : null;
  const info = document.createElement('div'); info.className = 'lyric-source-badge'; host.append(info);
  let doc = normalizeDocument({ lines: [] }), settings, nodes = [], previous = new Set(), activeKey = '', enabled = false;
  function setDocument(value) {
    doc = value; stage.setDocument(doc); activeKey = ''; previous = new Set(); enabled = true;
    nodes = doc.lines.filter(line => line.text).map(line => {
      const node = createLyricText(line, preview ? undefined : onSeek, 'lrc-line');
      node.element.querySelector('.lyric-word-text').classList.add('lrc-text');
      node.element.dataset.time = line.start / 1000; node.element.dataset.idx = doc.lines.indexOf(line); node.element.tabIndex = -1;
      return node;
    });
    scroller.replaceChildren(...nodes.map(node => node.element));
    if (!nodes.length) { const message = document.createElement('p'); message.className = 'lyric-plain'; message.textContent = doc.plain || '纯音乐 / 暂无歌词'; scroller.append(message); }
    info.textContent = `${doc.source} · ${doc.hasWordLevel ? '逐字' : doc.lines.length ? '逐行' : doc.plain ? '纯文本' : '暂无歌词'}`;
    if (settings) setSettings(settings);
  }
  function setSettings(value) {
    settings = value;
    const stageView = doc.lines.length > 0 && (value.view === 'stage' || value.view === 'auto' && rendererFor(value.mode).view === 'stage');
    stage.element.hidden = !stageView || !enabled; scroller.hidden = stageView && enabled;
    host.dataset.view = stageView ? 'stage' : 'list'; host.dataset.enabled = String(enabled);
    host.style.setProperty('--lyric-color', value.color);
    host.style.setProperty('--lyric-size', `${value.fontSize}px`);
    host.style.setProperty('--lyric-line-height', value.lineHeight);
    host.style.setProperty('--lyric-opacity', value.opacity);
    host.style.setProperty('--subtitle-opacity', value.subtitleOpacity);
    host.style.setProperty('--list-blur', `${normalizeTuning('amll', value.modes.amll).blur}px`);
    host.style.fontFamily = value.font; host.style.textAlign = value.align;
    host.dataset.translation = String(value.translation); host.dataset.romanization = String(value.romanization);
    background.setSettings(value); stage.setSettings(value); fountain?.setSettings(value);
  }
  function update(time, bands) {
    const visible = enabled && elementVisible(host);
    fountain?.setVisible(visible);
    if (!visible) return;
    const t = time + doc.offset + settings.offset;
    background.update(time, bands); fountain?.update(time, bands);
    if (!stage.element.hidden) return stage.update(t);
    const active = nodes.filter(node => node.line.start <= t + settings.lead && node.line.end > t);
    const indexes = new Set(active.map(node => nodes.indexOf(node)));
    const first = indexes.values().next().value;
    const changed = [...indexes].join(',') !== activeKey;
    const affected = new Set([...previous, ...indexes]);
    if (changed) {
      for (const idx of [...affected]) { affected.add(idx - 1); affected.add(idx + 1); }
      activeKey = [...indexes].join(',');
    }
    for (const idx of affected) {
      const node = nodes[idx]; if (!node) continue;
      node.update(t, indexes.has(idx), settings, normalizeTuning(settings.mode, settings.modes[settings.mode]));
      node.element.classList.toggle('active', indexes.has(idx));
      node.element.classList.toggle('near', !indexes.has(idx) && (indexes.has(idx + 1) || indexes.has(idx - 1)));
      node.element.tabIndex = idx === first ? 0 : -1;
    }
    if (changed && first !== undefined) {
      const line = nodes[first].element;
      const target = line.offsetTop - scroller.clientHeight / 2 + line.clientHeight / 2;
      if (preview) scroller.scrollTop = target; else onFollow?.(scroller.id, target);
    }
    previous = indexes;
  }
  return {
    host, setDocument, setSettings, update,
    setArtwork(url) { background.setArtwork(url); stage.setArtwork(settings.image || url); },
    status(message) { enabled = false; stage.element.hidden = true; scroller.hidden = false; info.textContent = ''; host.dataset.enabled = 'false'; if (settings) fountain?.setSettings({ ...settings, fountain: false }); const p = document.createElement('p'); p.className = 'lyric-plain'; p.setAttribute('role', 'status'); p.textContent = message; scroller.replaceChildren(p); },
    destroy() { stage.destroy(); background.destroy(); fountain?.destroy(); host.before(scroller); host.remove(); delete scroller.dataset.lyricRuntime; scroller.hidden = false; },
  };
}

export function createLyricRuntime({ audio, scrollers, onFollow, analyser = () => null, preview = false }) {
  let doc = normalizeDocument({ lines: [] }), settings, last = 0, spectrum, artwork = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const effective = value => ({ ...value, motion: reduced.matches || value.mode === 'still' ? 0 : value.motion, audioReactive: value.mode === 'still' ? false : value.audioReactive });
  const onSeek = line => { audio.currentTime = seekTime(doc, line, settings.offset); clock?.sync(); };
  const surfaces = scrollers.filter(Boolean).map(scroller => createSurface(scroller, { onSeek, onFollow, preview }));
  const visible = () => surfaces.some(surface => elementVisible(surface.host));
  function render(time) {
    last = time; if (!settings) return;
    const bands = { low: 0, mid: 0, high: 0 }, meter = settings.audioReactive && !audio?.paused ? analyser() : null;
    if (meter && visible()) {
      if (spectrum?.length !== meter.frequencyBinCount) spectrum = new Uint8Array(meter.frequencyBinCount);
      meter.getByteFrequencyData(spectrum);
      bands.spectrum = spectrum;
      for (const [key, from, to] of [['low', 0, .15], ['mid', .15, .6], ['high', .6, 1]]) { const start = Math.floor(from * spectrum.length), end = Math.floor(to * spectrum.length); bands[key] = spectrum.slice(start, end).reduce((sum, value) => sum + value, 0) / Math.max(1, end - start) / 255; }
    }
    surfaces.forEach(surface => surface.update(time, bands));
  }
  const clock = preview ? null : createLyricClock(audio, render, { visible });
  function refresh() { clock ? clock.sync() : render(last); }
  const visibility = new IntersectionObserver(refresh, { threshold: 0 }); surfaces.forEach(surface => visibility.observe(surface.host));
  const mutations = new MutationObserver(refresh);
  mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  for (const element of [document.getElementById('mobileLyricsPage'), document.getElementById('desktopLayout')].filter(Boolean)) mutations.observe(element, { attributes: true, attributeFilter: ['class', 'inert', 'aria-hidden'] });
  const motionChange = () => { if (settings) surfaces.forEach(surface => surface.setSettings(effective(settings))); refresh(); };
  reduced.addEventListener('change', motionChange);
  return {
    setDocument(value) { doc = value; surfaces.forEach(surface => surface.setDocument(doc)); refresh(); },
    setSettings(value) { settings = value; surfaces.forEach(surface => { surface.setSettings(effective(value)); surface.setArtwork(artwork); }); refresh(); },
    setArtwork(value) { artwork = value || ''; if (settings) surfaces.forEach(surface => surface.setArtwork(artwork)); refresh(); },
    status(message) { surfaces.forEach(surface => surface.status(message)); },
    update: render, refresh, visible,
    destroy() { clock?.destroy(); visibility.disconnect(); mutations.disconnect(); reduced.removeEventListener('change', motionChange); surfaces.forEach(surface => surface.destroy()); },
  };
}
