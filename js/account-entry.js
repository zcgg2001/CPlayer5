export function createAccountEntry() {
  const dialog = document.getElementById('accountEntryDialog');
  const $ = id => dialog.querySelector(`#${id}`);
  let mode = 'login', busy = false, ready = false, desktop = false, handlers = {};
  const message = (text, error = false) => { $('entryStatus').textContent = text; $('entryStatus').classList.toggle('is-error', error); };
  function controls() {
    $('entryFields').disabled = busy || !ready;
    $('entryGuest').disabled = busy;
    $('entryOffline').disabled = busy;
    $('entryDesktopLogin').disabled = busy || !ready;
  }
  function setMode(next) {
    mode = next;
    dialog.querySelectorAll('[data-entry-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.entryMode === mode)));
    $('entryTitle').textContent = mode === 'register' ? '创建你的账号' : '欢迎回来';
    $('entrySubtitle').textContent = mode === 'register' ? '一个用户名和密码，就能保存你的音乐。' : '登录账号，在不同设备间继续聆听。';
    $('entryConfirmLabel').hidden = mode !== 'register'; $('entryConfirm').required = mode === 'register';
    $('entryPassword').minLength = mode === 'register' ? 8 : 1;
    $('entryPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('entrySubmit').textContent = mode === 'register' ? '注册并进入播放器' : '登录';
    $('entryPassword').value = ''; $('entryConfirm').value = ''; message('');
    $('entryPassword').type = 'password'; $('entryShowPassword').textContent = '显示'; $('entryShowPassword').setAttribute('aria-pressed', 'false');
  }
  function open(nextMode = 'login') {
    setMode(nextMode);
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => (ready && !desktop ? $('entryUsername') : $('entryGuest')).focus());
  }
  function close() { $('entryPassword').value = ''; $('entryConfirm').value = ''; dialog.close(); }
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.querySelectorAll('[data-entry-mode]').forEach(button => button.addEventListener('click', () => { if (!busy) setMode(button.dataset.entryMode); }));
  $('entryShowPassword').addEventListener('click', () => {
    const show = $('entryPassword').type === 'password'; $('entryPassword').type = show ? 'text' : 'password';
    $('entryShowPassword').textContent = show ? '隐藏' : '显示'; $('entryShowPassword').setAttribute('aria-pressed', String(show));
  });
  async function run(action) {
    if (busy) return; busy = true; controls(); dialog.setAttribute('aria-busy', 'true');
    try { await action(); } catch (error) { message(error.message || '暂时无法连接，请稍后重试', true); }
    finally { busy = false; controls(); dialog.removeAttribute('aria-busy'); }
  }
  $('entryForm').addEventListener('submit', event => { event.preventDefault(); if (!ready) return; void run(async () => {
    const username = $('entryUsername').value.trim().toLowerCase(), password = $('entryPassword').value;
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('用户名需为 3–24 位字母、数字或下划线');
    if (mode === 'register' && password !== $('entryConfirm').value) { requestAnimationFrame(() => $('entryConfirm').focus()); throw new Error('两次输入的密码不一致'); }
    message(mode === 'register' ? '正在创建账号…' : '正在登录…');
    try { await handlers.submit({ mode, username, password }); close(); }
    finally { $('entryPassword').value = ''; $('entryConfirm').value = ''; }
  }); });
  $('entryGuest').addEventListener('click', () => { void run(async () => { message('正在进入游客模式…'); await handlers.guest?.(); close(); }); });
  $('entryOffline').addEventListener('click', () => { void run(async () => { await handlers.offline?.(); close(); }); });
  $('entryDesktopLogin').addEventListener('click', () => { void run(async () => { const result = await handlers.desktop(); message(`请在系统浏览器核对验证码 ${result.user_code}，登录后允许连接。`); }); });
  $('entryRetry').addEventListener('click', () => { void run(async () => { await handlers.retry?.(); }); });
  // The static open attribute covers the first paint; promote to a modal as soon
  // as modules are ready so keyboard navigation cannot reach the player behind it.
  dialog.removeAttribute('open'); dialog.showModal();
  return {
    open, close, message,
    isOpen: () => dialog.open,
    configure(callbacks) { handlers = callbacks; },
    ready(caps, remaining, isDesktop = false, offlineName = '') {
      ready = Boolean(caps.enabled && caps.username); desktop = isDesktop;
      $('entryGuestQuota').textContent = `可试听 ${remaining} / 50 首不同歌曲，重复播放不扣次数`;
      $('entryForm').hidden = desktop; $('entryModes').hidden = desktop; $('entryDesktopLogin').hidden = !desktop;
      $('entryRetry').hidden = ready;
      $('entryOffline').hidden = ready || !offlineName;
      $('entryOffline').textContent = `离线打开 ${offlineName} 的本机资料`;
      if (!ready) message('账号服务暂未连接，你可以先以游客试听。'); else message('');
      controls();
    },
  };
}
