export function createSpiderEditor({ appearance }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'spider-editor';
  dialog.setAttribute('aria-label', '滚动挂件形象设置');
  dialog.innerHTML = `
    <div class="spider-editor__content">
      <header class="spider-editor__header">
        <div><p class="spider-editor__eyebrow">页面小伙伴</p><h2>滚动挂件</h2></div>
        <button class="spider-editor__close" type="button" aria-label="关闭挂件设置" autofocus>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <p class="spider-editor__description">换一个形象，陪你慢慢浏览。</p>
      <div class="spider-editor__stage"><span aria-hidden="true"></span><img alt="当前滚动挂件预览" width="144" height="156"></div>
      <div class="spider-editor__selection"><strong></strong><span></span></div>
      <div class="spider-editor__actions">
        <button class="spider-editor__upload" type="button">上传图片</button>
        <button class="spider-editor__reset" type="button">恢复默认</button>
      </div>
      <input class="spider-editor__file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label="选择挂件图片" hidden>
      <p class="spider-editor__hint">PNG、JPG、WebP、GIF、SVG · 最大 5 MB<br>透明背景效果更好，图片仅保存在当前浏览器。</p>
      <p class="spider-editor__status" role="status" aria-live="polite" aria-atomic="true"></p>
    </div>`;
  document.body.append(dialog);
  const preview = dialog.querySelector('img');
  const title = dialog.querySelector('.spider-editor__selection strong');
  const badge = dialog.querySelector('.spider-editor__selection span');
  const fileInput = dialog.querySelector('input');
  const upload = dialog.querySelector('.spider-editor__upload');
  const reset = dialog.querySelector('.spider-editor__reset');
  const status = dialog.querySelector('.spider-editor__status');
  let busy = false;
  let destroyed = false;
  const unsubscribe = appearance.subscribe(state => {
    preview.src = state.src;
    title.textContent = state.name;
    badge.textContent = state.custom ? '自定义' : '默认形象';
    reset.disabled = busy || !state.custom;
  });
  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    upload.disabled = fileInput.disabled = value;
    reset.disabled = value || !appearance.state.custom;
  }
  function feedback(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }
  upload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || busy) return;
    setBusy(true);
    feedback('正在读取图片…');
    try {
      const result = await appearance.upload(file);
      if (!destroyed && !result.stale) feedback(result.persisted ? '已替换并保存，刷新后仍会保留。' : '已替换，但浏览器未能保存；刷新后会恢复原形象。', !result.persisted);
    } catch (error) { if (!destroyed) feedback(error.message, true); }
    finally { if (!destroyed) setBusy(false); }
  });
  reset.addEventListener('click', async () => {
    setBusy(true);
    feedback('正在恢复默认形象…');
    try {
      const result = await appearance.reset();
      if (!destroyed) feedback(result.persisted ? '已恢复默认形象「小织」。' : '已恢复，但浏览器未能保存；刷新后可能显示上次上传的图片。', !result.persisted);
    } finally { if (!destroyed) setBusy(false); }
  });
  dialog.querySelector('.spider-editor__close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  // Native modal focus/escape handling takes precedence over the host's settings dialog.
  dialog.addEventListener('keydown', event => { if (['Escape', 'Tab'].includes(event.key)) event.stopPropagation(); });
  return {
    open() { if (!dialog.open) dialog.showModal(); },
    destroy() { destroyed = true; unsubscribe(); dialog.close(); dialog.remove(); },
  };
}
