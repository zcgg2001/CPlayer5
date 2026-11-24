const messages = {
  coverCarousel: ['专辑封面轮播', 'Album cover carousel'],
  coverCarouselHelp: ['左右滑动或使用方向键切歌，点击中央封面查看歌词。', 'Swipe or use arrow keys to change tracks. Tap the center cover for lyrics.'],
  coverPrevious: ['上一首：{title}', 'Previous track: {title}'],
  coverNext: ['下一首：{title}', 'Next track: {title}'],
  coverShowLyrics: ['查看《{title}》的歌词', 'Show lyrics for {title}'],
  coverUnknown: ['未知歌曲', 'Unknown track'], coverAlbum: ['专辑封面', 'Album artwork'],
  coverQueuePosition: ['播放顺序：第 {position} 首，共 {total} 首', 'Playback order: {position} of {total}'],
  playModeSequence: ['顺序播放', 'Play in order'], playModeSequenceHint: ['按队列顺序循环播放', 'Loop through the queue in order'],
  playModeRandom: ['随机播放', 'Shuffle'], playModeRandomHint: ['打乱当前队列播放', 'Play the current queue in shuffled order'],
  playModeSingle: ['单曲循环', 'Repeat one'], playModeSingleHint: ['重复播放当前歌曲', 'Repeat the current track'],
  switchPlayMode: ['点击切换播放模式', 'Activate to change playback mode'],
  appUpdates: ['应用更新', 'App updates'], checkAppUpdates: ['检查更新', 'Check for updates'],
  coverAppearance: ['播放页封面', 'Player artwork'], coverAppearanceHint: ['选一种形状，让封面成为播放页的主角。', 'Make the album artwork the focus of your player.'],
  coverRounded: ['圆角', 'Rounded'], coverCircle: ['圆形', 'Circle'], coverPetal: ['花瓣', 'Petal'], coverAmbient: ['封面氛围光', 'Artwork glow'],
  updateDownload: ['下载更新', 'Download update'], updateNotes: ['版本说明', 'Release notes'],
  updateInstalled: ['当前版本 {version}', 'Installed version {version}'], updateAvailable: ['新版本 {tag}', 'Update available · {tag}'],
  updateChecking: ['正在检查更新线路…', 'Checking for updates…'], updateCurrent: ['已是最新版本', 'You’re up to date'],
  updateNotChecked: ['尚未检查更新', 'Updates have not been checked yet'], updateSource: ['更新线路', 'Update source'],
  updateSourceAuto: ['自动选择（镜像优先）', 'Automatic (mirrors first)'], updateSourceDirect: ['GitHub 直连', 'GitHub directly'],
  updateRouteHint: ['镜像连接失败会自动切换线路，下载后校验再安装。', 'Mirrors retry on another route. Downloads are verified before installation.'],
  updateDownloading: ['正在下载 · {percent}% · {route}', 'Downloading · {percent}% · {route}'],
  updateVerifying: ['下载完成，正在校验安装包…', 'Download complete. Verifying the package…'],
  updateReady: ['校验通过，可以安装更新。', 'Package verified. Ready to install.'], updateCancel: ['取消下载', 'Cancel download'],
  updateCancelled: ['已取消下载，可随时重试。', 'Download cancelled. You can retry anytime.'], updateInstall: ['安装更新', 'Install update'],
  updateInstallPermission: ['请允许此应用安装更新，返回后再次点“安装更新”。', 'Allow installs from this app, then return and select Install update again.'],
  updateInstallerOpened: ['已打开系统安装器，请按系统提示完成安装。', 'The system installer is open. Follow its instructions to finish.'],
  updateDownloadFailed: ['下载失败，请切换线路后重试。', 'Download failed. Try another source.'],
  updateMissingDigest: ['此版本缺少安装包校验信息，请查看版本说明。', 'This release has no package checksum. View its release notes.'],
  updateFailed: ['暂时无法检查 GitHub，请稍后重试。', 'Couldn’t check GitHub. Try again later.'],
  adminLogin: ['管理员登录', 'Administrator sign in'], adminLoginNote: ['使用管理员账号登录。首次登录后需设置新的管理密码。', 'Sign in with your administrator account. Set a new password after your first sign-in.'], adminUsername: ['用户名', 'Username'], adminPassword: ['密码', 'Password'], adminSignIn: ['登录后台', 'Sign in'], setupTitle: ['设置管理密码', 'Set administrator password'], setupNote: ['初始密码仅用于首次登录。设置 12–128 位新密码后，重新登录即可管理站点。', 'The initial password is for first sign-in only. Set a 12–128 character password and sign in again.'], currentPassword: ['当前密码', 'Current password'], newPassword: ['新密码', 'New password'], confirmPassword: ['确认新密码', 'Confirm new password'], setPassword: ['设置密码并重新登录', 'Set password & sign in again'], passwordRequired: ['请先修改初始密码，再使用管理功能', 'Replace the initial password before using administrator features.'], passwordChanged: ['密码已修改，请使用新密码重新登录。', 'Password updated. Sign in with your new password.'], passwordInvalid: ['新密码需为 12–128 位，且两次输入一致，请勿使用默认密码', 'Use a 12–128 character password, confirm it, and avoid default passwords.'], passwordWrong: ['用户名或密码不正确', 'Incorrect username or password'], signingIn: ['正在登录…', 'Signing in…'], passwordFresh: ['请重新登录后修改初始密码', 'Sign in again before changing the initial password.'],

  discardConfig: ['放弃修改并刷新', 'Discard changes & reload'],
  operationFilter: ['查看链路', 'Operation'],
  backPlayer: ['返回播放器', 'Back to player'], opsTitle: ['运行控制台', 'Operations'], opsDescription: ['观察音源表现，让每一次播放更可靠。', 'Monitor sources. Keep every playback reliable.'], refresh: ['刷新数据', 'Refresh'], sourceHealth: ['音源健康度', 'Source health'], healthNote: ['近 24 个小时桶的服务端接口结果；缓存命中不计入。空白指标表示尚无样本。', 'Server results across 24 hourly buckets, excluding edge cache hits. Dashes mean no samples.'], autoRefresh: ['30 秒自动刷新', 'Refresh every 30s'], source: ['音源 / 链路', 'Source / operation'], status: ['状态', 'Status'], requests: ['请求数', 'Requests'], availability: ['可用率', 'Availability'], failureRate: ['失败率', 'Failure rate'], latency: ['平均延迟', 'Avg latency'], circuitNote: ['连续 3 次故障暂停音源，冷却后放行一次真实请求探测；单曲不存在不触发摘除。', 'Three consecutive failures open the circuit. One real request probes recovery after cooldown; missing tracks do not trip it.'], recentEvents: ['错误与核心链路', 'Errors & playback events'], operationsConfig: ['运营配置', 'Content & sources'], configNote: ['保存后生效。密钥只在服务器配置，页面不提供密钥编辑。', 'Changes take effect after saving. Credentials remain on the server.'], sourceConfig: ['音源开关与优先级', 'Source controls & priority'], priorityNote: ['数字越小越优先；用户明确选择的音源仍优先尝试。', 'Lower numbers take priority. Explicit user choices are tried first.'], homeModules: ['首页模块', 'Home modules'], moduleNote: ['勾选要展示的模块，使用箭头调整顺序。', 'Select visible modules and use arrows to reorder them.'], chartConfig: ['榜单 ID（逗号分隔，留空使用全部公开榜单）', 'Chart IDs (comma-separated; leave empty for all public charts)'], wordConfig: ['敏感词（每行一个，作用于公开内容和搜索）', 'Blocked terms (one per line; applies to public content and search)'], pageReview: ['公开页面审核', 'Public page review'], pageNote: ['只有已发布的页面允许访问和进入 sitemap；私人收藏和个人歌单不会被收录。', 'Only published pages can be accessed and indexed. Private collections are excluded.'], type: ['类型', 'Type'], artist: ['歌手', 'Artist'], album: ['专辑', 'Album'], playlist: ['歌单', 'Playlist'], addDraft: ['添加草稿', 'Add draft'], notChanged: ['尚未修改配置', 'No unsaved changes'], saveConfig: ['保存配置', 'Save changes'], audit: ['配置变更记录', 'Configuration history'], daily: ['每日推荐', 'Daily mix'], radio: ['私人电台', 'Personal radio'], history: ['继续播放', 'Continue listening'], recommendations: ['猜你喜欢', 'For you'], news: ['新歌速递', 'New releases'], scenes: ['此刻，想听什么', 'Music for the moment'], draft: ['待审核', 'Draft'], published: ['已发布', 'Published'], rejected: ['已驳回', 'Rejected'], remove: ['移除', 'Remove'], healthy: ['正常', 'Healthy'], cooling: ['冷却中', 'Cooling down'], probing: ['等待探测', 'Awaiting probe'], disabled: ['已停用', 'Disabled'], unknown: ['暂无样本', 'No samples'], search: ['搜索', 'Search'], playback: ['播放', 'Playback'], metadata: ['资料', 'Metadata'], alertOn: ['已配置外部告警；本页保留近期事件。', 'External alerts configured. Recent events appear below.'], alertOff: ['告警记录在本页；外部通知尚未配置。', 'Alerts are recorded here. External notifications are not configured.'], emptyEvents: ['暂无事件', 'No events yet'], checking: ['正在验证管理权限…', 'Checking access…'], updated: ['更新于 {time}', 'Updated {time}'], dirty: ['有未保存的修改', 'Unsaved changes'], saving: ['正在保存…', 'Saving…'], saved: ['配置已保存', 'Changes saved'], enabledSources: ['已启用音源', 'Enabled sources'], coolingSources: ['熔断链路', 'Open circuits'], movedUp: ['上移', 'Move up'], movedDown: ['下移', 'Move down'], badPage: ['请输入有效且不重复的数字 ID', 'Enter a valid, unique numeric ID'], sourceSwitched: ['已为你切换音源 · {source}', 'Switched your source to {source}'], clientRate: ['操作过于频繁，请稍后重试', 'Too many requests. Please try again shortly.'], loginRequired: ['请使用下方表单登录管理员账号', 'Sign in with your administrator account below.'], adminRequired: ['当前账号没有管理权限', 'This account does not have administrator access.'], conflict: ['配置已被其他管理员更新，请刷新后重试', 'Another administrator changed the configuration. Refresh and try again.'], unavailable: ['服务暂时不可用，请稍后重试', 'Service unavailable. Please try again.'],
};
// Legacy screens can migrate incrementally to explicit keys without rewriting
// song titles or any user content. Only exact interface strings are translated.
const legacy = [
  ['无需登录，听歌不限首数', 'Listen without signing in or a track limit'],
  ['游客听歌不限首数。', 'Guests can listen without a track limit.'],
  ['忽略此版本', 'Dismiss this version'],
  ['发现', 'Discover'], ['主导航', 'Main navigation'], ['正在播放', 'Now playing'], ['收起播放器', 'Collapse player'],
  ['切换明暗主题', 'Switch theme'], ['我喜欢', 'Favorites'], ['最近播放', 'Recently played'], ['我的歌单', 'Playlists'],
  ['欢迎回来', 'Welcome back'], ['让音乐，', 'Let music'], ['接着陪你。', 'stay with you.'], ['收藏喜欢的歌，保存此刻的歌单。', 'Save your favorites and playlists.'], ['换一台设备，也能接着听。', 'Keep listening on any device.'], ['每次打开都由你选择登录或游客模式。', 'Choose sign-in or guest mode each time you open.'], ['也可以先听听', 'Or give it a listen'], ['3–24 位字母、数字或下划线', '3–24 letters, numbers or underscores'], ['8–128 位密码', '8–128 characters'], ['再次输入密码', 'Enter password again'], ['显示或隐藏密码', 'Show or hide password'], ['播放器设置', 'Player settings'], ['公开音乐资料', 'Public music library'], ['创建你的账号', 'Create your account'], ['一个用户名和密码，就能保存你的音乐。', 'A username and password are all you need to save your music.'], ['登录账号，在不同设备间继续聆听。', 'Sign in to keep listening across your devices.'], ['登录', 'Sign in'], ['注册', 'Register'], ['用户名', 'Username'], ['密码', 'Password'], ['确认密码', 'Confirm password'], ['显示', 'Show'], ['隐藏', 'Hide'], ['注册并进入播放器', 'Create account & listen'], ['游客进入', 'Continue as guest'], ['正在登录…', 'Signing in…'], ['正在创建账号…', 'Creating account…'], ['正在进入游客模式…', 'Entering guest mode…'], ['账号服务暂未连接，你可以先以游客试听。', 'Account service unavailable. You can listen as a guest.'], ['用户名需为 3–24 位字母、数字或下划线', 'Use 3–24 letters, numbers or underscores.'], ['两次输入的密码不一致', 'Passwords do not match.'], ['忘记密码？请联系站点管理员。', 'Forgot your password? Contact the site administrator.'], ['搜索歌曲、歌手', 'Search songs or artists'], ['搜索歌曲', 'Search songs'], ['发现音乐', 'Discover'], ['我的音乐', 'My music'], ['音乐馆', 'Music library'], ['搜索结果', 'Search results'], ['设置', 'Settings'], ['账号与同步', 'Account & sync'], ['收藏', 'Favorites'], ['播放队列', 'Play queue'], ['上一首', 'Previous'], ['下一首', 'Next'], ['播放 / 暂停', 'Play / pause'], ['暂停', 'Pause'], ['音量', 'Volume'], ['歌词', 'Lyrics'], ['关闭', 'Close'], ['重试', 'Retry'], ['选择音源', 'Choose source'], ['开始播放', 'Start playback'], ['正在缓冲音频…', 'Buffering audio…'], ['歌曲已就绪，点击开始播放', 'Ready. Press play to listen.'], ['歌曲已加载，请点击播放键继续', 'Track loaded. Press play to continue.'], ['播放连接中断，正在自动切换音源…', 'Connection interrupted. Switching source…'], ['当前资源无法播放，正在尝试其他音质或音源…', 'Audio unavailable. Trying another quality or source…'], ['已尝试可用音源，暂时没有能播放的同一版本歌曲，请稍后重试', 'No playable copy of this recording is available. Try again later.'], ['从一首喜欢的歌开始', 'Start with a favorite song'], ['浏览推荐', 'Browse recommendations'], ['导入歌单', 'Import playlist'], ['音乐偏好', 'Music preferences'], ['播放全部', 'Play all'], ['查看全部', 'View all'], ['我的收藏', 'My favorites'], ['退出登录', 'Sign out'], ['云同步', 'Cloud sync'], ['立即同步', 'Sync now'], ['导出数据', 'Export data'], ['注销账号', 'Delete account'], ['重新连接', 'Reconnect'], ['账号', 'Account'], ['播放进度', 'Playback progress'], ['更多选项', 'More options'], ['全部榜单', 'All charts'], ['搜索熟悉的旋律，或发现今天的新声音。', 'Find familiar songs or discover something new.'], ['选好歌曲后，播放控制和歌词会出现在这里。', 'Choose a track to see playback controls and lyrics.'], ['注册账号', 'Create account'], ['登录账号', 'Sign in'], ['打开设置', 'Open settings'], ['语言', 'Language'],
];
const literalPairs = new Map([...Object.values(messages), ...legacy]);
let locale = 'zh-CN';
try { locale = new URLSearchParams(globalThis.location?.search).get('lang') || globalThis.localStorage?.getItem('cp_locale') || 'zh-CN'; } catch { /* Optional preference. */ }
if (!['zh-CN', 'en'].includes(locale)) locale = 'zh-CN';
export const getLocale = () => locale;
export function t(key, values = {}) { let text = messages[key]?.[locale === 'en' ? 1 : 0] || key; for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value)); return text; }
export const formatNumber = (value, options) => new Intl.NumberFormat(locale, options).format(value);
export const formatTime = value => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
export function setLocale(value) { locale = value === 'en' ? 'en' : 'zh-CN'; try { globalThis.localStorage?.setItem('cp_locale', locale); } catch {} globalThis.dispatchEvent?.(new Event('cplayer:locale')); }
export function translateLiteral(text) {
  if (locale !== 'en') return text;
  const trimmed = text.trim(), found = literalPairs.get(trimmed);
  if (found) return text.replace(trimmed, found);
  return text;
}
export function initI18n(document = globalThis.document) {
  if (!document) return;
  const originalText = new WeakMap(), originalAttrs = new WeakMap();
  const apply = root => {
    if (root.nodeType === 3) {
      if (root.parentElement?.closest('script,style,textarea,[data-no-i18n],.song-title,.track-title,.discover-track-copy,.discover-track-extra,#songTitle,#artistName,#mobileTitle,#mobileArtist,#collectionDialogTitle,#collectionDialogMeta,.catalog-track-title')) return;
      const old = originalText.get(root); const raw = old && root.nodeValue === old.translated ? old.raw : root.nodeValue;
      const translated = translateLiteral(raw); originalText.set(root, { raw, translated }); if (root.nodeValue !== translated) root.nodeValue = translated;
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) {
      if (root.matches('script,style,textarea,[data-no-i18n]')) return;
      if (root.dataset.i18n) { const value = t(root.dataset.i18n); if (root.textContent !== value) root.textContent = value; return; }
      const remembered = originalAttrs.get(root) || {};
      for (const name of ['placeholder', 'aria-label', 'title']) if (root.hasAttribute(name)) {
        const current = root.getAttribute(name), old = remembered[name], raw = old && current === old.translated ? old.raw : current, translated = translateLiteral(raw);
        remembered[name] = { raw, translated }; if (current !== translated) root.setAttribute(name, translated);
      }
      originalAttrs.set(root, remembered);
    }
    for (const child of [...root.childNodes]) apply(child);
  };
  const update = () => { document.documentElement.lang = locale; apply(document); document.querySelectorAll('[data-language]').forEach(el => { el.value = locale; }); };
  document.querySelectorAll('[data-language]').forEach(el => el.addEventListener('change', () => setLocale(el.value)));
  globalThis.addEventListener?.('cplayer:locale', update); update();
  const observer = new MutationObserver(records => { for (const record of records) { if (record.type === 'childList') record.addedNodes.forEach(apply); else apply(record.target); } });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
  return () => { observer.disconnect(); globalThis.removeEventListener?.('cplayer:locale', update); };
}
