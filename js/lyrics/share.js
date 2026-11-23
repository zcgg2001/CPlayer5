import { CARD_THEMES, MAX_CARD_LINES, MAX_CARD_CHARACTERS, shareableLines, cardFileName, loadCardArtwork, drawLyricCard } from './card.js';

export function createLyricShare({ snapshot }) {
  const dialog = document.getElementById('lyricShareDialog');
  const canvas = document.getElementById('lyricShareCanvas'), list = document.getElementById('lyricShareLines');
  const preview = document.getElementById('lyricSharePreview');
  const feedback = document.getElementById('lyricShareFeedback'), count = document.getElementById('lyricShareCount');
  const save = document.getElementById('lyricShareSave'), share = document.getElementById('lyricShareSend');
  const editor = document.getElementById('lyricShareEditor');
  const layout = matchMedia('(orientation: landscape) and (max-height: 600px)');
  const bridge = globalThis.CPlayerShare, listeners = [];
  let song = {}, lines = [], selected = new Set(), theme = 'cover', format = 'square', art = null;
  let request = null, revision = 0, blob = null, busy = false, trigger = null, nativeRequest = null, previewUrl = '';
  const listen = (node, event, handler) => { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)); };
  const resetScroll = () => { dialog.querySelector('.lyric-share-body').scrollTop = 0; editor.scrollTop = 0; };
  listen(layout, 'change', resetScroll);
  function enabled() { save.disabled = share.disabled = busy || !blob; editor.disabled = busy; }
  function feedbackText(text) { feedback.textContent = text; }
  function selectedTexts() { return lines.filter((_, i) => selected.has(i)).map(line => line.text); }
  async function render() {
    const token = ++revision; blob = null; enabled();
    count.textContent = `${selected.size} / ${MAX_CARD_LINES}`;
    const texts = selectedTexts();
    preview.alt = `${song.name || '歌曲'}的歌词卡片：${texts.join(' / ')}`;
    dialog.dataset.format = format;
    try {
      drawLyricCard(canvas, { song, texts, theme, format, artwork: art });
      const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (token !== revision) return;
      if (!output || output.size > 3 * 1024 * 1024) throw new Error('卡片生成失败，请减少选句后重试');
      blob = output;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(output); preview.src = previewUrl; preview.hidden = false;
      preview.width = canvas.width; preview.height = canvas.height;
      feedbackText(`${format === 'story' ? '1080 × 1920' : '1080 × 1080'} PNG · 卡片已就绪`);
    } catch (error) {
      if (token !== revision) return;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      preview.hidden = true; preview.removeAttribute('src');
      feedbackText(error.message || '卡片生成失败，请重试');
    }
    enabled();
  }
  function switchTab(tab) {
    dialog.querySelectorAll('[data-card-tab]').forEach(button => {
      const active = button.dataset.cardTab === tab;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    dialog.querySelectorAll('[data-card-panel]').forEach(panel => { panel.hidden = panel.dataset.cardPanel !== tab; });
  }
  for (const button of dialog.querySelectorAll('[data-card-tab]')) {
    listen(button, 'click', () => switchTab(button.dataset.cardTab));
    listen(button, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = button.dataset.cardTab === 'lines' ? 'style' : 'lines';
      const tab = event.key === 'Home' ? 'lines' : event.key === 'End' ? 'style' : next;
      switchTab(tab); dialog.querySelector(`[data-card-tab="${tab}"]`).focus();
    });
  }
  for (const input of dialog.querySelectorAll('[name="lyricCardTheme"], [name="lyricCardFormat"]')) {
    listen(input, 'change', () => { if (input.name === 'lyricCardTheme') theme = Object.hasOwn(CARD_THEMES, input.value) ? input.value : 'cover'; else format = input.value === 'story' ? 'story' : 'square'; void render(); });
  }
  listen(list, 'change', event => {
    const input = event.target.closest('input[data-line]'); if (!input) return;
    const index = Number(input.dataset.line);
    if (input.checked) {
      if (selected.size >= MAX_CARD_LINES || selectedTexts().join('').length + lines[index].text.length > MAX_CARD_CHARACTERS) {
        input.checked = false; feedbackText('最多选择 6 句、500 个字；先取消一句再试试'); return;
      }
      selected.add(index);
    } else selected.delete(index);
    void render();
  });
  listen(document.getElementById('lyricShareClear'), 'click', () => { selected.clear(); list.querySelectorAll('input').forEach(input => { input.checked = false; }); void render(); });
  listen(document.getElementById('lyricShareClose'), 'click', () => dialog.close());
  listen(dialog, 'close', () => { request?.abort(); revision++; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; preview.removeAttribute('src'); trigger?.focus({ preventScroll: true }); });

  async function open(button) {
    if (busy) return;
    const value = snapshot();
    lines = shareableLines(value.document);
    if (!lines.length) return;
    song = { ...value.song }; art = null; blob = null; trigger = button;
    document.getElementById('lyricShareSong').textContent = `${song.name || '未命名歌曲'} · ${song.artist || '未知歌手'}`;
    let first = lines.findLastIndex(line => line.start !== null && line.start <= value.time);
    first = Math.max(0, first);
    selected = new Set();
    for (let i = first; i < Math.min(lines.length, first + 2); i++)
      if (selectedTexts().join('').length + lines[i].text.length <= MAX_CARD_CHARACTERS) selected.add(i);
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      label.className = 'lyric-share-line'; input.type = 'checkbox'; input.dataset.line = String(index); input.checked = selected.has(index);
      text.textContent = line.text; label.append(input, text); fragment.append(label);
    });
    list.replaceChildren(fragment);
    list.scrollTop = 0;
    switchTab('lines');
    dialog.showModal();
    resetScroll();
    document.getElementById('lyricShareClose').focus({ preventScroll: true });
    // Start the picker near the currently sung verse instead of the credits.
    requestAnimationFrame(() => { const row = list.querySelector('input:checked')?.parentElement; if (row) list.scrollTop = row.offsetTop - list.firstElementChild.offsetTop; });
    void render();
    request?.abort(); request = new AbortController(); const pending = request;
    const image = await loadCardArtwork(value.artwork, { signal: pending.signal });
    if (pending.signal.aborted || !dialog.open) return;
    art = image; void render();
  }
  for (const button of document.querySelectorAll('[data-lyric-share]')) listen(button, 'click', () => { void open(button); });

  const handleNative = event => {
    try {
      const result = JSON.parse(event.data);
      if (!nativeRequest || result.id !== nativeRequest.id) return;
      clearTimeout(nativeRequest.timer);
      const current = nativeRequest; nativeRequest = null;
      if (result.status === 'error') current.reject(new Error(result.error || '图片导出失败，请重试'));
      else current.resolve(result.status);
    } catch { /* Ignore unrelated/malformed bridge messages. */ }
  };
  if (bridge) bridge.onmessage = handleNative;
  function sendNative(op, fileName, png) {
    return new Promise((resolve, reject) => {
      const id = `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => { nativeRequest = null; reject(new Error('保存面板尚未返回，请回到应用后重试')); }, 600_000);
      nativeRequest = { id, timer, resolve, reject };
      try { bridge.postMessage(JSON.stringify({ id, op, fileName, png })); }
      catch (error) { clearTimeout(timer); nativeRequest = null; reject(error); }
    });
  }
  async function exportCard(op) {
    if (!blob || busy) return;
    busy = true; enabled(); feedbackText(op === 'save' ? '正在准备保存…' : '正在准备分享…');
    try {
      const fileName = cardFileName(song), ready = blob;
      if (bridge?.postMessage) {
        const png = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(ready); });
        const result = await sendNative(op, fileName, png);
        feedbackText(result === 'saved' ? '图片已保存到你选择的位置' : result === 'shared' ? '已打开系统分享面板' : '已取消保存，可继续编辑卡片');
      } else {
        const file = new File([ready], fileName, { type: 'image/png' });
        if (op === 'share' && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] }); feedbackText('分享已完成');
        } else {
          const url = URL.createObjectURL(ready), link = document.createElement('a');
          link.href = url; link.download = fileName; document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          feedbackText(op === 'share' ? '图片已下载，可从图片中选择分享' : '图片已开始下载');
        }
      }
    } catch (error) { feedbackText(error.name === 'AbortError' ? '已取消分享，卡片仍在这里' : error.message || '图片导出失败，请重试'); }
    finally { busy = false; enabled(); }
  }
  listen(save, 'click', () => { void exportCard('save'); });
  listen(share, 'click', () => { void exportCard('share'); });
  return {
    update(doc) { const available = shareableLines(doc).length > 0; document.querySelectorAll('[data-lyric-share]').forEach(button => { button.disabled = !available; }); },
    destroy() { request?.abort(); revision++; if (previewUrl) URL.revokeObjectURL(previewUrl); if (nativeRequest) clearTimeout(nativeRequest.timer); if (bridge) bridge.onmessage = null; listeners.forEach(remove => remove()); },
  };
}
