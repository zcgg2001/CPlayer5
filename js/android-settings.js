import { androidIcon, androidRow } from './android-profile.js';
import { MUSIC_SOURCE_OPTIONS } from './music-service.js';

export function androidBuildLabel(userAgent = globalThis.navigator?.userAgent || '') {
    const build = /\bCPlayerAndroid\/(\S+) CPlayerPreview\/(\d+)\b/.exec(userAgent);
    return build ? `ZPlayer ${build[1]} · 构建 ${build[2]}` : 'ZPlayer · Android 预览界面';
}

// Reparent the existing controls once. Their event handlers and save behavior
// remain attached; the overview and subpages never create duplicate forms.
export function createAndroidSettings({ document, musicService, account, library, close, notify }) {
    const card = document.getElementById('settingsCard'), modal = document.getElementById('settingsModal');
    if (!card) return null;
    const scroll = card.querySelector('.settings-scroll'), header = card.firstElementChild, title = document.getElementById('settingsTitle');
    card.classList.add('android-settings'); header.classList.add('android-settings-toolbar');
    title.textContent = '设置'; title.tabIndex = -1;
    const back = document.createElement('button'); back.type = 'button'; back.id = 'androidSettingsBack'; back.setAttribute('aria-label', '返回');
    back.append(androidIcon(document, 'ArrowLeft')); header.prepend(back);
    const workspace = document.createElement('div'); workspace.className = 'android-settings-workspace';
    const overview = document.createElement('nav'); overview.className = 'android-settings-overview'; overview.setAttribute('aria-label', '设置分类');
    const intro = document.createElement('div'); intro.className = 'android-settings-intro';
    intro.innerHTML = '<h3>设置</h3><p>让每一次聆听，都合你心意</p>';
    overview.append(intro);
    scroll.before(workspace); workspace.append(overview, scroll);
    const original = [...scroll.children];
    const groups = [
        ['聆听偏好', [
            ['appearance','外观','Palette','主题与界面语言',['.entry-language','.android-appearance']],
            ['player','播放页','Disc3','封面形状、氛围光与封面匹配',['.android-cover-settings']],
            ['lyrics','歌词与动画','Captions','歌词效果、字号与时间校正',['.lyric-settings']],
            ['sources','音乐源','AudioLines','搜索来源、自定义音源与播放优先',['.music-source-setting','#lxSourceForm','#gdSourceCredit','#musicKeyForm']],
        ]],
        ['音乐与资料', [
            ['account','账号与同步','Cloud','登录、设备与音乐资料同步',['#accountPanel']],
            ['library','歌单与导入','ListMusic','当前队列与在线歌单',['#playlistSourceCard','.playlist-import-setting','#fileImportSection']],
            ['offline','本地与离线','HardDrive','已保存音频与存储空间',[]],
            ['transfer','导入与备份','FolderInput','歌单迁移与个人资料导出',[]],
        ]],
        ['应用', [['about','关于与更新','Info','当前版本与应用更新',['#androidUpdateSettings','.settings-about']]]],
    ];
    const panels = new Map(), buttons = new Map(), info = new Map();
    let selected = null, visible = false, returnTo = null, homeScroll = 0;
    const isWide = () => document.defaultView.matchMedia('(min-width: 840px)').matches;
    const version = androidBuildLabel();
    for (const [groupName, rows] of groups) {
        const section = document.createElement('section'); section.className = 'android-settings-group';
        const h = document.createElement('h3'); h.textContent = groupName;
        const list = document.createElement('div'); list.className = 'android-preference-group'; section.append(h, list); overview.append(section);
        for (const [key, name, icon, note, selectors] of rows) {
            info.set(key, { name, note });
            const button = androidRow(document, { title:name, note, icon, key, action:()=>select(key) });
            list.append(button); buttons.set(key, button);
            if (!selectors.length) continue;
            const panel = document.createElement('div'); panel.className = 'android-settings-panel'; panel.hidden = true; panel.dataset.settingsPage = key;
            panel.id = `androidSettings-${key}`;
            button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false');
            const heading = document.createElement('div'); heading.className = 'android-settings-detail-heading';
            const nameNode = document.createElement('h3'); nameNode.textContent = name; nameNode.tabIndex = -1;
            const description = document.createElement('p'); description.textContent = note; heading.append(nameNode, description); panel.append(heading);
            for (const selector of selectors) { const node = scroll.querySelector(selector); if (node) panel.append(node); }
            scroll.append(panel); panels.set(key, panel);
        }
    }
    // Desktop-only controls are retained for their startup code, without entering
    // the Android reading or tab order.
    const legacy = document.createElement('div'); legacy.hidden = true; legacy.inert = true;
    original.filter(node => node.parentElement === scroll).forEach(node => legacy.append(node)); scroll.append(legacy);
    const about = document.createElement('section'); about.className = 'android-settings-about';
    const wordmark = document.createElement('span'); wordmark.className = 'android-settings-wordmark'; wordmark.textContent = 'Z'; wordmark.setAttribute('aria-hidden', 'true');
    const versionText = document.createElement('h3'); versionText.textContent = version; versionText.dataset.noI18n = '';
    const aboutNote = document.createElement('p'); aboutNote.textContent = '你的音乐，随时随地。';
    about.append(wordmark, versionText, aboutNote); panels.get('about').children[0].after(about);
    card.lastElementChild.classList.add('android-settings-footer'); card.lastElementChild.textContent = version;
    card.lastElementChild.dataset.noI18n = '';

    const preferred = document.createElement('section'); preferred.className = 'android-playback-preference';
    const prefLabel = document.createElement('label'); prefLabel.htmlFor = 'androidPlaybackPreference'; prefLabel.textContent = '后续播放优先';
    const preference = document.createElement('select'); preference.id = 'androidPlaybackPreference';
    preference.append(new Option('自动选择', ''));
    for (const [id, option] of Object.entries(MUSIC_SOURCE_OPTIONS)) if (!['chksz','bilibili'].includes(id)) preference.append(new Option(option.label, id));
    const hint = document.createElement('p'); hint.textContent = '用于接下来的歌曲；当前歌曲可在播放器顶部换源。不可用时自动尝试其他渠道。';
    preferred.append(prefLabel, preference, hint); panels.get('sources').children[0].after(preferred);
    preference.addEventListener('change', () => { musicService.setPlaybackPreference(preference.value); sync(); notify('后续播放偏好已保存'); });

    function sync() {
        const doc = document.documentElement;
        const shape = { rounded:'圆角', circle:'圆形', petal:'花瓣' }[doc.dataset.coverShape] || '花瓣';
        const user = account.user();
        const summaries = {
            appearance:`${doc.dataset.theme === 'light' ? '浅色' : '深色'} · ${doc.lang === 'en' ? 'English' : '简体中文'}`,
            player:`${shape}封面 · 氛围光${doc.dataset.coverAmbient === 'false' ? '已关闭' : '已开启'}`,
            lyrics:`${document.getElementById('lyricEffectSelect').selectedOptions[0]?.textContent || '默认效果'} · ${document.getElementById('lyricFontSize').value} px`,
            sources: musicService.config.playbackSource ? `播放优先 ${MUSIC_SOURCE_OPTIONS[musicService.config.playbackSource]?.label}` : `自动换源 · 搜索 ${MUSIC_SOURCE_OPTIONS[musicService.config.source]?.label || '默认渠道'}`,
            account:user ? `${user.username || user.name} · ${account.isOffline() ? '离线资料' : account.isSignedIn() ? '已登录' : '需要重新登录'}` : '未登录 · 本机优先',
            library:`${library.store.lists().length} 张歌单 · 导入在线歌单`,
            about:version,
        };
        for (const [key, value] of Object.entries(summaries)) buttons.get(key).querySelector('[data-preference-summary]').textContent = value;
        preference.value = musicService.config.playbackSource;
    }
    function paint({ focus = false } = {}) {
        const wide = isWide();
        card.dataset.settingsView = selected ? 'detail' : 'home';
        overview.hidden = !wide && Boolean(selected);
        scroll.hidden = !selected;
        scroll.inert = !selected;
        for (const [key, panel] of panels) panel.hidden = key !== selected;
        for (const [key, button] of buttons) { button.setAttribute('aria-current', key === selected ? 'page' : 'false'); if (panels.has(key)) button.setAttribute('aria-expanded', String(key === selected)); }
        title.textContent = selected && !wide ? info.get(selected).name : '设置';
        back.setAttribute('aria-label', selected ? '返回设置首页' : returnTo ? '返回个人中心' : '返回播放器');
        sync();
        if (focus) {
            const target = selected ? wide ? panels.get(selected).querySelector('h3') : title : buttons.get(lastSelected) || back;
            target?.focus({preventScroll:true});
        }
    }
    let lastSelected = null;
    function select(key) {
        if (!panels.has(key)) {
            if (['offline','transfer'].includes(key)) { returnTo = null; close(); void library.open({section:key}); }
            return;
        }
        if (!selected) homeScroll = overview.scrollTop;
        selected = lastSelected = key; scroll.scrollTop = 0; paint({focus:true});
    }
    function goBack() {
        if (!selected) return false;
        selected = null; paint({focus:true}); overview.scrollTop = homeScroll; return true;
    }
    back.addEventListener('click', () => { if (!goBack()) close(); });
    scroll.addEventListener('change', () => queueMicrotask(sync));
    scroll.addEventListener('click', () => queueMicrotask(sync));
    document.defaultView.addEventListener('resize', () => { if (visible) paint(); });
    document.defaultView.addEventListener('cplayer:locale', () => { if (visible) sync(); });
    return {
        open(options = {}) {
            visible = true; returnTo = typeof options.onClose === 'function' ? options.onClose : null;
            selected = panels.has(options.section) ? options.section : null;
            lastSelected = selected; homeScroll = 0; overview.scrollTop = scroll.scrollTop = 0;
            paint();
        },
        closed() { if (!visible) return; visible = false; const done = returnTo; returnTo = null; done?.(); },
        back:goBack, sync,
    };
}
