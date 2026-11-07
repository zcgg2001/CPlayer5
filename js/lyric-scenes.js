import { splitLyricPhrases } from './lyric-composition.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PHRASE_SCENES = new Set(['sonnet', 'tempera', 'hanabi', 'cloud', 'fume']);
export const LYRIC_SCENE_IDS = Object.freeze(['sonnet', 'tempera', 'lumiere', 'hanabi', 'machi', 'nebbia', 'glow', 'cloud', 'fume', 'monet', 'claddagh', 'pendolo', 'diorama']);

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function scenery(mode) {
  const svg = svgElement('svg', { viewBox: '0 0 1000 600', 'aria-hidden': 'true', class: `lyric-scenery scenery-${mode}`, preserveAspectRatio: 'xMidYMid slice' });
  const shape = (name, attrs, parent = svg) => { const child = svgElement(name, attrs); parent.appendChild(child); return child; };
  if (mode === 'sonnet') {
    shape('path', { d: 'M30 105V30H105 M895 30H970V105 M970 495V570H895 M105 570H30V495', class: 'scene-outline' });
    shape('path', { d: 'M50 90H270 M730 510H950 M500 25V55 M485 40H515 M500 545V575 M485 560H515', class: 'scene-fine' });
  } else if (mode === 'tempera') {
    shape('rect', { x: 0, y: 0, width: 1000, height: 280, class: 'scene-color-one' });
    shape('rect', { x: 0, y: 294, width: 1000, height: 306, class: 'scene-color-two' });
    shape('path', { d: 'M0 286H1000 M810 30V90 M780 60H840', class: 'scene-outline' });
    shape('circle', { cx: 120, cy: 510, r: 110, class: 'scene-outline' });
  } else if (mode === 'lumiere') {
    shape('path', { d: 'M180 -40L40 560L660 560Z', class: 'scene-beam beam-one' });
    shape('path', { d: 'M840 -40L280 560L990 560Z', class: 'scene-beam beam-two' });
    shape('ellipse', { cx: 500, cy: 510, rx: 350, ry: 45, class: 'scene-light-pool' });
  } else if (mode === 'hanabi') {
    [[180, 170, 85], [820, 390, 115], [760, 85, 55]].forEach(([x, y, radius], index) => {
      const burst = shape('g', { class: 'scene-burst', style: `--burst-delay:${index * 450}ms;transform-origin:${x}px ${y}px` });
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        shape('line', { x1: x + Math.cos(angle) * radius * .45, y1: y + Math.sin(angle) * radius * .45, x2: x + Math.cos(angle) * radius, y2: y + Math.sin(angle) * radius, class: 'scene-firework-ray' }, burst);
      }
      shape('circle', { cx: x, cy: y, r: radius * .22, class: 'scene-outline' }, burst);
    });
    shape('path', { d: 'M180 580Q140 380 180 250', class: 'scene-fine scene-trail' });
  } else if (mode === 'machi') {
    [0, 155, 335, 625, 830].forEach((x, index) => {
      const y = 85 + (index % 3) * 50;
      shape('rect', { x, y, width: 165, height: 490 - y, class: 'scene-building' });
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) shape('rect', { x: x + 20 + col * 45, y: y + 20 + row * 50, width: 18, height: 27, class: 'scene-window' });
    });
    shape('path', { d: 'M100 250H900V480H100Z M70 240H930L900 190H100Z', class: 'scene-shop' });
    shape('path', { d: 'M110 430H890 M230 430V480 M770 430V480 M0 500H1000', class: 'scene-outline' });
    shape('path', { d: 'M100 540H330 M520 570H900 M60 590H220', class: 'scene-reflection' });
  } else if (mode === 'nebbia') {
    shape('rect', { x: 28, y: 24, width: 944, height: 552, rx: 65, class: 'scene-fog-window' });
    shape('path', { d: 'M40 75Q500 35 960 75 M500 25V575', class: 'scene-fine' });
    [[100, 100, 15], [880, 180, 22], [170, 440, 12], [790, 500, 17], [920, 390, 9], [360, 70, 11]].forEach(([x, y, r], index) => {
      shape('ellipse', { cx: x, cy: y, rx: r * .55, ry: r, class: 'scene-drop', style: `--drop-delay:${index * -700}ms` });
    });
  } else if (mode === 'claddagh') {
    const ring = shape('g', { transform: 'rotate(-18 500 300)' });
    shape('ellipse', { cx: 500, cy: 300, rx: 435, ry: 175, class: 'scene-orbit' }, ring);
    shape('ellipse', { cx: 500, cy: 300, rx: 360, ry: 135, class: 'scene-orbit orbit-inner' }, ring);
    shape('circle', { cx: 935, cy: 300, r: 9, class: 'scene-orbit-dot' }, ring);
    shape('path', { d: 'M150 505L850 95', class: 'scene-fine' });
  } else if (mode === 'pendolo') {
    const clock = shape('g', { class: 'scene-clock', style: 'transform-origin:150px 300px' });
    [212, 188, 155].forEach(r => shape('circle', { cx: 150, cy: 300, r, class: 'scene-clock-ring' }, clock));
    for (let i = 0; i < 60; i++) {
      const angle = i / 60 * Math.PI * 2;
      const inner = i % 5 ? 181 : 167;
      shape('line', { x1: 150 + Math.cos(angle) * inner, y1: 300 + Math.sin(angle) * inner, x2: 150 + Math.cos(angle) * 190, y2: 300 + Math.sin(angle) * 190, class: 'scene-fine' }, clock);
    }
    shape('path', { d: 'M150 300L105 195 M150 300L275 245', class: 'scene-clock-hand' });
    shape('circle', { cx: 150, cy: 300, r: 12, class: 'scene-clock-hub' });
  } else if (mode === 'diorama') {
    [[100, 110, 170], [690, 75, 220], [610, 380, 140], [60, 450, 100]].forEach(([x, y, size], index) => {
      shape('path', { d: `M${x} ${y}l${size} -30v${size}l-${size} 30Z m0 0l-30 -20v${size}l30 20`, class: `scene-depth-plane depth-${index}` });
    });
    shape('path', { d: 'M0 600L500 330L1000 600 M240 600L500 330L760 600 M0 510H1000 M0 565H1000', class: 'scene-perspective-grid' });
  } else if (mode === 'monet') {
    shape('ellipse', { cx: 800, cy: 300, rx: 195, ry: 235, class: 'scene-paint-ellipse' });
    shape('path', { d: 'M625 510Q805 450 940 500 M650 530Q800 495 900 535', class: 'scene-fine' });
  } else if (mode === 'fume') {
    shape('path', { d: 'M25 95H220 M780 505H975 M40 75V115 M960 485V525', class: 'scene-fine' });
  }
  if (mode === 'machi') {
    const rain = shape('g', { class: 'scene-rain' });
    for (let i = 0; i < 16; i++) shape('line', { x1: i * 71, y1: (i * 97) % 500, x2: i * 71 - 15, y2: (i * 97) % 500 + 48, class: 'scene-rain-stroke' }, rain);
  }
  return svg;
}

function neighborText(line, direction) {
  const neighbor = direction < 0 ? line.previousElementSibling : line.nextElementSibling;
  const text = neighbor?.querySelector('.lrc-text');
  return text?.getAttribute('aria-label') || text?.textContent || '';
}

export function createLyricScenes({ artwork = () => '' } = {}) {
  const records = new Map();
  function reset(line) {
    const record = records.get(line);
    if (!record) return;
    record.text.textContent = record.original;
    record.text.classList.remove('has-lyric-scene');
    record.text.removeAttribute('aria-label');
    records.delete(line);
  }
  function render(line, mode) {
    for (const held of [...records.keys()]) if (!held.isConnected) reset(held);
    reset(line);
    if (!LYRIC_SCENE_IDS.includes(mode)) return;
    const text = line?.querySelector('.lrc-text');
    if (!text || !text.textContent.trim()) return;
    const original = text.textContent;
    records.set(line, { text, original });
    text.classList.add('has-lyric-scene');
    text.setAttribute('aria-label', original);
    const scene = document.createElement('span');
    scene.className = `lyric-scene scene-${mode}`;
    scene.setAttribute('aria-hidden', 'true');
    scene.appendChild(scenery(mode));
    if (mode === 'monet') {
      const frame = document.createElement('span');
      frame.className = 'scene-art-frame';
      const src = artwork();
      if (src) {
        const image = document.createElement('img');
        image.src = src; image.alt = ''; image.referrerPolicy = 'no-referrer'; image.draggable = false;
        image.addEventListener('error', () => image.remove(), { once: true });
        frame.appendChild(image);
      }
      scene.appendChild(frame);
    }
    if (['fume', 'claddagh', 'pendolo'].includes(mode)) {
      [-1, 1].forEach(direction => {
        const echo = document.createElement('span');
        echo.className = `scene-echo ${direction < 0 ? 'echo-before' : 'echo-after'}`;
        echo.dataset.text = neighborText(line, direction) || original;
        scene.appendChild(echo);
      });
    }
    const copy = document.createElement('span');
    copy.className = 'lyric-scene-copy';
    if (PHRASE_SCENES.has(mode) && original.length < 600) {
      const phrases = splitLyricPhrases(original, mode === 'cloud' ? 8 : 14);
      phrases.forEach((content, index) => {
        const phrase = document.createElement('span');
        phrase.className = 'scene-phrase';
        phrase.textContent = content;
        phrase.style.setProperty('--phrase-index', String(index));
        phrase.style.setProperty('--phrase-count', String(phrases.length));
        copy.appendChild(phrase);
      });
    } else copy.textContent = original;
    scene.appendChild(copy);
    text.replaceChildren(scene);
  }
  return { render, reset, destroy() { [...records.keys()].forEach(reset); } };
}
