const { app, BrowserWindow, ipcMain, session, shell, safeStorage } = require('electron');
const { readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { appOrigin, trusted, tokenRoute } = require('./policy.cjs');

const origin = appOrigin(process.env.CPLAYER_DESKTOP_URL, !app.isPackaged && process.env.CPLAYER_DESKTOP_DEV === '1');
let window, token = null, loginGeneration = 0;
const tokenFile = () => join(app.getPath('userData'), origin.includes('127.0.0.1') || origin.includes('localhost') ? 'development-session.enc' : 'session.enc');
async function persistToken(value, generation = loginGeneration) {
  let encrypted;
  try { if (value && await safeStorage.isAsyncEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text') encrypted = await safeStorage.encryptStringAsync(value); } catch { /* Memory-only sessions remain usable without an OS key store. */ }
  if (generation !== loginGeneration) return;
  token = value; rmSync(tokenFile(), { force: true });
  if (encrypted) writeFileSync(tokenFile(), encrypted, { mode: 0o600 });
}
function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url, origin)) throw new Error('Untrusted renderer');
}
async function post(path, body) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  return { ok: response.ok, data };
}
async function poll(code, generation) {
  let interval = Math.max(5, code.interval || 5);
  const deadline = Date.now() + Math.min(code.expires_in, 600) * 1000;
  while (Date.now() < deadline && generation === loginGeneration) {
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    if (generation !== loginGeneration) return;
    try {
      const { ok, data } = await post('/api/auth/device/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: 'cplayer-desktop', device_code: code.device_code });
      if (generation !== loginGeneration) return;
      if (ok && data.access_token) { await persistToken(data.access_token, generation); if (generation === loginGeneration) window?.webContents.send('account:signed-in'); return; }
      if (data.error === 'slow_down') interval += 5;
      else if (data.error !== 'authorization_pending') return;
    } catch { interval = Math.min(interval + 5, 30); }
  }
}
app.whenReady().then(async () => {
  try { if (await safeStorage.isAsyncEncryptionAvailable()) token = (await safeStorage.decryptStringAsync(readFileSync(tokenFile()))).result; } catch {}
  const isolated = session.fromPartition('persist:cplayer-desktop');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (token && details.webContentsId === window?.webContents.id && tokenRoute(details.url, origin)) headers.Authorization = `Bearer ${token}`;
    callback({ requestHeaders: headers });
  });
  window = new BrowserWindow({ width: 1280, height: 850, minWidth: 390, minHeight: 620, title: 'CPlayer5', backgroundColor: '#15151a', webPreferences: { session: isolated, preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false } });
  window.removeMenu();
  window.webContents.on('will-navigate', (event, url) => { if (!trusted(url, origin)) { event.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  window.webContents.on('will-redirect', (event, url) => { if (!trusted(url, origin)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ipcMain.handle('account:sign-in', async event => {
    assertSender(event); const generation = ++loginGeneration;
    const { ok, data } = await post('/api/auth/device/code', { client_id: 'cplayer-desktop' });
    if (!ok) throw new Error('账号服务尚未开通或暂时不可用');
    if (!trusted(data.verification_uri_complete, origin)) throw new Error('Unexpected verification URL');
    await shell.openExternal(data.verification_uri_complete);
    void poll(data, generation);
    return { user_code: data.user_code, expires_in: data.expires_in };
  });
  ipcMain.handle('account:sign-out', async event => { assertSender(event); loginGeneration++; await persistToken(null); await isolated.clearStorageData({ storages: ['cookies'] }); });
  await window.loadURL(origin);
  if (process.argv.includes('--smoke')) {
    const result = await window.webContents.executeJavaScript('({ title: document.title, bridge: typeof window.cplayerDesktop?.signIn, node: typeof require })');
    console.log(JSON.stringify(result)); app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { loginGeneration++; });
