import { requestErrorMessage, requestJson } from './http.js?v=37';

const ENDPOINT = '/api/v1/settings/music-key';

export function createMusicKeySettings({ documentRef = document, onEnabled = () => {} } = {}) {
  const form = documentRef.getElementById('musicKeyForm');
  const input = documentRef.getElementById('musicApiKey');
  const toggle = documentRef.getElementById('musicKeyVisibility');
  const save = documentRef.getElementById('musicKeySave');
  const clear = documentRef.getElementById('musicKeyClear');
  const status = documentRef.getElementById('musicKeyStatus');
  const feedback = documentRef.getElementById('musicKeyFeedback');
  const hint = documentRef.getElementById('musicKeyHint');
  let state = { configured: false, editable: false };
  let busy = false;
  let refreshId = 0;

  function render() {
    input.disabled = busy || !state.editable;
    toggle.disabled = input.disabled;
    save.disabled = input.disabled;
    clear.disabled = busy || !state.editable || !state.configured;
    form.setAttribute('aria-busy', String(busy));
    save.textContent = busy ? '处理中…' : '保存密钥';
    status.textContent = state.configured
      ? (state.source === 'environment' ? '已由启动环境配置' : '已配置 · 当前服务有效') : '未配置';
    hint.textContent = state.editable
      ? '密钥仅保存在本地服务内存中，用于请求 ChKSz API。重启服务后需重新填写。'
      : '此站点由管理员配置密钥；本地运行时可在这里填写个人密钥。';
    input.placeholder = state.configured ? '填写新密钥以替换' : 'chksz_…';
  }

  function message(text, error = false) {
    feedback.textContent = text;
    feedback.dataset.error = String(error);
  }

  function resetInput() {
    input.value = '';
    input.type = 'password';
    input.removeAttribute('aria-invalid');
    toggle.textContent = '显示';
    toggle.setAttribute('aria-label', '显示密钥');
    toggle.setAttribute('aria-pressed', 'false');
  }

  async function refresh() {
    if (busy) return;
    const id = ++refreshId;
    state.editable = false;
    render();
    status.textContent = '正在读取配置…';
    message('');
    try {
      const next = await requestJson(ENDPOINT);
      if (id !== refreshId) return;
      state = next;
      render();
      // Refreshing key status must not steal focus from lyric or other settings.
    } catch {
      if (id !== refreshId) return;
      render();
      status.textContent = '无法读取配置';
      message('请确认本地服务已启动，然后重新打开设置。', true);
    }
  }

  async function update(method, key) {
    if (busy || !state.editable) return;
    busy = true;
    ++refreshId;
    render();
    message(method === 'DELETE' ? '正在清除密钥…' : '正在保存密钥…');
    try {
      state = await requestJson(ENDPOINT, {
        method,
        headers: { 'content-type': 'application/json', 'x-cplayer-settings': '1' },
        ...(method === 'POST' ? { body: JSON.stringify({ key }) } : {}),
      });
      resetInput();
      message(method === 'DELETE'
        ? '密钥已从当前服务中清除。'
        : 'ChKSz 密钥已保存，将刷新榜单与歌单。搜索与播放接口保持当前选择。');
      if (method === 'POST') onEnabled();
    } catch (error) {
      // Never log the request body or retain a submitted key in the form.
      resetInput();
      message(requestErrorMessage(error), true);
    } finally {
      busy = false;
      render();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const key = input.value.trim();
    if (!/^chksz_[A-Za-z0-9_-]+$/.test(key) || key.length > 512) {
      input.setAttribute('aria-invalid', 'true');
      message('请输入以 chksz_ 开头的完整个人 API Key。', true);
      input.focus();
      return;
    }
    void update('POST', key);
  });
  clear.addEventListener('click', () => void update('DELETE'));
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隐藏' : '显示';
    toggle.setAttribute('aria-label', show ? '隐藏密钥' : '显示密钥');
    toggle.setAttribute('aria-pressed', String(show));
  });
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    message('');
  });
  render();
  return { refresh, resetInput };
}
