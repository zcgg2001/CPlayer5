import { wordProgress } from '../document.js';

export function createLyricText(line, onSeek, className = 'lyric-stage-line') {
  const element = document.createElement(onSeek ? 'button' : 'div');
  if (onSeek) { element.type = 'button'; element.addEventListener('click', () => onSeek(line)); element.setAttribute('aria-label', `跳转到：${line.text}`); }
  element.className = className;
  element.dataset.lineId = line.id;
  const text = document.createElement('span'); text.className = 'lyric-word-text';
  const segments = globalThis.Intl?.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(line.text)].map(x => x.segment) : line.text.split(/(\s+)/);
  const words = line.words.length ? line.words : segments.map(text => ({ text, start: line.start, end: line.end }));
  const spans = words.map((word, index) => {
    const span = document.createElement('span'); span.className = 'lyric-timed-word'; span.textContent = word.text; span.style.setProperty('--word-index', index); text.append(span); return span;
  });
  element.append(text);
  for (const [key, cls] of [['translation', 'lyric-translation'], ['romanization', 'lyric-romanization']]) if (line[key]) {
    const subtitle = document.createElement('span'); subtitle.className = cls; subtitle.textContent = line[key]; element.append(subtitle);
  }
  let previous = '', arrangement = '';
  return { element, line, update(time, active, settings, tuning = {}) {
    if (arrangement !== settings.mode) {
      arrangement = settings.mode;
      if (settings.mode === 'cloud') {
        const groups = [], perGroup = Math.max(1, Math.ceil(spans.length / 3));
        for (let i = 0; i < spans.length; i += perGroup) { const phrase = document.createElement('span'); phrase.className = 'lyric-phrase'; phrase.append(...spans.slice(i, i + perGroup)); groups.push(phrase); }
        text.replaceChildren(...groups);
      } else text.replaceChildren(...spans);
    }
    const state = active ? 'active' : time >= line.end ? 'past' : 'future';
    if (state !== previous) { element.dataset.state = state; element.setAttribute('aria-current', active ? 'true' : 'false'); previous = state; }
    spans.forEach((span, i) => {
      const progress = line.words.length ? wordProgress(words[i], time) : active || time >= line.end ? 1 : 0;
      span.style.setProperty('--word-progress', `${(progress * 100).toFixed(2)}%`);
      const singing = line.words.length && time >= words[i].start && time < words[i].end;
      span.classList.toggle('is-singing', !!singing);
      const wave = singing ? Math.sin(progress * Math.PI) * settings.motion : 0;
      span.style.transform = ['glow', 'bounce', 'cadenza'].includes(settings.mode) ? `translateY(${-wave * (tuning.lift ?? tuning.float ?? 4)}px) rotate(${wave * (tuning.rotation || 0)}deg) scale(${1 + wave * ((tuning.emphasis || 1.03) - 1)})` : '';
    });
  } };
}
