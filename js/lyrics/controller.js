import { LYRIC_EFFECTS, pickLyricEffect, resolveLyricEffect } from '../lyric-catalog.js';
import { parseLyricsPayload, normalizeDocument, readLyricFile } from './document.js';
import { createLyricRuntime } from './runtime.js';
import { BACKGROUNDS, rendererFor, normalizeTuning } from './registry.js';
import { readStudio, saveStudio, normalizeStudio, importStudio } from './settings.js';
import { createLyricMemory, trackKey, chooseBestLyrics, matchingLyricSources } from './sources.js';

function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
const previewDocument = normalizeDocument({ source: '示例歌词', format: 'yrc', lines: [
  ['风穿过', '城市的', '窗'], ['让每一句', '落在', '心上'], ['We keep', ' the light', ' alive'], ['星光', '沿着旋律', '流淌'], ['此刻', '只听见', '你和我'],
].map((parts, i) => ({ start: i * 4200, end: (i + 1) * 4200 - 300, text: parts.join(''), translation: ['The wind passes through the city', 'Let every word find its place', '让微光继续亮着', 'Starlight follows the melody', 'Only you and me'][i], words: parts.map((text, j) => ({ text, start: i * 4200 + j * 1100, end: i * 4200 + j * 1100 + 950 })) })) });

export function createLyricsController({ audio, analyser, artwork = () => '', onFollow, onLayoutChange, getCandidates = () => [], fetchLyrics, readAppearance, saveAppearance }) {
  let storage; try { storage = localStorage; } catch { /* Usable for this visit. */ }
  const memory = createLyricMemory(storage);
  let appearance = readAppearance(storage), globalAppearance = { ...appearance }, studio = readStudio(storage), globalStudio = studio;
  let effective = appearance.effect === 'random' ? pickLyricEffect() : appearance.effect;
  let current = normalizeDocument({ lines: [] }), original = current, track = {}, key = '', generation = 0, perTrack = false, busy = false, sourceRequest = null, sourceChoices = [];
  const modal = document.getElementById('settingsModal'), select = document.getElementById('lyricEffectSelect'), feedback = document.getElementById('lyricEffectFeedback');
  const runtime = createLyricRuntime({ audio, analyser, onFollow, scrollers: [document.getElementById('lyricsScroller'), document.getElementById('mobileLyricsScroller')] });
  const preview = createLyricRuntime({ audio, preview: true, scrollers: [document.getElementById('lyricEffectPreview')] });
  const listeners = [];
  const listen = (node, event, handler) => { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)); };
  const status = text => { feedback.textContent = text; };
  const section = document.querySelector('.lyric-settings');
  const extras = element('div', 'lyric-settings-extra'); section.querySelector('.lyric-settings__footer').before(extras);
  const modeCards = element('div', 'lyric-mode-grid'); modeCards.setAttribute('aria-label', '歌词模式'); section.querySelector('.lyric-preview').before(modeCards);
  select.replaceChildren();
  const groups = new Map();
  for (const effect of LYRIC_EFFECTS) {
    if (!groups.has(effect.group)) { const group = element('optgroup'); group.label = effect.group; groups.set(effect.group, group); select.append(group); }
    const option = element('option', '', effect.name); option.value = effect.id; groups.get(effect.group).append(option);
    const card = element('button', 'lyric-mode-card', effect.name); card.type = 'button'; card.dataset.mode = effect.id;
    listen(card, 'click', () => { appearance = { ...appearance, effect: effect.id }; effective = effect.id; apply(true); }); modeCards.append(card);
  }
  const randomOption = element('option', '', '随机 · 每首歌换一种'); randomOption.value = 'random'; select.append(randomOption);
  const controls = new Map();
  function group(title, open = false) { const details = element('details'); details.open = open; details.append(element('summary', '', title)); const grid = element('div', 'lyric-control-grid'); details.append(grid); extras.append(details); return { details, grid }; }
  function control(parent, label, property, spec, update) {
    const wrap = element('label', 'lyric-control'), name = element('span', '', label); wrap.append(name);
    const input = element(Array.isArray(spec) ? 'select' : 'input'); input.dataset.lyricSetting = property;
    if (Array.isArray(spec)) for (const [value, title] of spec) { const option = element('option', '', title); option.value = value; input.append(option); }
    else { input.type = spec.type || 'range'; for (const attr of ['min', 'max', 'step']) if (spec[attr] !== undefined) input[attr] = spec[attr]; }
    let output;
    if (input.type === 'range') { output = element('output'); name.append(output); }
    wrap.append(input); parent.append(wrap);
    const read = () => input.type === 'checkbox' ? input.checked : ['range', 'number'].includes(input.type) ? Number(input.value) : input.value;
    const handler = persist => { update(read(), persist); if (output) output.value = input.value; };
    if (input.type === 'range') input.addEventListener('input', () => handler(false));
    input.addEventListener('change', () => handler(true));
    const set = value => { if (input.type === 'checkbox') input.checked = !!value; else input.value = value; if (output) output.value = String(value); };
    return { input, set, wrap };
  }
  const common = group('显示与背景', true);
  const fields = [
    ['展示方式', 'view', [['auto', '跟随模式'], ['list', '连续歌词列表'], ['stage', '沉浸歌词舞台']]],
    ['背景', 'background', BACKGROUNDS], ['字体', 'font', [['sans-serif', '无衬线'], ['serif', '衬线'], ['monospace', '等宽']]],
    ['对齐', 'align', [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']]],
    ['画质', 'quality', [['auto', '自动'], ['low', '省电'], ['medium', '均衡'], ['high', '高质量']]],
    ['主题色', 'color', { type: 'color' }], ['行距', 'lineHeight', { min: 1.2, max: 2.4, step: .1 }],
    ['歌词透明度', 'opacity', { min: .3, max: 1, step: .05 }], ['字幕透明度', 'subtitleOpacity', { min: .2, max: 1, step: .05 }],
    ['动态强度', 'motion', { min: 0, max: 1, step: .05 }], ['背景透明度', 'backgroundOpacity', { min: 0, max: 1, step: .05 }],
    ['背景模糊', 'blur', { min: 0, max: 60, step: 1 }], ['显示翻译', 'translation', { type: 'checkbox' }],
    ['显示罗马音', 'romanization', { type: 'checkbox' }], ['显示下一句', 'upcoming', { type: 'checkbox' }], ['声音联动', 'audioReactive', { type: 'checkbox' }],
    ['底部音乐喷泉', 'fountain', { type: 'checkbox' }], ['喷泉强度', 'fountainStrength', { min: .1, max: 1, step: .05 }],
    ['网页背景地址（HTTPS）', 'backgroundUrl', { type: 'url' }],
  ];
  for (const [label, property, spec] of fields) controls.set(property, control(common.grid, label, property, spec, (value, persist) => { studio = normalizeStudio({ ...studio, [property]: value }); apply(persist); }));
  const modeGroup = group('当前模式参数'); let modeControls = [], displayedMode = '';
  const timing = group('歌词与时间校正');
  controls.set('offset', control(timing.grid, '歌词校正（毫秒，正值提前）', 'offset', { type: 'number', min: -10000, max: 10000, step: 50 }, (value, persist) => { studio = normalizeStudio({ ...studio, offset: value }); apply(false); if (persist) status(memory.save(key, { offset: studio.offset }) ? '已保存当前歌曲的时间校正' : '已应用；播放歌曲后可保存校正'); }));
  controls.set('lead', control(timing.grid, '提前入场（毫秒）', 'lead', { min: 0, max: 500, step: 10 }, (value, persist) => { studio = { ...studio, lead: value }; apply(persist); }));
  const sourceStatus = element('p', 'lyric-source-status'); sourceStatus.setAttribute('role', 'status'); timing.details.append(sourceStatus);
  const sourceLabel = element('label', 'lyric-control', '歌词来源');
  const sourceSelect = element('select'); sourceSelect.setAttribute('aria-label', '歌词来源'); sourceLabel.append(sourceSelect); timing.details.append(sourceLabel);
  listen(sourceSelect, 'change', () => {
    const choice = sourceChoices[Number(sourceSelect.value)]; if (!choice) return;
    current = choice; useDocument();
    status(memory.save(key, { document: current === original ? null : current }) ? '已记住此歌曲的歌词来源' : '已切换本次播放的歌词来源');
  });
  const actions = element('div', 'lyric-actions'); timing.details.append(actions);
  const button = (parent, label, handler) => { const btn = element('button', '', label); btn.type = 'button'; listen(btn, 'click', handler); parent.append(btn); return btn; };
  const fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.lrc,.yrc,.ttml,.qrc,.krc,.vtt,.txt'; fileInput.hidden = true; extras.append(fileInput);
  button(actions, '导入歌词文件', () => fileInput.click());
  button(actions, '恢复在线歌词', () => { current = original; memory.save(key, { document: null }); useDocument(); status('已恢复此歌曲的在线歌词'); });
  const refreshButton = button(actions, '刷新在线歌词', () => requestSources(false));
  const bestButton = button(actions, '寻找更完整歌词', () => requestSources(true));
  const presets = group('预设与个性化');
  const trackControl = control(presets.grid, '仅为当前歌曲保存外观', 'perTrack', { type: 'checkbox' }, value => { if (value && !key) { status('请先播放一首歌曲'); trackControl.set(false); return; } perTrack = value; if (!value && key) memory.save(key, { studio: null, appearance: null }); apply(true); });
  const presetActions = element('div', 'lyric-actions'); presets.details.append(presetActions);
  const configInput = element('input'); configInput.type = 'file'; configInput.accept = '.json'; configInput.hidden = true; extras.append(configInput);
  button(presetActions, '导出外观', () => { const blob = new Blob([JSON.stringify({ ...studio, offset: 0, appearance }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = element('a'); a.href = url; a.download = 'cplayer-lyrics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  button(presetActions, '导入外观', () => configInput.click());
  const imageInput = element('input'); imageInput.type = 'file'; imageInput.accept = 'image/png,image/jpeg,image/webp'; imageInput.hidden = true; extras.append(imageInput);
  button(presetActions, '自定义背景图', () => imageInput.click());
  button(presetActions, '恢复歌曲封面', () => { studio = { ...studio, image: '' }; apply(true); });

  function useDocument() {
    runtime.setDocument(current); runtime.setArtwork(artwork());
    if (!sourceChoices.includes(current)) sourceChoices.push(current);
    if (!sourceChoices.includes(original)) sourceChoices.unshift(original);
    sourceSelect.replaceChildren(...sourceChoices.map((doc, i) => { const option = element('option', '', `${doc.source} · ${doc.format.toUpperCase()} · ${doc.hasWordLevel ? '逐字' : '逐行'}`); option.value = i; return option; }));
    sourceSelect.value = sourceChoices.indexOf(current);
    sourceStatus.textContent = `${current.source} · ${current.format.toUpperCase()}\n${current.lines.length} 行 · ${current.hasWordLevel ? '包含真实逐字时间' : current.plain ? '纯文本，可自由滚动' : '按句同步'}`;
  }
  function apply(persist = false) {
    const mode = effective;
    document.documentElement.dataset.lyricEffect = mode;
    document.documentElement.style.setProperty('--lyric-font-size', `${appearance.fontSize}px`);
    select.value = appearance.effect;
    document.getElementById('lyricFontSize').value = appearance.fontSize;
    document.getElementById('lyricFontDecrease').disabled = appearance.fontSize <= 12;
    document.getElementById('lyricFontIncrease').disabled = appearance.fontSize >= 60;
    document.getElementById('lyricEffectDescription').textContent = `${appearance.effect === 'random' ? '当前：' + rendererFor(mode).name + ' · ' : ''}${rendererFor(mode).description}`;
    document.getElementById('lyricCatalogNote').textContent = '20 种模式 · 支持逐字时间轴';
    document.getElementById('lyricRandomNext').hidden = appearance.effect !== 'random';
    modeCards.querySelectorAll('button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode)));
    controls.forEach((ctrl, property) => ctrl.set(studio[property])); trackControl.set(perTrack);
    controls.get('backgroundUrl').wrap.hidden = studio.background !== 'url';
    if (displayedMode !== mode) {
      displayedMode = mode; modeGroup.grid.replaceChildren(); modeControls = [];
      const params = rendererFor(mode).parameters;
      if (!params.length) modeGroup.grid.append(element('p', 'lyric-source-status', '此模式使用通用显示参数。'));
      for (const spec of params) {
        const ctrl = control(modeGroup.grid, spec.label, `mode-${spec.key}`, spec, (value, persist) => { const tuning = normalizeTuning(mode, studio.modes[mode]); studio = { ...studio, modes: { ...studio.modes, [mode]: { ...tuning, [spec.key]: value } } }; apply(persist); });
        modeControls.push({ ...ctrl, property: spec.key });
      }
    }
    const tuning = normalizeTuning(mode, studio.modes[mode]); modeControls.forEach(ctrl => ctrl.set(tuning[ctrl.property]));
    const combined = { ...studio, mode, fontSize: appearance.fontSize };
    runtime.setSettings(combined); preview.setSettings({ ...combined, offset: 0, lead: 180, backgroundUrl: '' });
    runtime.setArtwork(artwork()); preview.setArtwork(artwork()); onLayoutChange?.();
    if (persist) {
      const globalValue = { ...studio, offset: 0 };
      const ok = perTrack ? memory.save(key, { studio, appearance }) : saveAppearance(storage, appearance) && saveStudio(storage, globalValue);
      if (!perTrack) { globalAppearance = { ...appearance }; globalStudio = globalValue; }
      status(ok ? perTrack ? '已保存当前歌曲的外观' : '外观已保存，立即生效' : '已应用；浏览器存储空间不足，未保存');
    }
  }
  async function requestSources(best) {
    if (!key || !fetchLyrics || busy) return status('请先播放一首歌曲');
    busy = true; const token = generation; sourceRequest?.abort(); sourceRequest = new AbortController(); const signal = sourceRequest.signal;
    refreshButton.disabled = bestButton.disabled = true; sourceStatus.textContent = '正在检查这首歌曲的歌词…';
    try {
      const linked = best ? matchingLyricSources(track, getCandidates(track)).slice(0, 4) : [track];
      const results = await Promise.allSettled((linked.length ? linked : [track]).map(async candidate => ({ document: parseLyricsPayload({ ...await fetchLyrics(candidate, { signal }), source: candidate.provider || '在线歌词' }, audio.duration * 1000 || Infinity) })));
      if (token !== generation) return;
      const candidates = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      const chosen = chooseBestLyrics(best ? [{ document: original }, ...candidates] : candidates);
      if (!chosen) throw new Error('没有找到可用的在线歌词');
      original = chosen.document;
      sourceChoices = [original, ...candidates.map(item => item.document).filter(doc => doc !== original && doc.lines.length), ...(memory.get(key)?.document ? [current] : [])];
      const keepManual = !!memory.get(key)?.document;
      if (!keepManual) current = original;
      useDocument();
      status(keepManual ? '在线候选已更新，保留当前手动选择的歌词' : '在线歌词已更新');
    } catch (error) { if (token === generation) { useDocument(); status(error.message || '歌词获取失败'); } }
    finally { if (token === generation) { busy = false; refreshButton.disabled = bestButton.disabled = false; } }
  }
  listen(fileInput, 'change', async () => {
    const file = fileInput.files[0]; fileInput.value = ''; if (!file) return; const token = generation;
    try { const doc = await readLyricFile(file); if (token !== generation) return; current = normalizeDocument(doc, audio.duration * 1000 || Infinity); useDocument(); status(key && memory.save(key, { document: current }) ? '歌词已导入，并记住当前歌曲的选择' : '歌词已导入本次播放'); } catch (error) { status(error.message || '导入失败'); }
  });
  listen(configInput, 'change', async () => {
    const file = configInput.files[0]; configInput.value = ''; if (!file) return;
    try { if (file.size > 1_100_000) throw new Error('配置文件过大'); const text = await file.text(), data = JSON.parse(text); studio = importStudio(text); if (resolveLyricEffect(data.appearance?.effect)) { appearance = { effect: resolveLyricEffect(data.appearance.effect).id, fontSize: Math.min(60, Math.max(12, Number(data.appearance.fontSize) || 36)) }; effective = appearance.effect; } apply(true); } catch (error) { status(error.message || '配置导入失败'); }
  });
  listen(imageInput, 'change', async () => {
    const file = imageInput.files[0]; imageInput.value = ''; if (!file) return;
    try { if (file.size > 10_000_000 || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片'); const bitmap = await createImageBitmap(file); const canvas = element('canvas'); const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height)); canvas.width = bitmap.width * scale; canvas.height = bitmap.height * scale; canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); studio = { ...studio, image: canvas.toDataURL('image/jpeg', .8), background: 'monet' }; apply(true); } catch (error) { status(error.message || '图片读取失败'); }
  });
  listen(select, 'change', () => { appearance = { ...appearance, effect: select.value }; effective = select.value === 'random' ? pickLyricEffect(effective) : select.value; apply(true); });
  const setSize = value => { appearance = { ...appearance, fontSize: Math.round(Math.min(60, Math.max(12, Number(value) || appearance.fontSize))) }; apply(true); };
  listen(document.getElementById('lyricFontSize'), 'change', event => setSize(event.target.value));
  listen(document.getElementById('lyricFontDecrease'), 'click', () => setSize(appearance.fontSize - 2));
  listen(document.getElementById('lyricFontIncrease'), 'click', () => setSize(appearance.fontSize + 2));
  listen(document.getElementById('lyricRandomNext'), 'click', () => { effective = pickLyricEffect(effective); apply(); });
  listen(document.getElementById('lyricEffectReset'), 'click', () => { appearance = { effect: 'amll', fontSize: 36 }; effective = 'amll'; studio = normalizeStudio(); apply(true); });
  let previewFrame = null, previewPaused = false, previewTime = 0, lastWall = null;
  function previewTick(now) {
    previewFrame = null;
    if (previewPaused || document.hidden || modal.getAttribute('aria-hidden') !== 'false' || !preview.visible()) { lastWall = null; return; }
    if (lastWall !== null) previewTime = (previewTime + Math.min(100, now - lastWall)) % 21000;
    lastWall = now; preview.update(previewTime); previewFrame = requestAnimationFrame(previewTick);
  }
  function syncPreview() { if (previewFrame !== null) cancelAnimationFrame(previewFrame); previewFrame = null; lastWall = null; preview.update(previewTime); previewTick(performance.now()); }
  listen(document.getElementById('lyricPreviewToggle'), 'click', event => { previewPaused = !previewPaused; event.currentTarget.textContent = previewPaused ? '播放预览' : '暂停预览'; event.currentTarget.setAttribute('aria-pressed', String(previewPaused)); syncPreview(); });
  listen(document, 'visibilitychange', syncPreview);
  const modalObserver = new MutationObserver(syncPreview); modalObserver.observe(modal, { attributes: true, attributeFilter: ['aria-hidden', 'class'] });
  const previewVisibility = new IntersectionObserver(syncPreview); previewVisibility.observe(document.getElementById('lyricEffectPreview').parentElement);
  listen(audio, 'loadedmetadata', () => {
    if (!current.lines.length) return;
    const resolved = new Map([...sourceChoices, original, current].map(doc => [doc, normalizeDocument(doc, audio.duration * 1000 || Infinity)]));
    sourceChoices = sourceChoices.map(doc => resolved.get(doc)); original = resolved.get(original); current = resolved.get(current); useDocument();
  });
  apply(); preview.setDocument(previewDocument); syncPreview();
  return {
    handlesTiming: true, activateLine() {}, deactivateLine() {}, resetLyrics() {},
    load(payload, song = {}) {
      generation++; sourceRequest?.abort(); busy = false; refreshButton.disabled = bestButton.disabled = false; sourceChoices = [];
      track = song; key = trackKey(song); original = parseLyricsPayload(payload, audio.duration * 1000 || Infinity);
      const saved = memory.get(key); current = saved?.document ? normalizeDocument(saved.document, audio.duration * 1000 || Infinity) : original; perTrack = !!saved?.studio;
      appearance = saved?.appearance || { ...globalAppearance }; studio = normalizeStudio(saved?.studio || globalStudio);
      studio.offset = Number.isFinite(saved?.offset) ? saved.offset : 0;
      effective = appearance.effect === 'random' ? pickLyricEffect(effective) : resolveLyricEffect(appearance.effect)?.id || 'amll';
      apply(); useDocument(); return current;
    },
    status(message) { generation++; sourceRequest?.abort(); busy = false; current = normalizeDocument({ lines: [] }); original = current; key = ''; track = {}; sourceChoices = []; refreshButton.disabled = bestButton.disabled = false; runtime.status(message); },
    update(time) { runtime.update(time * 1000); },
    destroy() { generation++; sourceRequest?.abort(); if (previewFrame !== null) cancelAnimationFrame(previewFrame); modalObserver.disconnect(); previewVisibility.disconnect(); listeners.forEach(remove => remove()); runtime.destroy(); preview.destroy(); extras.remove(); modeCards.remove(); },
  };
}
