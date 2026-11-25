// Shared visual primitives for the Android personal center and settings overview.
// All labels come from local UI data; account and playlist text stays plain text.
export function androidIcon(document, name) {
    const icon = document.createElement('i');
    icon.dataset.lucide = name; icon.setAttribute('aria-hidden', 'true');
    return icon;
}

export function androidRow(document, { title, note, icon, action, key }) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'android-preference-row';
    if (key) button.dataset.preference = key;
    const mark = document.createElement('span'); mark.className = 'android-preference-icon'; mark.append(androidIcon(document, icon));
    const copy = document.createElement('span'); copy.className = 'android-preference-copy';
    const name = document.createElement('strong'); name.textContent = title;
    const summary = document.createElement('small'); summary.textContent = note || ''; summary.dataset.preferenceSummary = '';
    copy.append(name, summary); button.append(mark, copy, androidIcon(document, 'ChevronRight'));
    button.addEventListener('click', action);
    return button;
}

export function profileSummary({ account, store, now = new Date() }) {
    const user = account.user();
    const today = now.toDateString();
    return {
        name: user?.username || user?.name || '音乐随行',
        identity: user ? account.isOffline() ? '离线账号 · 资料保存在本机'
            : account.isSignedIn() ? '已登录 · 可同步音乐资料' : '登录已失效 · 请重新验证' : '游客模式 · 音乐资料保存在本机',
        favorites: store.favorites().length,
        today: new Set(store.history().filter(item => new Date(item.at).toDateString() === today)
            .map(item => `${item.song.provider}:${item.song.sourceId || item.song.id}`)).size,
        lists: store.lists(),
    };
}

export function renderAndroidProfile({ document, body, account, store, offline, navigate, settings, viewPlaylist, createPlaylist, art, isCurrent }) {
    const el = (tag, className, text) => { const n = document.createElement(tag); n.className = className; if (text !== undefined) n.textContent = text; return n; };
    const summary = profileSummary({ account, store });
    const profile = el('button', 'android-profile-identity'); profile.type = 'button';
    profile.dataset.profileAccount = '';
    const avatar = el('span', 'android-profile-avatar'); avatar.append(androidIcon(document, 'UserRound'));
    const identity = el('span', 'android-profile-copy'); identity.append(el('strong', '', summary.name), el('small', '', summary.identity));
    profile.append(avatar, identity, androidIcon(document, 'ChevronRight'));
    profile.addEventListener('click', () => settings('account')); body.append(profile);

    const tiles = el('div', 'android-profile-tiles');
    function tile(section, className, title, value, glyph) {
        const button = el('button', `android-profile-tile ${className}`); button.type = 'button'; button.dataset.profileSection = section;
        const count = el('strong', '', value);
        button.append(androidIcon(document, glyph), count, el('span', '', title));
        button.addEventListener('click', () => navigate(section)); tiles.append(button); return count;
    }
    tile('favorites', 'is-favorites', '首喜欢的歌', String(summary.favorites), 'Heart');
    tile('history', 'is-history', '最近播放', `今天 ${summary.today} 首`, 'History');
    const offlineCount = tile('offline', 'is-offline', '本地与离线', '正在读取…', 'Download');
    body.append(tiles);

    const group = el('div', 'android-preference-group');
    group.append(
        androidRow(document, { title:'听歌报告', note:'回看你的音乐时光', icon:'ChartNoAxesCombined', key:'stats', action:()=>navigate('stats') }),
        androidRow(document, { title:'导入与备份', note:'带入歌单，保存你的音乐资料', icon:'FolderInput', key:'transfer', action:()=>navigate('transfer') }),
        androidRow(document, { title:'账号与同步', note:account.user() ? '收藏、歌单与播放进度' : '登录后，音乐资料随你同行', icon:'Cloud', key:'account', action:()=>settings('account') }),
    ); body.append(group);

    const heading = el('div', 'android-profile-playlists-heading'); heading.append(el('h3', '', '自建歌单'));
    const create = el('button', 'android-profile-add', '新建'); create.type = 'button'; create.prepend(androidIcon(document, 'Plus'));
    create.dataset.profileCreate = ''; create.addEventListener('click', createPlaylist); heading.append(create); body.append(heading);
    if (summary.lists.length) {
        const lists = el('div', 'android-profile-playlists');
        for (const list of summary.lists.slice(0, 4)) {
            const button = el('button', 'android-profile-playlist'); button.type = 'button';
            const copy = el('span', ''); copy.append(el('strong', '', list.name), el('small', '', `${list.songs.length} 首`));
            button.append(art(list.cover || list.songs[0]?.cover, list.name), copy, androidIcon(document, 'ChevronRight'));
            button.addEventListener('click', () => viewPlaylist(list, false)); lists.append(button);
        }
        body.append(lists);
        const all = el('button', 'android-profile-all', `管理全部歌单 · ${summary.lists.length}`); all.type = 'button';
        all.addEventListener('click', () => navigate('playlists')); body.append(all);
    } else {
        const empty = el('div', 'android-profile-empty');
        empty.append(androidIcon(document, 'ListMusic'), el('p', '', '给一段时光，建一张歌单'), el('small', '', '把喜欢的歌放在一起，随时回来听。'));
        body.append(empty);
    }
    void offline.list().then(entries => {
        if (isCurrent()) offlineCount.textContent = entries.length ? `${entries.length} 首已保存` : '还没有保存';
    }).catch(() => { if (isCurrent()) offlineCount.textContent = '暂时无法读取'; });
}
