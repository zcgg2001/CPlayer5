import { createAccountSync } from './account-sync.js';
import { createAccountLibrary } from './account-library.js';
import { createAccountEntry } from './account-entry.js';
import { createOfflineDatabase } from './offline-audio.js';

// The player normalizes content hashes during startup; preserve OAuth return intent.
const initialAccountURL = new URL(location.href);
const entry = createAccountEntry();

export function initAccountPanel({ root, player, refreshFavorites, onSettings, openSettings, closeSettings, guestTrial }) {
  root.innerHTML = `
    <div class="account-heading"><div><p class="account-eyebrow">CPLAYER ACCOUNT</p><h3>账号与多端</h3></div><span id="accountBadge">本地模式</span></div>
    <p id="accountNotice" role="status" aria-live="polite">正在检查账号服务…</p>
    <div id="accountLogin"><button id="accountOpenEntry" type="button">登录 / 注册账号</button><p id="accountGuestQuota" class="account-help"></p><p class="account-help">只需用户名和密码，即可保存与同步你的音乐。</p></div>
    <div id="accountSignedIn" hidden><div class="account-heading"><strong id="accountIdentityName"></strong><button id="accountSignOut" type="button">退出登录</button></div>
      <p id="accountSyncStatus" role="status" aria-live="polite"></p><div class="account-actions"><button id="accountSyncNow" type="button">立即同步</button><button id="accountImportLocal" type="button">导入登录前的本地资料</button></div>
      <p class="account-help">收藏、歌单、队列、设置自动同步。播放进度每 30 秒保存，点击下方继续播放。音源与歌词设置在下次打开播放器时生效。</p>
      <div id="accountConflicts"></div><div id="accountProgress"></div>
      <details><summary>已登录设备</summary><button id="accountRefreshSessions" type="button">刷新设备列表</button><div id="accountSessions"></div></details>
      <details><summary>数据与账号</summary><p class="account-help">导出包含个人资料与云端音乐数据。注销立即删除账号、收藏、歌单和会话；供应商投递记录及服务备份按其保留策略处理。</p><button id="accountExport" type="button">导出账号数据 JSON</button><label>注销确认<input id="accountDeleteConfirm" placeholder="输入：删除我的账号" autocomplete="off"></label><button id="accountDelete" class="account-danger" type="button">永久注销账号</button></details>
    </div>
    <div id="accountDevice" hidden><h4>授权桌面客户端</h4><p>只有当你刚刚在自己的 CPlayer5 桌面端发起登录，且两端验证码一致时，才允许连接。</p><label>设备验证码<input id="accountDeviceCode" maxlength="32" autocomplete="off"></label><div class="account-actions"><button id="accountDeviceApprove" type="button">允许连接</button><button id="accountDeviceDeny" type="button">拒绝</button></div></div>
    <details id="accountPlaylists"><summary>我的歌单 <span id="accountPlaylistCount"></span></summary><div class="account-fields"><label>歌单名称<input id="accountPlaylistName" placeholder="晚间收藏" maxlength="80"></label><button id="accountSavePlaylist" type="button">将队列保存为歌单</button></div><div id="accountPlaylistList"></div></details>
    <div class="account-install"><button id="accountInstall" type="button">安装播放器</button><span id="accountInstallHint" class="account-help">安装后可从桌面打开，支持离线界面和系统媒体键。</span></div>`;
  const $ = id => root.querySelector(`#${id}`);
  const storage = localStorage;
  let user = null, caps = {}, busy = false, timer, installPrompt, syncing = false, lastProgress = 0, switching = false, authenticated = false, entered = false, offlineMode = false;
  const library = createAccountLibrary({ storage, player, refreshFavorites, onSettings });
  const notice = (text, error = false) => { $('accountNotice').textContent = text; $('accountNotice').classList.toggle('account-error', error); };
  const request = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) { const messages = { INVALID_USERNAME_OR_PASSWORD: '用户名或密码不正确', USERNAME_IS_ALREADY_TAKEN: '这个用户名已被注册，请换一个', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '这个用户名已被注册，请换一个', PASSWORD_TOO_SHORT: '密码至少需要 8 位', PASSWORD_TOO_LONG: '密码不能超过 128 位', INVALID_USERNAME: '用户名只能包含字母、数字和下划线' }; const error = new Error(response.status === 429 ? '尝试次数过多，请稍后再试' : messages[data.code] || data.message || data.error?.message || '操作失败，请稍后重试'); error.status = response.status; throw error; }
    return data;
  };
  const button = (text, action) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.addEventListener('click', () => run(action)); return el; };
  const row = (text, buttons) => { const el = document.createElement('div'); el.className = 'account-row'; const label = document.createElement('span'); label.textContent = text; el.append(label, ...buttons); return el; };
  const sync = createAccountSync({ storage, request, onApply(records) { switching = true; library.apply(records); switching = false; renderLists(); renderProgress(records); }, onStatus(state) {
    if (state.unauthorized) { authenticated = false; entered = false; openEntry(); $('accountLogin').hidden = false; notice('登录已失效，请重新验证。未同步资料仍保留在此设备。', true); }
    $('accountSyncStatus').textContent = state.message; $('accountSyncStatus').classList.toggle('account-error', state.error);
    $('accountConflicts').replaceChildren(...state.conflicts.map(key => row(`同时修改了：${key.startsWith('favorite:') ? '收藏 ' + key.slice(9) : key.startsWith('playlist:') ? sync.records()[key]?.name || '歌单' : key === 'queue' ? '播放队列' : key}`, [button('保留本机', async () => { sync.resolve(key, 'local'); await sync.sync(); }), button('使用云端', async () => { sync.resolve(key, 'remote'); await sync.sync(); })])));
  } });
  async function run(action) { if (busy) return; busy = true; root.setAttribute('aria-busy', 'true'); try { await action(); } catch (error) { notice(error.message, true); } finally { busy = false; root.removeAttribute('aria-busy'); } }
  function renderLists() {
    const entries = Object.entries(library.saved()); $('accountPlaylistCount').textContent = `(${entries.length})`;
    $('accountPlaylistList').replaceChildren(...entries.map(([id, list]) => row(`${list.name} · ${list.songs.length} 首`, [button('载入队列', () => { library.load(id); changed(); notice(`已载入「${list.name}」`); }), button('删除歌单', () => { if (confirm(`删除歌单「${list.name}」？歌曲收藏不会删除。`)) { library.remove(id); renderLists(); changed(); } })])));
  }
  function renderProgress(records) {
    const progress = Object.entries(records).filter(([key, value]) => key.startsWith('progress:') && value).sort((a,b) => b[1].savedAt - a[1].savedAt).slice(0, 4);
    $('accountProgress').replaceChildren(...progress.map(([, value]) => row(`${value.device} · ${value.song.name || value.song.id} · ${Math.floor(value.position / 60)}:${String(value.position % 60).padStart(2, '0')}`, [button('继续播放', () => library.resume(value))])));
  }
  function displayUser() {
    $('accountLogin').hidden = Boolean(user); $('accountSignedIn').hidden = !user;
    $('accountBadge').textContent = user ? '云同步' : '本地模式'; $('accountIdentityName').textContent = user?.username || user?.email || user?.name || '';
    updateGuest();
  }
  function updateGuest() { $('accountGuestQuota').textContent = `游客还可试听 ${guestTrial.remaining()} / 50 首不同歌曲 · 重复播放不扣次数`; }
  function cachedIdentity() { try { const saved = JSON.parse(storage.getItem('cp_account_identity')); return saved?.id && saved.id === storage.getItem('cp_account_owner') ? saved : null; } catch { return null; } }
  function openEntry(mode = 'login') { entry.open(mode); entry.ready(caps, guestTrial.remaining(), Boolean(window.cplayerDesktop), cachedIdentity()?.username || cachedIdentity()?.name || ''); }
  $('accountOpenEntry').onclick = () => { closeSettings(); openEntry(); };
  async function connect(next) {
    authenticated = true; entered = true; offlineMode = false;
    if (user?.id === next.id) { displayUser(); await sync.sync(); if (!authenticated) throw new Error('登录已失效，请重新登录'); return; }
    if (!user && !storage.getItem('cp_account_owner')) storage.setItem('cp_guest_library_v1', JSON.stringify(library.capture()));
    window.dispatchEvent(new Event('cplayer:account-switching')); player.suspend(); user = next; storage.setItem('cp_account_owner', user.id); storage.setItem('cp_account_identity', JSON.stringify(user));
    sync.connect(user.id); displayUser(); await sync.sync();
    if (!authenticated) throw new Error('登录已失效，请重新登录');
    notice('已登录。你的音乐资料会自动同步。');
  }
  function detach(erase = false) {
    window.dispatchEvent(new Event('cplayer:account-switching')); player.suspend(); sync.disconnect({ erase }); user = null; authenticated = false; offlineMode = false;
    storage.removeItem('cp_account_owner'); storage.removeItem('cp_account_identity');
    let guest = {}; try { guest = JSON.parse(storage.getItem('cp_guest_library_v1')) || {}; } catch {}
    library.apply(guest); displayUser(); renderLists(); notice('已退出，已恢复登录前的本地资料。');
  }
  function changed() {
    if (!user || switching || !entered) return;
    try { sync.capture(library.capture()); } catch (error) { notice(error.message, true); return; }
    clearTimeout(timer); timer = setTimeout(flush, 1500);
  }
  async function flush() {
    if (!user || syncing || switching || !entered) return;
    syncing = true;
    try {
      const withProgress = player.isPlaying() && Date.now() - lastProgress >= 30000;
      sync.capture(library.capture({ withProgress })); if (withProgress) lastProgress = Date.now();
      if (!authenticated) { const current = await request('/api/account/me'); if (current.user.id !== user.id) { await connect(current.user); return; } authenticated = true; offlineMode = false; }
      await sync.sync();
    } catch (error) { if (error.status === 401) { authenticated = false; $('accountLogin').hidden = false; } notice(error.message, true); } finally { syncing = false; }
  }
  $('accountSyncNow').onclick = () => run(flush);
  $('accountImportLocal').onclick = () => run(async () => { if (!confirm('将登录前的本地收藏、歌单、队列和设置合并到当前账号？同名项目使用本机版本。')) return; sync.import(JSON.parse(storage.getItem('cp_guest_library_v1') || '{}')); await sync.sync(); });
  $('accountSignOut').onclick = () => run(async () => { await flush(); if (sync.pending() && !confirm('还有未同步修改，将保留在此设备的账号分区。仍要退出？')) return; await request('/api/auth/sign-out', { method: 'POST', body: {} }); await window.cplayerDesktop?.signOut(); detach(); entered = false; closeSettings(); openEntry(); });
  $('accountExport').onclick = () => run(async () => {
    const data = await request('/api/account/export'); data.localPending = sync.records();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'cplayer-account.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('accountDelete').onclick = () => run(async () => { if ($('accountDeleteConfirm').value !== '删除我的账号') throw new Error('请输入“删除我的账号”确认'); await request('/api/account/delete', { method: 'POST', body: { confirmation: $('accountDeleteConfirm').value } }); let cleanupFailed = false; try { await createOfflineDatabase().clear(user.id); } catch { cleanupFailed = true; } storage.removeItem(`cp_discovery_profile_v1:${user.id}`); await window.cplayerDesktop?.signOut(); detach(true); $('accountDeleteConfirm').value = ''; notice('账号与云端资料已注销。'); entered = false; closeSettings(); openEntry('register'); entry.message(cleanupFailed ? '账号已注销，但此设备离线缓存清理失败，请在浏览器设置清除此站点数据。' : '账号已注销，可以重新注册或选择游客试听。'); });
  async function loadSessions() {
    const sessions = await request('/api/account/sessions'); $('accountSessions').replaceChildren(...sessions.map(session => row(`${session.current ? '此设备' : '其他设备'} · ${new Date(session.createdAt).toLocaleDateString()} · ${(session.userAgent || 'CPlayer Desktop').slice(0, 80)}`, session.current ? [] : [button('退出该设备', async () => { await request('/api/account/revoke', { method: 'POST', body: { id: session.id } }); await loadSessions(); notice('已撤销该设备会话'); })])));
  }
  $('accountRefreshSessions').onclick = () => run(loadSessions);
  $('accountSavePlaylist').onclick = () => run(() => { if (!player.queue().length) throw new Error('先向播放队列添加歌曲'); library.save($('accountPlaylistName').value); $('accountPlaylistName').value = ''; renderLists(); changed(); notice('歌单已保存'); });
  const params = initialAccountURL.searchParams;
  if (params.has('device') || params.has('user_code')) { $('accountDevice').hidden = false; $('accountDeviceCode').value = params.get('user_code') || '';  }
  for (const [id, action] of [['accountDeviceApprove', 'approve'], ['accountDeviceDeny', 'deny']]) $(id).onclick = () => run(async () => {
    if (!user) throw new Error('请先登录，再授权桌面客户端');
    const code = $('accountDeviceCode').value.trim(); const device = await request(`/api/auth/device?user_code=${encodeURIComponent(code)}`);
    if (device.client_id !== 'cplayer-desktop' || device.status !== 'pending') throw new Error('设备请求无效或已处理，请重新发起');
    await request(`/api/auth/device/${action}`, { method: 'POST', body: { userCode: code } }); notice(action === 'approve' ? '已允许连接，可返回桌面客户端。' : '已拒绝连接'); $('accountDevice').hidden = true;
  });
  window.cplayerDesktop?.onSignedIn(() => run(async () => { await connect((await request('/api/account/me')).user); entry.close(); }));
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('accountInstallHint').textContent = '可安装到桌面或主屏幕。'; });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('accountInstallHint').textContent = '播放器已安装。'; });
  $('accountInstall').onclick = () => run(async () => { if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; } else $('accountInstallHint').textContent = matchMedia('(display-mode: standalone)').matches || window.cplayerDesktop ? '当前已在独立窗口运行。' : /iPhone|iPad/.test(navigator.userAgent) ? 'Safari → 分享 → 添加到主屏幕。离线可打开界面，并播放个人库中已保存的音频。' : '在浏览器菜单中选择“安装应用”。离线可打开界面，并播放个人库中已保存的音频。'; });
  window.addEventListener('cplayer:library-changed', () => { renderLists(); changed(); });
  document.addEventListener('change', changed); document.addEventListener('click', () => { if (!busy) setTimeout(changed, 100); });
  window.addEventListener('online', flush); document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); else changed(); });
  window.addEventListener('storage', event => { if (event.key === 'cp_account_owner') { switching = true; player.suspend(); location.reload(); } });
  setInterval(() => { if (!document.hidden) flush(); }, 30000);
  renderLists(); updateGuest();
  async function loadCapabilities() {
    try { caps = await request('/api/account/config'); }
    catch { caps = { enabled: false }; }
    entry.ready(caps, guestTrial.remaining(), Boolean(window.cplayerDesktop), cachedIdentity()?.username || cachedIdentity()?.name || '');
    notice(caps.enabled ? '游客模式 · 登录后可以同步收藏、歌单与播放进度。' : '暂未连接账号服务，可以使用游客模式。');
  }
  entry.configure({
    async submit({ mode, username, password }) {
      await request(mode === 'register' ? '/api/auth/sign-up/username' : '/api/auth/sign-in/username', { method: 'POST', body: { username, password, rememberMe: false } });
      await connect((await request('/api/account/me')).user);
      if (params.has('device') || params.has('user_code')) setTimeout(openSettings, 0);
    },
    async offline() {
      const saved = cachedIdentity(); if (!saved || caps.enabled) throw new Error('请通过登录进入账号');
      window.dispatchEvent(new Event('cplayer:account-switching')); player.suspend(); user = saved; entered = true; authenticated = false; offlineMode = true;
      sync.connect(user.id); displayUser(); closeSettings(); notice('正在访问此设备保存的资料；联网验证身份后才能同步。');
    },
    async guest() {
      // Explicit guest selection never resumes a previously stored user session.
      if (user) await flush();
      if (caps.enabled) { try { await request('/api/auth/sign-out', { method: 'POST', body: {} }); } catch { /* Offline guest playback does not use account endpoints. */ } }
      await window.cplayerDesktop?.signOut();
      if (user || storage.getItem('cp_account_owner')) detach();
      entered = true; authenticated = false; closeSettings();
    },
    desktop: () => window.cplayerDesktop.signIn(),
    retry: loadCapabilities,
  });
  void loadCapabilities();
  window.addEventListener('pagehide', changed);
  return { changed, flush, request, library, user: () => user, signIn: () => openEntry(), checkpoint() { if (user && entered && !switching) { try { sync.capture(library.capture({ withProgress: true })); } catch (error) { notice(error.message, true); } void flush(); } }, isOffline: () => offlineMode, canEnter() { if (!entered) { openEntry(); return false; } return true; }, isSignedIn: () => authenticated && entered, updateGuest, requireLogin() { openEntry(); entry.message('游客 50 首试听额度已用完，登录后继续播放。已试听歌曲仍可重播。', true); } };
}
