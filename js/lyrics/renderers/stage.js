import { createLyricText } from './words.js';
import { clamp } from '../document.js';
import { rendererFor, normalizeTuning } from '../registry.js';

export function createStage(container, { onSeek } = {}) {
  const stage = document.createElement('div'); stage.className = 'lyric-stage'; stage.setAttribute('aria-label', '歌词舞台');
  const art = document.createElement('img'); art.className = 'lyric-stage-art'; art.alt = ''; art.hidden = true;
  const decor = document.createElement('div'); decor.className = 'lyric-stage-decor'; decor.setAttribute('aria-hidden', 'true');
  const linesHost = document.createElement('div'); linesHost.className = 'lyric-stage-lines';
  const caption = document.createElement('div'); caption.className = 'lyric-stage-caption';
  stage.append(art, decor, linesHost, caption); container.append(stage);
  let doc = { lines: [] }, settings, tuning, nodes = [], selection = '', size = { width: 500, height: 400 }, needsLayout = true, lastTime = 0, layoutCenter = -1;
  const observer = new ResizeObserver(entries => { const rect = entries[0].contentRect; size = { width: rect.width, height: rect.height }; needsLayout = true; update(lastTime); }); observer.observe(stage);
  function setSettings(value) {
    settings = value; tuning = normalizeTuning(value.mode, value.modes[value.mode]);
    stage.dataset.mode = value.mode;
    stage.style.setProperty('--lyric-size', `${value.fontSize}px`);
    stage.style.setProperty('--lyric-line-height', value.lineHeight);
    stage.style.setProperty('--lyric-opacity', value.opacity);
    stage.style.setProperty('--subtitle-opacity', value.subtitleOpacity);
    stage.style.fontFamily = value.font; stage.style.textAlign = value.align;
    stage.dataset.translation = String(value.translation); stage.dataset.romanization = String(value.romanization);
    for (const [key, val] of Object.entries(tuning)) stage.style.setProperty(`--tune-${key}`, val);
    selection = ''; needsLayout = true;
  }
  function update(time) {
    lastTime = time;
    if (!settings) return;
    const active = doc.lines.filter(line => line.start <= time + settings.lead && line.end > time && line.text);
    const primary = active.find(line => !line.harmony) || active[0];
    const at = primary ? doc.lines.indexOf(primary) : doc.lines.findIndex(line => line.start > time);
    const center = at < 0 ? doc.lines.length - 1 : at;
    if (layoutCenter !== center) { layoutCenter = center; needsLayout = true; }
    const count = settings.mode === 'claddagh' ? 3 : settings.mode === 'cappella' ? 2 : 1;
    const selected = doc.lines.slice(Math.max(0, center - count), center + count + 1).filter(line => line.text);
    for (const line of active) if (!selected.includes(line)) selected.push(line);
    const key = selected.map(line => line.id).join('|');
    if (key !== selection) {
      selection = key; nodes = selected.map(line => createLyricText(line, onSeek)); needsLayout = true;
      linesHost.replaceChildren(...nodes.map(node => node.element));
    }
    const motionTime = settings.motion ? time / 1000 : 0;
    for (const node of nodes) {
      const index = doc.lines.indexOf(node.line), delta = index - center, isActive = active.includes(node.line);
      node.update(time, isActive, settings, tuning);
      node.element.classList.toggle('is-harmony', node.line.harmony);
      node.element.dataset.side = String(node.line.agent ? [...node.line.agent].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 : index % 2);
      node.element.dataset.role = delta < 0 ? 'previous' : delta > 0 ? 'next' : 'current';
      node.element.hidden = !settings.upcoming && delta > 0 && !isActive;
      const elapsed = time - node.line.start, entrance = settings.motion ? clamp((elapsed + settings.lead) / 420) : 1;
      let transform = `translateY(${(1 - entrance) * 14 * settings.motion}px)`;
      if (settings.mode === 'claddagh') {
        const phase = primary && Number.isFinite(primary.end) ? clamp((time - primary.start) / Math.max(1, primary.end - primary.start)) : 0;
        const angle = delta * .7 - (phase - .5) * .12 * settings.motion;
        const radius = Math.min(size.width, size.height) * tuning.radius;
        transform = `translate(${Math.sin(angle) * radius}px, ${delta === 0 ? 0 : Math.cos(angle) * radius * Math.sign(delta)}px) rotate(${delta === 0 ? 0 : tuning.incline}deg) scale(${delta === 0 ? 1 : .65})`;
      } else if (settings.mode === 'fume') {
        transform = `perspective(800px) translate3d(${delta * 18}px, ${delta * 105}px, ${-Math.abs(delta) * tuning.depth * 150}px) rotateY(${Math.sin(motionTime * tuning.speed) * settings.motion * 7}deg)`;
      } else if (settings.mode === 'diorama') {
        transform = `perspective(900px) rotateY(${Math.sin(motionTime * tuning.speed * .3) * settings.motion * 14}deg) translateY(${delta * 110}px)`;
      } else if (settings.mode === 'pendolo') {
        transform += ` rotate(${Math.sin(motionTime * tuning.speed * .3) * settings.motion * 3}deg)`;
      }
      node.element.style.transform = transform;
      node.element.style.setProperty('--line-index', index);
      node.element.style.setProperty('--line-enter', entrance);
    }
    decor.style.transform = settings.mode === 'pendolo' ? `rotate(${motionTime * tuning.speed * 8}deg)` : '';
    const text = !doc.lines.length ? doc.plain || '纯音乐 · 让旋律继续' : !primary ? (time < doc.lines[0].start ? '前奏' : time >= doc.lines.at(-1).end ? '尾声' : '间奏') : '';
    if (caption.textContent !== text) caption.textContent = text;
    caption.hidden = !text;
    stage.dataset.interlude = String(!primary);
    if (needsLayout && size.width && size.height && nodes.length) {
      needsLayout = false; stage.style.fontSize = '';
      nodes.forEach(node => { node.element.style.maxHeight = ''; node.element.style.overflowY = ''; });
      const base = parseFloat(getComputedStyle(stage).fontSize);
      const spatial = ['claddagh', 'fume', 'diorama'].includes(settings.mode);
      const needed = spatial ? Math.max(...nodes.map(node => node.element.scrollHeight)) : nodes.reduce((sum, node) => sum + (node.element.hidden ? 0 : node.element.scrollHeight), 0) + (nodes.length - 1) * 24;
      const available = Math.max(80, size.height - 80) * (spatial ? .65 : 1);
      if (needed > available) stage.style.fontSize = `${Math.min(base, Math.max(16, base * available / needed))}px`;
      // Keep unusually long imported verses readable after the minimum font size is reached.
      for (const node of nodes.filter(node => active.includes(node.line))) {
        const limit = available * (spatial ? 1 : .72);
        if (node.element.scrollHeight > limit) {
          node.element.style.maxHeight = `${limit}px`;
          node.element.style.overflowY = 'auto';
        }
      }
    }
  }
  return {
    element: stage, setSettings, update,
    setDocument(value) { doc = value; selection = ''; },
    setArtwork(url) { if (url) { art.src = url; art.hidden = false; } else { art.removeAttribute('src'); art.hidden = true; } },
    destroy() { observer.disconnect(); stage.remove(); nodes = []; },
  };
}
