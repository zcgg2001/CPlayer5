import { initI18n, t } from './i18n.js';
import { initAndroidUpdates } from './android-updates.js';
import { initPlayerAppearance } from './player-appearance.js';
import { initDiagnostics } from './runtime-policy.js';
initI18n(); initDiagnostics();
import { DESKTOP_SHELL_MEDIA, initAppShell } from './app-shell.js?v=23';
import { createChartsController } from './charts-page.js?v=33';
import {
    createArtistsController,
    createVideosController,
    formatReleaseDate
} from './music-explore.js?v=33';
import { normalizeMediaUrl } from './security.js?v=35';
import {
    RequestCancelledError,
    requestErrorMessage,
    requestJson
} from './http.js?v=37';
import {
    normalizeBilibiliPayload,
    bilibiliVideoUrl,
    normalizePlaylistPayload
} from './music-data.js?v=41';
import {
    DOWNLOAD_QUALITY_OPTIONS,
    downloadFilename,
    resolveDownloadSong,
    saveAudioBlob
} from './music-download.js?v=39';
import { createDownloadSession } from './download-session.js?v=22';
import { createPlaybackController } from './playback-controller.js?v=7';
import { createPlayerAudio } from './native-audio.js';
import { artworkUrl, bindArtwork, fallbackArtwork, artworkResolver, createArtworkPresenter, refreshArtworkBindings } from './artwork.js?v=1';
import { initArtworkRecovery } from './artwork-recovery-ui.js';
import { artworkChoiceKey } from './artwork-recovery.js';
import { createQueueStore } from './queue-store.js?v=1';
import { createCoverCarousel, coverQueueWindow } from './cover-carousel.js';
import { createMusicWall } from './music-wall.js';
import { createPlayerSource } from './player-source.js';
let playerSourceUI = null;
import { createAndroidSettings } from './android-settings.js';
let androidSettingsUI = null;
import { initAccountPanel } from './account-panel.js?v=6';
let accountPanel = null;
let personalLibrary = null;
import { initPersonalLibrary } from './personal-library.js';
import { createCacheStore } from './cache-store.js?v=1';
import { createMusicKeySettings } from './music-key-settings.js?v=4';
import { bindLxSettings, lxSourceLabel } from './lx-music-sources.js';
import { isMusicChannel } from './music-channels.js?v=1';
import { createMusicSourceTabs } from './music-source-tabs.js?v=5';
import { createCatalogBrowser } from './catalog-browser.js?v=2';
import { createDiscoveryHome } from './discovery-home.js?v=2';
import { createPlayerExperience } from './player-experience.js?v=2';
import { createDiscoveryTable } from './discovery-table.js?v=3';
import { createListeningRoom } from './listening-room.js?v=2';
import { createLyricEffects } from './lyric-effects.js?v=4';
import { createNativeLyricLookup } from './lyrics/native-lookup.js';
import {
    DEFAULT_QUALITY,
    DEFAULT_MUSIC_SOURCE,
    MUSIC_API_BASE_URL,
    MUSIC_SOURCE_OPTIONS,
    QUALITY_DETAILS,
    MusicService,
    musicSourceOption,
    normalizeChannelSongs,
    qualityDetails,
    supportedMusicSource,
    supportedQuality
} from './music-service.js?v=12';

const desktopShellMedia = window.matchMedia(DESKTOP_SHELL_MEDIA);
const isCompactLayout = () => !desktopShellMedia.matches;
const androidPlayer = document.documentElement.classList.contains('android-player');
const LAST_COVER_KEY = 'cp_lastCover';
const EDITORIAL_PLAYLISTS = Object.freeze([
    { id: '19723756', description: '捕捉今天正在上升的旋律', tone: 'violet' },
    { id: '2884035', description: '听见华语原创的新鲜表达', tone: 'rose' },
    { id: '3779629', description: '第一时间抵达全网新声', tone: 'sky' },
    { id: '5059644681', description: '清透细腻的日系旋律漫游', tone: 'cyan' },
    { id: '71384707', description: '在古典作品里沉静片刻', tone: 'amber' },
    { id: '991319590', description: '锋利节拍与中文表达现场', tone: 'indigo' },
]);
const SCENE_PLAYLISTS = Object.freeze([
    { playlistId: '3779629', title: '清晨通勤', description: '用新鲜旋律开启今天', icon: 'fa-sun', tone: 'sky' },
    { playlistId: '71384707', title: '沉浸专注', description: '给思绪留出安静的空间', icon: 'fa-feather-alt', tone: 'cyan' },
    { playlistId: '2884035', title: '夜晚独处', description: '原创声音陪你慢慢放松', icon: 'fa-moon', tone: 'violet' },
    { playlistId: '991319590', title: '运动能量', description: '让节拍推高身体状态', icon: 'fa-bolt', tone: 'rose' },
    { playlistId: '5059644681', title: '日系漫游', description: '适合散步与旅行的轻盈感', icon: 'fa-paper-plane', tone: 'indigo' },
    { playlistId: '19723756', title: '发现新声', description: '跟上此刻正在升温的音乐', icon: 'fa-compass', tone: 'amber' },
]);
function persistentCoverUrl(value) {
    const safeCover = normalizeMediaUrl(value, { baseUrl: window.location.href });
    if (!safeCover) return '';

    try {
        const url = new URL(safeCover);
        return url.protocol === 'http:' || url.protocol === 'https:' ? safeCover : '';
    } catch (error) {
        return '';
    }
}

function coverVariantUrl(value, width = 720) {
    return artworkUrl(value, width);
}

function saveLastCover(value) {
    const cover = persistentCoverUrl(value);
    if (!cover) return;

    try {
        localStorage.setItem(LAST_COVER_KEY, cover);
    } catch (error) {
        console.warn('无法保存上次播放封面:', error);
    }
}

function restoreLastCover() {
    let storedCover = '';
    try {
        storedCover = localStorage.getItem(LAST_COVER_KEY) || '';
    } catch (error) {
        console.warn('无法读取上次播放封面:', error);
        return;
    }

    const savedCover = persistentCoverUrl(storedCover);
    if (!savedCover) {
        if (storedCover) {
            try {
                localStorage.removeItem(LAST_COVER_KEY);
            } catch (error) {
                console.warn('无法清理无效封面记录:', error);
            }
        }
        return;
    }

    // Startup restoration uses the same validation and failure path as playback.
    void artworkPresenter.show({ cover: savedCover, name: '上次播放', artworkRestore: true });
}

let playbackArtworkUrl = '';
let artworkColorController = null;
let artworkRecoveryUI = null;
const artworkPresenter = createArtworkPresenter({
    resolver: artworkResolver,
    images: () => [dom.albumArt, dom.mobileCoverImg, dom.desktopMiniCover, document.getElementById('mobileBrowseCover'), dom.androidCoverBackdrop],
    onChange(result, song) {
        playbackArtworkUrl = result.url;
        artworkColorController?.abort();
        artworkColorController = new AbortController();
        lyricEffects?.refreshArtwork();
        if (result.recovered) artworkRecoveryUI?.sync();
        if (result.status === 'ready') {
            const picUrl = result.url;
            saveLastCover(picUrl);
            void fluidBg?.extractColorsFromImage(picUrl, { signal: artworkColorController.signal });
        } else if (fluidBg) {
            fluidBg.setColors(result.colors);
            fluidBg.render();
        }
        if (!song.artworkRestore) updateMediaSessionMetadata({ ...song, cover: result.status === 'ready' ? result.url : '' });
    },
});

let nativeIntegrationInitialized = false;

function initNativeIntegration() {
    if (nativeIntegrationInitialized || !globalThis.plus) return;
    nativeIntegrationInitialized = true;

    try {
        plus.screen.lockOrientation('portrait-primary');
        plus.audio.createPlayer();
        plus.device.setWakelock(true);
        plus.key.addEventListener('backbutton', () => {
            const main = plus.android.runtimeMainActivity();
            main.moveTaskToBack(false);
        });
    } catch (error) {
        console.warn('H5+ 初始化失败:', error);
    }
}

document.addEventListener('plusready', initNativeIntegration, { once: true });

class LyricService {
    static async fetchLyrics(songId, song = null, { signal } = {}) {
        return musicService.getLyric(songId, { song, signal });
    }
}

// ================= 业务逻辑 =================
const musicService = new MusicService();

let listeningRoom = null;
let lyricEffects = null;
let audio = createPlayerAudio();
audio.crossOrigin = 'anonymous';
// Android uses Media3 output without the browser's gain/compressor chain.
audio.volume = androidPlayer ? 0.6 : 0.5;

// 预加载音频（用于无缝播放）
let preloadAudio = new Audio();
preloadAudio.crossOrigin = 'anonymous';
preloadAudio.volume = 0;


let audioContext, analyser, gainNode, isPlaying = false;
const queueStore = createQueueStore();
const queue = queueStore.state;
Object.defineProperty(window, 'playlist', {
    configurable: true,
    get: () => queue.playlist,
    set: value => {
        if (value === queue.playlist) return;
        queue.playlist = Array.isArray(value) ? value : [];
        queueStore.resetOrder();
    },
});
const playback = createPlaybackController({ audio, preloadAudio, musicService, queueStore });
audio.addEventListener('nativeaction', event => {
    if (event.detail === 'next') playNextSong();
    else if (event.detail === 'previous') playPreviousSong();
});
let playerExperience = null;
let parsedLyrics = [], activeLyricIndex = -1;




// Keep the existing page API; cache failures degrade inside the store.
const cacheStore = createCacheStore();
const initDatabase = cacheStore.init;
const savePlaylistToCache = cacheStore.savePlaylist;
const getPlaylistFromCache = cacheStore.getPlaylist;
window.getCachedImage = cacheStore.getImage;

// ================= 伪随机播放：打乱播放列表 =================
function shufflePlaylist() { return queueStore.shuffle(); }

// 获取下一首歌曲的索引
function getNextSongIndex() { return queueStore.next({ manual: true }); }

// 获取上一首歌曲的索引
function getPreviousSongIndex() { return queueStore.previous({ manual: true }); }

// ================= 无缝播放：预加载下一首 =================
function preloadNextSong() { return playback.preloadNext(); }

// ================= 音质分级识别 =================
function getQualityBadge(url, bitrate, level) {
    if (QUALITY_DETAILS[level]) {
        const detail = qualityDetails(level);
        return { level, text: detail.name, className: detail.className };
    }
    if (!url) return null;

    const urlLower = url.toLowerCase();
    if (urlLower.includes('flac') || bitrate >= 900000) {
        return { level: 'lossless', text: '无损', className: 'quality-lossless' };
    }
    if (urlLower.includes('320') || bitrate >= 320000) {
        return { level: 'exhigh', text: '极高', className: 'quality-high' };
    }
    return { level: 'standard', text: '标准', className: 'quality-standard' };
}

function syncPlaybackQualityDisplay(level) {
    const source = musicService.sourceForSong(playback.state.currentSong);
    const imported = Boolean(playback.state.currentSong?.playbackSource);
    const isOffline = Boolean(playback.state.currentSong?.offline);
    const isBilibili = source.provider === 'bilibili';
    const levels = imported ? Object.keys(QUALITY_DETAILS) : isMusicChannel(source.provider) ? source.qualities
        : source.provider === 'gd' ? ['standard', 'exhigh', 'lossless', 'hires'] : Object.keys(QUALITY_DETAILS);
    const requestedLevel = supportedQuality(level);
    const resolvedLevel = !playback.state.currentSong && levels.length && !levels.includes(requestedLevel) ? levels.at(-1) : requestedLevel;
    const fixedQuality = !imported && isMusicChannel(source.provider) && !source.qualities.length;
    const detail = isOffline ? { name: '离线', className: 'quality-standard' } : fixedQuality ? { name: String(playback.state.currentSong?.format || '自动').toUpperCase(), className: 'quality-standard' } : isBilibili
        ? { name: 'AAC', className: 'quality-standard' }
        : qualityDetails(resolvedLevel);
    dom.qualityBadge.textContent = detail.name;
    dom.qualityBadge.className = `quality-badge ${detail.className}`;
    if (dom.mobileQualityBadge) {
        dom.mobileQualityBadge.textContent = detail.name;
        dom.mobileQualityBadge.className = `quality-badge ${detail.className}`;
    }
    if (dom.desktopPlaybackQualityLabel) dom.desktopPlaybackQualityLabel.textContent = detail.name;
    if (dom.desktopPlaybackQualityBtn) {
        dom.desktopPlaybackQualityBtn.setAttribute('aria-label', `播放音质：${detail.name}，点击选择`);
    }
    if (dom.mobilePlaybackQualityBtn) {
        dom.mobilePlaybackQualityBtn.setAttribute('aria-label', `播放音质：${detail.name}，点击选择`);
    }
    [dom.desktopPlaybackQualityBtn, dom.mobilePlaybackQualityBtn].filter(Boolean).forEach(button => {
        button.disabled = isOffline || isBilibili || fixedQuality;
        button.title = isOffline ? '正在播放此设备保存的音频' : fixedQuality ? '此渠道按实际返回音质播放' : isBilibili ? 'Bilibili 公开 AAC 音轨' : '选择播放音质';
        if (isOffline) button.setAttribute('aria-label', '离线播放 · 本地保存的音频');
        else if (isBilibili) button.setAttribute('aria-label', 'Bilibili 公开 AAC 音轨');
        else if (fixedQuality) button.setAttribute('aria-label', `播放音质：${detail.name}，此渠道不支持手动切换`);
    });
}

let compressorNode = null;

// ================= 虚拟滚动配置 =================
let renderedCount = 0;
const CHUNK_SIZE = 50;  // 每次渲染的数量
const ITEM_HEIGHT = 56; // 歌单项高度 (px)
let virtualScrollEnabled = true;

// 虚拟滚动状态
let vsState = {
    scrollTop: 0,
    startIndex: 0,
    endIndex: 0,
    itemHeight: 56,  // 每个歌曲项的高度
    bufferCount: 5   // 缓冲区大小
};

// 主题色系统已移除，使用纯白色/灰色调极简风格
const tempCanvas = document.createElement('canvas');
const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
let dom = {};
let desktopShell = null;
let chartsController = null;
let artistsController = null;
let videosController = null;
let mobileChartsOpener = null;
let mobileExploreView = 'discovery';
let musicWall = null;
let videoPreviewOpener = null;
let visualizer = null;

let animeProgressThumbs = [];
const downloadSession = createDownloadSession();
let downloadState = { song: null, opener: null, session: null };
let downloadQualitySelector = null;
let playbackQualitySelector = null;
let playbackQualityOpener = null;
let collectionDialogState = {
    collection: null,
    type: 'playlist',
    tracks: [],
    opener: null,
    version: 0,
};

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('[id]').forEach(el => dom[el.id] = el);
    dom.lyricsContainer = document.querySelector('.lyrics-container');
    dom.progressBarContainer = document.querySelector('.progress-bar-container');
    dom.playlistContainer = document.getElementById('playlistContainer');
    dom.playlistContent = document.getElementById('playlistContent');
    dom.uploadContainer = document.querySelector('.upload-container');
    // dom.playlistInfo = document.querySelector('.playlist-info');
    dom.albumArtWrapper = document.getElementById('albumArtWrapper');
    dom.html = document.documentElement;
    initThemeControls();
    if (androidPlayer) {
        initAndroidUpdates(dom); initPlayerAppearance(dom);
        artworkRecoveryUI = initArtworkRecovery({ root: dom.androidCoverRecovery, recovery: artworkResolver.recovery,
            async onApplied(song) {
                const current = playback.state.currentSong;
                if (!current || artworkChoiceKey(current) !== artworkChoiceKey(song)) return;
                refreshArtworkBindings();
                await artworkPresenter.show(current, { isCurrent: () => playback.state.currentSong === current });
            },
        });
    }
    initAnimeProgressThumbs();
    chartsController = createChartsController({
        onlineEnabled: () => navigator.onLine,
        onSearch: () => openMusicSearch(),
        onPlay: song => addChartSong(song, { playNow: true }),
        onAdd: song => addChartSong(song, { playNow: false }),
    });
    artistsController = createArtistsController({
        onlineEnabled: () => navigator.onLine,
        onSearch: () => openMusicSearch(),
        onPlay: song => addChartSong(song, {
            playNow: true,
            source: `artist-${artistsController?.current() || 'trending'}`,
        }),
        onAdd: song => addChartSong(song, {
            playNow: false,
            source: `artist-${artistsController?.current() || 'trending'}`,
        }),
    });
    videosController = createVideosController({
        onOpen: openVideoPreview,
    });
    desktopShell = initAppShell({
        elements: {
            shell: dom.desktopShell,
            immersive: dom.desktopLayout,
            playerBar: dom.desktopPlayerBar,
            immersiveControls: document.getElementById('immersiveControlsHost'),
            opener: dom.desktopMiniPlayer,
            closeButton: dom.desktopImmersiveClose,
            backButton: dom.desktopBackBtn,
            forwardButton: dom.desktopForwardBtn,
            inertTargets: [
                document.querySelector('.app-skip-link'),
                dom.desktopShell.querySelector('.app-sidebar'),
                dom.desktopShell.querySelector('.app-topbar'),
                dom.desktopLibraryView,
                dom.floatingPlaylistPanel,
            ],
            destinationButtons: Array.from(document.querySelectorAll('[data-shell-destination]')),
            navigationButtons: Array.from(document.querySelectorAll('.app-navigation [data-shell-destination]')),
            eventTarget: document,
            documentElement: document.documentElement,
        },
        actions: {
            library: () => {
                showDesktopMainView('discovery');
                syncContentRoute(null);
                dom.desktopLibraryView?.focus();
            },
            charts: () => {
                showDesktopMainView('charts');
                togglePlaylistPanel(false);
                syncContentRoute('charts');
                chartsController?.ensureLoaded();
                dom.desktopChartsView?.focus();
            },
            artists: () => {
                showDesktopMainView('artists');
                togglePlaylistPanel(false);
                syncContentRoute('artists');
                artistsController?.ensureLoaded();
                dom.desktopArtistsView?.focus();
            },
            videos: () => {
                showDesktopMainView('videos');
                togglePlaylistPanel(false);
                syncContentRoute('videos');
                videosController?.ensureLoaded();
                dom.desktopVideosView?.focus();
            },
            queue: () => {
                switchDesktopTab('playlist');
                togglePlaylistPanel(true);
            },
            search: () => {
                showDesktopMainView('search');
                togglePlaylistPanel(false);
                syncContentRoute(null);
                document.getElementById('searchInput')?.focus();
            },
            import: () => document.getElementById('playlistFile')?.click(),
            settings: openSettings,
        },
        onImmersiveChange: syncContinuousRendering,
    });
    restoreLastCover();
    playerExperience = createPlayerExperience({ document, audio,
        onSearch: () => openMusicSearch(),
        onDiscover: () => setMobileExploreOpen(true, { view: 'discovery' }),
        onImport: () => {
            document.getElementById('playlistFile').click();
            mobileUI?.switchSheetTab('playlist');
            mobileUI?.openSheet();
        },
        onNext: playNextSong,
        onChooseSource: openSettings,
        onResume: togglePlayPause,
        onChange: () => mobileUI?.syncBrowsePlayer(),
    });
    syncDesktopPlayerAvailability();
    const initialContentView = contentViewFromHash();
    if (androidPlayer) {
        // Browsing is the Android app's main screen; now playing expands above it.
        dom.mobileChartsSheet.setAttribute('role', 'region');
        dom.mobileChartsSheet.removeAttribute('aria-modal');
        dom.mobileLayout.append(dom.mobilePlaylistSheet);
        dom.mobilePlaylistSheet.inert = true;
        setMobileExploreOpen(true, { view: initialContentView || 'discovery', syncRoute: false });
    } else if (initialContentView) {
        if (isCompactLayout()) {
            setMobileExploreOpen(true, { view: initialContentView, syncRoute: false });
        } else {
            desktopShell.navigate(initialContentView === 'discovery' ? 'library' : initialContentView, { record: false });
        }
    } else {
        showDesktopMainView('discovery');
    }

    initDownloadControls();
    initDiscoveryTable();
    initEventListeners();
    bindLxSettings(musicService.lxSources);
    initSettingsUI();
    initMusicSourceControl();
    if (androidPlayer) playerSourceUI = createPlayerSource({ document, playback, musicService, toast:showToast });
    setupPlaylistIdLoader();  // 初始化歌单ID加载按钮
    let restoreStartupQueue = true;
    accountPanel = initAccountPanel({
        root: document.getElementById('accountPanel'), openSettings, closeSettings,
        persistGuestQueue: androidPlayer,
        persistSession: androidPlayer,
        refreshFavorites: () => discoveryTable?.refreshFavorites(),
        onSettings: keys => { if (keys.includes('cp_theme')) applyTheme(localStorage.getItem('cp_theme') || 'night', { persist: false }); },
        player: {
            queue: () => queue.playlist,
            progress: () => ({ song: playback.state.currentSong, position: audio.currentTime }),
            isPlaying: () => !audio.paused,
            suspend: () => {
                restoreStartupQueue = false;
                playback.stop(); playerSourceUI?.close(); playerSourceUI?.sync(); playerExperience?.reset(); syncPlaybackControls(false); syncDesktopPlayerAvailability();
                if (androidPlayer) setMobileExploreOpen(true);
                dom.songTitle.textContent = '请选择歌曲'; dom.artistName.textContent = '从歌单或搜索中开始播放';
                setLyricsStatus('播放音乐以查看歌词');
                if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
            },
            setQueue: songs => {
                restoreStartupQueue = false;
                queue.playlist = songs;
                queue.currentIndex = songs.findIndex(song => String(song.id) === String(playback.state.currentSong?.id) && song.provider === playback.state.currentSong?.provider);
                queueStore.resetOrder(); syncQueueAfterMutation();
            },
            resume: value => loadAndPlaySong(value.song.id, value.song, { position: value.position }),
        },
    });
    personalLibrary = initPersonalLibrary({ document, storage: localStorage, account: accountPanel, musicService, audio,
        getSong: () => playback.state.currentSong, getQueue: () => queue.playlist,
        onPlay: (song, options) => addDiscoverySong(song, options),
        onQueue: (songs, replace = false) => {
            if (replace) { queue.playlist = songs; queue.currentIndex = -1; queueStore.resetOrder(); syncQueueAfterMutation(); }
            else addChartSong(songs, { playNow: false, source: songs.source });
        },
        onCollection: (type, id) => discoveryHome.openCollection(type, id), onSearch: openMusicSearch, onSettings:openSettings,
        notify: showToast, refreshFavorites: () => discoveryTable?.refreshFavorites(),
    });
    if (androidPlayer) androidSettingsUI = createAndroidSettings({ document, musicService, account:accountPanel, library:personalLibrary, close:closeSettings, notify:showToast });
    for (const event of ['pause', 'seeked']) audio.addEventListener(event, () => accountPanel.checkpoint());
    // An optional cache or playlist request must not delay the login form.
    const startupQueue = queue.playlist;
    const startupQueueLength = startupQueue.length;
    const canRestoreStartupQueue = () => restoreStartupQueue && queue.playlist === startupQueue
        && startupQueue.length === startupQueueLength;
    void initDatabase()
        .then(() => loadDefaultPlaylist(canRestoreStartupQueue))
        .catch(error => console.warn('启动歌单恢复失败:', error));
    loadNewSongDiscovery();
    scheduleMusicCollections();
    const sharedQuery = new URL(location.href).searchParams.get('q');
    if (sharedQuery) setTimeout(() => openMusicSearch(sharedQuery.slice(0,120)), 150);
    visualizer = initVisualizer();
    syncContinuousRendering();
    // checkSystemTheme(); // Removed
    // enableGradientModeByDefault(); // Removed

    // [需求4] 检测移动端并显示设置内的按钮
    // initMobileSettingsButtons(); // Removed

    dom.volumeSlider.value = String(audio.volume);
    updateVolumeIcon(audio.muted ? 0 : audio.volume);
    updateDoraemonProgress(0, 0, 0);

    // ★ MediaSession API (锁屏控制)
    if ('mediaSession' in navigator) {
        const actionHandlers = [
            ['play', () => audio.play()],
            ['pause', () => audio.pause()],
            ['previoustrack', playPreviousSong],
            ['nexttrack', playNextSong],
            ['seekto', (details) => {
                if (details.fastSeek && 'fastSeek' in audio) {
                    audio.fastSeek(details.seekTime);
                    return;
                }
                audio.currentTime = details.seekTime;
                updatePlayerState();
            }]
        ];

        for (const [action, handler] of actionHandlers) {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (error) {
                console.warn(`The media session action "${action}" is not supported yet.`);
            }
        }
        console.log('🎛️ MediaSession 已启用 (Enhanced)');
    }

    // ★ PWA Service Worker 注册
    if ('serviceWorker' in navigator && !androidPlayer) {
        const hasActiveServiceWorker = Boolean(navigator.serviceWorker.controller);
        let isReloadingForUpdate = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hasActiveServiceWorker || isReloadingForUpdate) return;
            isReloadingForUpdate = true;
            window.location.reload();
        });

        navigator.serviceWorker.register('./sw.js', {
            updateViaCache: 'none'
        }).then(reg => {
            console.log('📱 Service Worker 已注册');
            return reg.update();
        }).catch(err => {
            console.warn('SW 注册失败:', err);
        });
    }

});

function showDesktopMainView(view) {
    const viewConfig = {
        discovery: {
            element: dom.desktopDiscoveryView,
            titleId: 'desktopLibraryTitle',
            title: '发现音乐',
            description: '浏览新歌并管理当前播放内容',
        },
        charts: {
            element: dom.desktopChartsView,
            titleId: 'desktopChartsPageTitle',
            title: '音乐排行榜',
            description: '追踪热歌、新歌与上升趋势',
        },
        artists: {
            element: dom.desktopArtistsView,
            titleId: 'desktopArtistsPageTitle',
            title: '歌手中心',
            description: '从实时榜单发现活跃音乐人',
        },
        videos: {
            element: dom.desktopVideosView,
            titleId: 'desktopVideosPageTitle',
            title: '视频中心',
            description: '浏览国内音乐视频、现场与经典影像',
        },
        search: {
            element: dom.desktopSearchView,
            titleId: 'desktopSearchPageTitle',
            title: '搜索音乐',
            description: '查找歌曲、歌手或歌曲 ID',
        },
    };
    const active = viewConfig[view] || viewConfig.discovery;
    Object.values(viewConfig).forEach(config => {
        if (!config.element) return;
        const hidden = config !== active;
        config.element.hidden = hidden;
        config.element.setAttribute('aria-hidden', String(hidden));
    });

    dom.desktopLibraryView?.setAttribute('aria-labelledby', active.titleId);
    if (dom.desktopTopbarTitle) {
        dom.desktopTopbarTitle.textContent = view === 'discovery' ? '音乐库' : active.title;
    }
    if (dom.desktopTopbarDescription) {
        dom.desktopTopbarDescription.textContent = active.description;
    }
    if (dom.desktopLibraryView) dom.desktopLibraryView.scrollTop = 0;
}

function contentViewFromHash() {
    const view = window.location.hash.replace(/^#/, '');
    return ['discovery', 'charts', 'artists', 'videos', ...(androidPlayer ? ['wall'] : [])].includes(view) ? view : null;
}

function syncContentRoute(view) {
    const nextView = ['discovery', 'charts', 'artists', 'videos', ...(androidPlayer ? ['wall'] : [])].includes(view) ? view : null;
    if (nextView) {
        const nextHash = `#${nextView}`;
        if (window.location.hash !== nextHash) {
            window.history.replaceState(
                { cplayerView: nextView },
                '',
                `${window.location.pathname}${window.location.search}${nextHash}`
            );
        }
        return;
    }
    if (contentViewFromHash()) {
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
    }
}

function setMobileExploreView(view, { syncRoute = true, resetScroll = true } = {}) {
    const nextView = ['discovery', 'charts', 'artists', 'videos', ...(androidPlayer ? ['wall'] : [])].includes(view) ? view : 'discovery';
    mobileExploreView = nextView;
    const labels = {
        discovery: [androidPlayer ? 'ZPlayer' : '发现音乐', '每日推荐与私人电台'],
        charts: ['音乐排行榜', '热歌、新歌与趋势'],
        artists: ['歌手中心', '实时榜单自动聚合'],
        videos: ['视频中心', '国内音乐视频与现场影像'],
        wall: ['音乐墙', '让封面带你遇见下一首'],
    };
    const panes = {
        discovery: dom.mobileExploreDiscoveryPane,
        charts: dom.mobileExploreChartsPane,
        artists: dom.mobileExploreArtistsPane,
        videos: dom.mobileExploreVideosPane,
        wall: dom.mobileExploreWallPane,
    };
    Object.entries(panes).forEach(([key, pane]) => {
        if (!pane) return;
        const hidden = key !== nextView;
        pane.hidden = hidden;
        pane.setAttribute('aria-hidden', String(hidden));
    });
    document.querySelectorAll('[data-mobile-explore]').forEach(tab => {
        const selected = tab.dataset.mobileExplore === nextView;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    if (dom.mobileChartsPageTitle) dom.mobileChartsPageTitle.textContent = labels[nextView][0];
    dom.mobileChartsPageTitle?.toggleAttribute('data-no-i18n', androidPlayer && nextView === 'discovery');
    dom.mobileChartsSheet.dataset.exploreView = nextView;
    if (dom.mobileExploreSubtitle) dom.mobileExploreSubtitle.textContent = labels[nextView][1];
    dom.mobileChartsSheet.classList.toggle('is-music-wall', nextView === 'wall');
    dom.mobileChartsSheet.querySelectorAll('.android-nav [data-android-action]').forEach(button => {
        const selected = button.dataset.androidAction === (nextView === 'wall' ? 'wall' : 'home');
        if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    musicWall?.setActive(nextView === 'wall' && dom.mobileChartsSheet.getAttribute('aria-hidden') === 'false');
    if (nextView === 'charts') chartsController?.ensureLoaded();
    if (nextView === 'artists') artistsController?.ensureLoaded();
    if (nextView === 'videos') videosController?.ensureLoaded();
    if (syncRoute) syncContentRoute(nextView);
    if (resetScroll) dom.mobileExploreContent?.scrollTo?.({ top: 0, behavior: 'auto' });
}

function setMobileExploreOpen(open, { view = mobileExploreView, syncRoute = true } = {}) {
    if (!dom.mobileChartsSheet || !dom.mobileChartsBtn) return;
    const isOpen = dom.mobileChartsSheet.getAttribute('aria-hidden') === 'false';
    if (open === isOpen) {
        if (open) setMobileExploreView(view, { syncRoute });
        return;
    }

    dom.mobileChartsSheet.classList.toggle('is-open', open);
    dom.mobileChartsSheet.setAttribute('aria-hidden', String(!open));
    dom.mobileChartsBtn.setAttribute('aria-expanded', String(open));
    dom.mobileMainView.inert = open;
    document.querySelector('.mobile-control-deck').inert = open;
    if (androidPlayer) {
        (open ? dom.mobileExploreTabs : dom.mobileMainView).before(dom.androidUpdateBanner);
        dom.mobileLayout.querySelector(':scope > header').inert = open;
        dom.mobileChartsSheet.inert = !open;
    }
    mobileUI?.syncBrowsePlayer();

    if (open) {
        mobileChartsOpener = document.activeElement;
        setMobileExploreView(view, { syncRoute, resetScroll: !androidPlayer || view !== mobileExploreView });
        requestAnimationFrame(() => {
            if (androidPlayer) {
                if (!document.querySelector('dialog[open]')) (view === 'wall' ? dom.mobileChartsSheet.querySelector('[data-android-action="wall"]') : dom.mobileExploreTabs.querySelector('[aria-selected="true"]'))?.focus({ preventScroll: true });
            } else dom.mobileChartsClose?.focus();
        });
    } else {
        musicWall?.setActive(false);
        const opener = mobileChartsOpener;
        mobileChartsOpener = null;
        if (androidPlayer) dom.androidCollapsePlayer.focus({ preventScroll: true });
        else if (opener?.isConnected) opener.focus();
        if (syncRoute) syncContentRoute(null);
    }
}

function openVideoPreview(video, opener) {
    if (!dom.videoPreviewDialog || !video) return;
    videoPreviewOpener = opener || document.activeElement;
    const poster = normalizeMediaUrl(video.poster, { baseUrl: window.location.href });
    const preview = normalizeMediaUrl(video.previewUrl, { baseUrl: window.location.href });
    let externalUrl = 'https://www.bilibili.com/';
    try {
        const candidate = new URL(video.externalUrl);
        if (candidate.protocol === 'https:' &&
            (candidate.hostname === 'bilibili.com' || candidate.hostname.endsWith('.bilibili.com'))) {
            externalUrl = candidate.href;
        }
    } catch (error) {
        console.warn('无效的视频来源链接:', error);
    }

    dom.videoPreviewTitle.textContent = video.name || '音乐视频';
    dom.videoPreviewMeta.textContent = [
        video.artist,
        video.genre,
        formatReleaseDate(video.releasedAt),
    ].filter(Boolean).join(' · ');
    dom.videoPreviewSource.textContent = preview
        ? `${video.provider || '哔哩哔哩'} · 可预览`
        : `${video.provider || '哔哩哔哩'} · 国内来源`;
    dom.videoPreviewOpen.href = externalUrl;
    dom.videoPreviewPoster.src = poster || './img/icon.png';
    dom.videoPreviewPoster.alt = `${video.name || '音乐视频'} 封面`;

    if (preview) {
        dom.videoPreviewPlayer.src = preview;
        dom.videoPreviewPlayer.poster = poster || '';
        dom.videoPreviewPlayer.hidden = false;
        dom.videoPreviewPoster.hidden = true;
    } else {
        dom.videoPreviewPlayer.pause();
        dom.videoPreviewPlayer.removeAttribute('src');
        dom.videoPreviewPlayer.load();
        dom.videoPreviewPlayer.hidden = true;
        dom.videoPreviewPoster.hidden = false;
    }
    if (!dom.videoPreviewDialog.open) dom.videoPreviewDialog.showModal();
}

function closeVideoPreview() {
    if (dom.videoPreviewDialog?.open) dom.videoPreviewDialog.close();
}

function resetVideoPreview() {
    dom.videoPreviewPlayer?.pause();
    dom.videoPreviewPlayer?.removeAttribute('src');
    dom.videoPreviewPlayer?.load();
    if (dom.videoPreviewPlayer) dom.videoPreviewPlayer.hidden = true;
    if (dom.videoPreviewPoster) dom.videoPreviewPoster.hidden = false;
    const opener = videoPreviewOpener;
    videoPreviewOpener = null;
    if (opener?.isConnected) opener.focus();
}

function readSavedQuality(key, fallback = DEFAULT_QUALITY) {
    try {
        return supportedQuality(localStorage.getItem(key), fallback);
    } catch (error) {
        console.warn('无法读取音质偏好:', error);
        return fallback;
    }
}

function createQualityOption({ level }) {
    const detail = qualityDetails(level);
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'liquid-quality-option';
    option.dataset.quality = level;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.tabIndex = -1;

    const copy = document.createElement('span');
    copy.className = 'liquid-quality-option-copy';
    const name = document.createElement('span');
    name.className = 'liquid-quality-option-name';
    name.textContent = detail.name;
    const meta = document.createElement('span');
    meta.className = 'liquid-quality-option-meta';
    meta.textContent = detail.meta;
    copy.append(name, meta);

    const check = document.createElement('span');
    check.className = 'liquid-quality-check';
    check.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('i');
    icon.className = 'fas fa-check';
    check.append(icon);
    option.append(copy, check);
    return option;
}

function createQualitySelector({ picker, trigger, list, valueInput, valueLabel, initialValue, onSelect }) {
    const options = DOWNLOAD_QUALITY_OPTIONS.map(createQualityOption);
    list.replaceChildren(...options);

    const selectedOption = () => options.find(option => option.getAttribute('aria-selected') === 'true');

    function setValue(level, { notify = false } = {}) {
        const nextLevel = supportedQuality(level);
        valueInput.value = nextLevel;
        options.forEach(option => {
            const selected = option.dataset.quality === nextLevel;
            option.setAttribute('aria-selected', String(selected));
            option.tabIndex = selected ? 0 : -1;
        });
        if (valueLabel) valueLabel.textContent = qualityDetails(nextLevel).summary;
        if (notify) onSelect?.(nextLevel);
        return nextLevel;
    }

    function setOpen(open, { focusSelected = false } = {}) {
        if (!trigger || !picker) return;
        picker.classList.toggle('is-open', open);
        trigger.setAttribute('aria-expanded', String(open));
        if (open && focusSelected) selectedOption()?.focus();
    }

    options.forEach(option => {
        option.addEventListener('click', () => {
            setValue(option.dataset.quality, { notify: true });
            if (trigger) {
                setOpen(false);
                trigger.focus();
            }
        });
    });

    list.addEventListener('keydown', event => {
        const option = event.target.closest?.('.liquid-quality-option');
        if (!option) return;
        const visibleOptions = options.filter(item => !item.hidden);
        const currentIndex = visibleOptions.indexOf(option);
        const targets = {
            ArrowDown: Math.min(currentIndex + 1, visibleOptions.length - 1),
            ArrowUp: Math.max(currentIndex - 1, 0),
            Home: 0,
            End: visibleOptions.length - 1,
        };
        if (event.key in targets) {
            event.preventDefault();
            visibleOptions[targets[event.key]].focus();
        } else if (event.key === 'Escape' && trigger) {
            event.preventDefault();
            setOpen(false);
            trigger.focus();
        }
    });

    if (trigger) {
        trigger.addEventListener('click', () => {
            setOpen(trigger.getAttribute('aria-expanded') !== 'true');
        });
        trigger.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            setOpen(true, { focusSelected: true });
        });
        document.addEventListener('pointerdown', event => {
            if (!picker.contains(event.target)) setOpen(false);
        });
    }

    setValue(initialValue);
    return {
        setValue,
        setOpen,
        focusSelected: () => selectedOption()?.focus(),
    };
}

function initDownloadControls() {
    const savedDownloadQuality = readSavedQuality('cp_download_quality', 'jymaster');
    downloadQualitySelector = createQualitySelector({
        picker: dom.downloadQualityPicker,
        trigger: dom.downloadQualityTrigger,
        list: dom.downloadQualityList,
        valueInput: dom.downloadQuality,
        valueLabel: dom.downloadQualityValue,
        initialValue: savedDownloadQuality,
        onSelect: level => saveDownloadQuality(level),
    });

    const savedPlaybackQuality = supportedQuality(musicService.config.quality);
    playbackQualitySelector = createQualitySelector({
        list: dom.playbackQualityList,
        valueInput: dom.playbackQuality,
        initialValue: savedPlaybackQuality,
        onSelect: level => applyPlaybackQuality(level),
    });
    syncPlaybackQualityDisplay(savedPlaybackQuality);
}

function saveDownloadQuality(level) {
    try {
        localStorage.setItem('cp_download_quality', level);
    } catch (error) {
        console.warn('无法保存下载音质偏好:', error);
    }
}

function openPlaybackQualityDialog(opener) {
    if (playback.state.currentSong?.offline) return showToast('正在播放本地保存的音频');
    playbackQualityOpener = opener;
    const source = musicService.sourceForSong(playback.state.currentSong);
    const imported = Boolean(playback.state.currentSong?.playbackSource);
    const isGd = !imported && source.provider === 'gd';
    const levels = !imported && isMusicChannel(source.provider) ? source.qualities : isGd ? ['standard', 'exhigh', 'lossless', 'hires'] : Object.keys(QUALITY_DETAILS);
    if (!levels.length) return showToast('此渠道按实际返回音质播放');
    dom.playbackQualityList.querySelectorAll('[data-quality]').forEach(option => { option.hidden = !levels.includes(option.dataset.quality); });
    const selectedLevel = supportedQuality(playback.state.currentSong?.level, DEFAULT_QUALITY);
    playbackQualitySelector.setValue(levels.includes(selectedLevel) ? selectedLevel : levels.at(-1));
    dom.playbackQualityStatus.textContent = playback.state.currentSong?.id
        ? '每首歌优先尝试无损音质，不可用时自动降级或换源。本次选择保留进度，下一首仍优先无损。'
        : '每首歌优先尝试无损音质，不可用时自动降级或换源；开始播放后可手动切换。';
    if (isGd) dom.playbackQualityStatus.textContent += ' GD 最高为 Hi-Res，实际音质以返回结果为准。';
    if (!dom.playbackQualityDialog.open) dom.playbackQualityDialog.showModal();
    requestAnimationFrame(() => playbackQualitySelector.focusSelected());
}

async function applyPlaybackQuality(level) {
    if (playback.state.currentSong?.provider === 'bilibili') return;
    const requestedLevel = supportedQuality(level);
    if (playback.state.quality.songLoading) {
        playbackQualitySelector.setValue(supportedQuality(playback.state.currentSong?.level, DEFAULT_QUALITY));
        dom.playbackQualityStatus.textContent = '歌曲加载中，请稍后切换音质；新歌曲默认优先无损。';
        return;
    }

    if (!playback.state.currentSong?.id) {
        playbackQualitySelector.setValue(DEFAULT_QUALITY);
        dom.playbackQualityStatus.textContent = '请先播放歌曲，再切换当前歌曲的音质；新歌曲默认优先无损。';
        return;
    }

    playbackQualitySelector.setValue(requestedLevel);
    return playback.changeQuality(requestedLevel, {
        replaceAudioSource: typeof replaceAudioSource === 'function' ? replaceAudioSource : undefined,
        onStart() {
            dom.playbackQualityDialog.setAttribute('aria-busy', 'true');
            dom.playbackQualityStatus.textContent = `正在匹配${qualityDetails(requestedLevel).name}音源…`;
        },
        onSuccess(data) {
            const resolvedLevel = supportedQuality(data.level, requestedLevel);
            playbackQualitySelector.setValue(resolvedLevel);
            syncPlaybackQualityDisplay(resolvedLevel);
            dom.playbackQualityStatus.textContent = resolvedLevel === requestedLevel
                ? `已切换为${qualityDetails(resolvedLevel).name}，播放进度已保留。`
                : `${qualityDetails(requestedLevel).name}不可用，已自动切换为${qualityDetails(resolvedLevel).name}。`;
        },
        onError(error) {
            console.error('切换播放音质失败:', error);
            dom.playbackQualityStatus.textContent = '切换失败，已尝试恢复原音源，请稍后重试。';
        },
        onSettled() { dom.playbackQualityDialog.removeAttribute('aria-busy'); },
    });
}

function openDownloadDialog(song, opener) {
    if (!song?.id) return showToast('当前歌曲无法下载', true);
    if (isMusicChannel(musicService.sourceForSong(song).provider)) return showToast('此渠道当前仅提供在线播放', true);
    if (musicService.sourceForSong(song).provider === 'gd') return showToast('GD 音乐台仅提供在线播放', true);
    const session = downloadSession.open();
    downloadState.controller?.abort();
    downloadState = { song, opener, session, controller: null };
    const isBilibili = Boolean(bilibiliVideoUrl(song));
    dom.downloadQualityPicker.hidden = isBilibili;
    dom.downloadBilibiliFormat.hidden = !isBilibili;
    dom.downloadDialogTitle.textContent = isBilibili ? '下载 Bilibili 音频' : '下载歌曲';
    dom.downloadSongName.textContent = (song.name || '未知歌曲') + ' · ' + (song.artist || '未知艺术家');
    dom.downloadBackdropArt.referrerPolicy = 'no-referrer';
    dom.downloadBackdropArt.src = persistentCoverUrl(song.cover) || './img/icon.png';
    dom.downloadStatus.textContent = isBilibili ? '仅下载当前视频已开放的音轨。' : '若当前音质不可用，将自动逐级降档。';
    dom.downloadConfirm.disabled = false;
    dom.downloadCancel.disabled = false;
    downloadQualitySelector.setOpen(false);
    if (!dom.downloadDialog.open) dom.downloadDialog.showModal();
}

async function downloadSelectedSong() {
    const song = downloadState.song;
    const session = downloadState.session;
    if (!song?.id || !downloadSession.start(session)) return;
    if (musicService.sourceForSong(song).provider === 'gd') {
        downloadSession.finish(session);
        dom.downloadStatus.textContent = 'GD 音乐台仅提供在线播放';
        return;
    }
    const level = dom.downloadQuality.value;
    const isBilibili = Boolean(bilibiliVideoUrl(song));
    if (!isBilibili) saveDownloadQuality(level);
    const controller = new AbortController();
    downloadState.controller = controller;
    dom.downloadConfirm.disabled = true;
    dom.downloadCancel.disabled = !isBilibili;
    dom.downloadStatus.textContent = '正在解析下载地址...';
    try {
        if (isBilibili) {
            const url = new URL(`/api/v1/bilibili/download?id=${encodeURIComponent(song.id)}`, window.location.href).href;
            dom.downloadStatus.textContent = '正在读取音轨...';
            await saveAudioBlob({ url, filename: downloadFilename({ ...song, provider: 'bilibili', url }, 'standard'), signal: controller.signal });
            if (!downloadSession.isCurrent(session)) return;
            dom.downloadDialog.close();
            showToast('已下载 Bilibili 音轨 · M4A');
            return;
        }
        const resolved = await resolveDownloadSong({
            id: song.id,
            level,
            baseUrl: window.location.href,
            requestSong: (id, candidate) => musicService.getSongAtLevel(id, candidate, { song }),
        });
        if (!downloadSession.isCurrent(session)) return;
        dom.downloadStatus.textContent = '正在准备文件...';
        await saveAudioBlob({
            url: resolved.url,
            filename: downloadFilename({ ...song, url: resolved.url }, resolved.resolvedLevel)
        });
        if (!downloadSession.isCurrent(session)) return;
        dom.downloadDialog.close();
        showToast('已开始下载：' + qualityDetails(resolved.resolvedLevel).name);
    } catch (error) {
        if (controller.signal.aborted) return;
        if (!downloadSession.isCurrent(session)) return;
        console.error('歌曲下载失败:', error);
        dom.downloadStatus.textContent = isBilibili
            ? error.status === 403 ? '该视频未开放匿名下载，请在 Bilibili 查看。'
                : error.status === 429 ? 'Bilibili 请求频繁，请稍后重试。' : '音频下载失败，请稍后重试。'
            : '下载失败：浏览器或网络阻止了音频文件读取';
    } finally {
        if (downloadSession.finish(session)) {
            dom.downloadConfirm.disabled = false;
            dom.downloadCancel.disabled = false;
        }
    }
}

function initAnimeProgressThumbs() {
    if (typeof AnimeProgressThumb !== 'function') return;

    const progressProvider = () => {
        return getPlaybackProgressState(audio.currentTime, audio.duration);
    };

    animeProgressThumbs = [
        new AnimeProgressThumb({
            root: dom.doraemonThumb,
            container: dom.desktopProgressBarContainer,
            track: dom.desktopProgressBarContainer?.querySelector('.progress-track'),
            assetSrc: AnimeProgressThumb.DEFAULT_ASSET_PATH,
            progressProvider,
        }),
        new AnimeProgressThumb({
            root: dom.mobileDoraemonThumb,
            container: dom.mobileProgressBarContainer,
            track: dom.mobileProgressBarContainer?.querySelector('.mobile-progress-track'),
            assetSrc: AnimeProgressThumb.DEFAULT_ASSET_PATH,
            progressProvider,
        }),
    ].filter(component => component.root && component.track);
}

function updateDoraemonProgress(progressPercent, currentTime = 0, duration = 0) {
    const safePercent = Math.max(0, Math.min(100, Number(progressPercent) || 0));
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const safeCurrentTime = safeDuration && Number.isFinite(currentTime)
        ? Math.max(0, Math.min(currentTime, safeDuration))
        : 0;
    animeProgressThumbs.forEach(component => {
        component.setProgress(safePercent, safeCurrentTime, safeDuration);
    });

    [dom.desktopProgressBarContainer, dom.mobileProgressBarContainer].forEach(container => {
        if (container) {
            container.setAttribute('aria-valuenow', String(Math.round(safePercent)));
            container.setAttribute('aria-valuetext', `${formatTime(safeCurrentTime)} / ${formatTime(safeDuration)}`);
        }
    });
}

function getPlaybackProgressState(currentTime = 0, duration = 0) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const safeCurrentTime = safeDuration && Number.isFinite(currentTime)
        ? Math.max(0, Math.min(currentTime, safeDuration))
        : 0;
    const progress = safeDuration
        ? Math.max(0, Math.min(100, (safeCurrentTime / safeDuration) * 100))
        : 0;

    return { currentTime: safeCurrentTime, duration: safeDuration, progress };
}

function updateBufferedProgress() {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    let bufferedEnd = 0;

    if (duration && audio.buffered) {
        for (let index = 0; index < audio.buffered.length; index += 1) {
            bufferedEnd = Math.max(bufferedEnd, audio.buffered.end(index));
        }
    }

    const bufferedRatio = duration ? Math.max(0, Math.min(1, bufferedEnd / duration)) : 0;
    [dom.progressBuffer, dom.mobileProgressBuffer].forEach(buffer => {
        if (buffer) buffer.style.transform = `scaleX(${bufferedRatio})`;
    });
}

function resetBufferedProgress() {
    [dom.progressBuffer, dom.mobileProgressBuffer].forEach(buffer => {
        if (buffer) buffer.style.transform = 'scaleX(0)';
    });
}

function seekToProgress(progress) {
    const state = getPlaybackProgressState(audio.currentTime, audio.duration);
    if (!state.duration) return;
    const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
    audio.currentTime = normalized * state.duration;
    updatePlayerState();
}

function bindProgressScrubber(container) {
    if (!container || container.dataset.progressBound === 'true') return;
    container.dataset.progressBound = 'true';
    let activePointerId = null;

    const seekFromClientX = (clientX) => {
        const track = container.querySelector('.progress-track, .mobile-progress-track');
        const rect = (track || container).getBoundingClientRect();
        if (!rect.width) return;
        seekToProgress((clientX - rect.left) / rect.width);
    };

    const finishDragging = (event) => {
        if (activePointerId === null || (event && event.pointerId !== activePointerId)) return;
        if (container.hasPointerCapture?.(activePointerId)) {
            container.releasePointerCapture(activePointerId);
        }
        activePointerId = null;
        container.classList.remove('is-dragging');
        container.animeProgressThumb?.setDragging(false);
    };

    container.addEventListener('pointerdown', (event) => {
        if (container.getAttribute('aria-disabled') === 'true') return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        activePointerId = event.pointerId;
        container.setPointerCapture?.(event.pointerId);
        container.classList.add('is-dragging');
        container.animeProgressThumb?.setDragging(true);
        container.focus({ preventScroll: true });
        seekFromClientX(event.clientX);
        event.preventDefault();
    });

    container.addEventListener('pointermove', (event) => {
        if (event.pointerId !== activePointerId) return;
        seekFromClientX(event.clientX);
        event.preventDefault();
    });

    container.addEventListener('pointerup', finishDragging);
    container.addEventListener('pointercancel', finishDragging);

    container.addEventListener('keydown', (event) => {
        if (container.getAttribute('aria-disabled') === 'true') return;
        const state = getPlaybackProgressState(audio.currentTime, audio.duration);
        if (!state.duration) return;
        const step = event.shiftKey ? 10 : 5;
        let nextTime = null;

        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextTime = state.currentTime - step;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextTime = state.currentTime + step;
        if (event.key === 'Home') nextTime = 0;
        if (event.key === 'End') nextTime = state.duration;
        if (nextTime === null) return;

        event.preventDefault();
        seekToProgress(nextTime / state.duration);
    });
}

function initEventListeners() {
    if (androidPlayer) {
        dom.androidCollapsePlayer.addEventListener('click', () => setMobileExploreOpen(true));
        const actions = {
            home: () => setMobileExploreView('discovery'),
            wall: () => setMobileExploreView('wall'),
            search: () => openMusicSearch(),
            theme: () => dom.mobileThemeBtn.click(),
            settings: openSettings,
        };
        dom.mobileChartsSheet.querySelectorAll('[data-android-action]').forEach(button => {
            button.addEventListener('click', actions[button.dataset.androidAction]);
        });
        window.cplayerAndroidBack = handleAndroidBack;
    }
    dom.searchButton.addEventListener('click', () => searchSongs(dom.searchInput.value));
    dom.searchInput.addEventListener('keypress', (e) => e.key === 'Enter' && searchSongs(dom.searchInput.value));
    dom.desktopDiscoveryRefresh?.addEventListener('click', loadNewSongDiscovery);
    dom.mobileChartsBtn?.addEventListener('click', () => {
        setMobileExploreOpen(true, { view: contentViewFromHash() || mobileExploreView });
    });
    dom.mobileChartsClose?.addEventListener('click', () => setMobileExploreOpen(false));
    dom.mobileExploreTabs?.addEventListener('click', event => {
        const tab = event.target.closest('[data-mobile-explore]');
        if (tab) setMobileExploreView(tab.dataset.mobileExplore);
    });
    dom.mobileExploreTabs?.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(dom.mobileExploreTabs.querySelectorAll('[data-mobile-explore]'));
        const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
        let nextIndex = currentIndex;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        event.preventDefault();
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
    });
    document.addEventListener('keydown', event => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape' && !activeDialog() && androidPlayer) {
            if (handleAndroidBack()) event.preventDefault();
        } else if (!androidPlayer && event.key === 'Escape' && !document.querySelector('dialog[open]') && dom.mobileChartsSheet?.getAttribute('aria-hidden') === 'false') {
            event.preventDefault();
            setMobileExploreOpen(false);
        }
    });
    window.addEventListener('hashchange', () => {
        const view = contentViewFromHash();
        if (isCompactLayout()) {
            setMobileExploreOpen(Boolean(view) || (androidPlayer && !playerExperience?.song), { view: view || mobileExploreView, syncRoute: false });
        } else if (view) {
            desktopShell?.navigate(view === 'discovery' ? 'library' : view);
        }
    });
    dom.videoPreviewClose?.addEventListener('click', closeVideoPreview);
    dom.videoPreviewDismiss?.addEventListener('click', closeVideoPreview);
    dom.videoPreviewDialog?.addEventListener('close', resetVideoPreview);
    dom.desktopDownloadBtn.addEventListener('click', () => {
        openDownloadDialog(playback.state.currentSong, dom.desktopDownloadBtn);
    });
    dom.desktopPlaybackQualityBtn.addEventListener('click', () => {
        openPlaybackQualityDialog(dom.desktopPlaybackQualityBtn);
    });
    dom.mobilePlaybackQualityBtn.addEventListener('click', () => {
        openPlaybackQualityDialog(dom.mobilePlaybackQualityBtn);
    });
    dom.collectionDialogClose.addEventListener('click', () => dom.collectionDialog.close('close'));
    dom.collectionPlayAll.addEventListener('click', () => runCollectionDialogAction(true));
    dom.collectionAddAll.addEventListener('click', () => runCollectionDialogAction(false));
    dom.collectionDialog.addEventListener('close', () => {
        const opener = collectionDialogState.opener;
        const nextVersion = collectionDialogState.version + 1;
        collectionDialogState = {
            collection: null,
            type: 'playlist',
            tracks: [],
            opener: null,
            version: nextVersion,
        };
        if (opener?.isConnected) opener.focus();
    });
    dom.downloadConfirm.addEventListener('click', downloadSelectedSong);
    dom.mobileDownloadBtn.addEventListener('click', () => openDownloadDialog(playback.state.currentSong, dom.mobileDownloadBtn));
    dom.downloadDialog.addEventListener('cancel', event => {
        if (downloadSession.isPending(downloadState.session) && !bilibiliVideoUrl(downloadState.song)) event.preventDefault();
    });
    dom.downloadDialog.addEventListener('close', () => {
        downloadState.controller?.abort();
        downloadQualitySelector.setOpen(false);
        const { opener, session } = downloadState;
        if (!downloadSession.isCurrent(session)) return;
        downloadState = { song: null, opener: null, session: null };
        if (opener?.isConnected) opener.focus();
    });
    dom.playbackQualityDialog.addEventListener('close', () => {
        const opener = playbackQualityOpener;
        playbackQualityOpener = null;
        if (opener?.isConnected) opener.focus();
    });

    // Desktop Tab Switching
    const desktopTabPlaylist = document.getElementById('desktopTabPlaylist');
    const desktopTabSearch = document.getElementById('desktopTabSearch');
    if (desktopTabPlaylist) {
        desktopTabPlaylist.addEventListener('click', () => switchDesktopTab('playlist'));
    }
    if (desktopTabSearch) {
        desktopTabSearch.addEventListener('click', () => switchDesktopTab('search'));
    }
    dom.clearPlaylistBtn?.addEventListener('click', clearPlaylist);
    dom.mobileClearPlaylistBtn?.addEventListener('click', clearPlaylist);

    dom.playPauseBtn.addEventListener('click', togglePlayPause);
    dom.prevBtn.addEventListener('click', playPreviousSong);
    dom.nextBtn.addEventListener('click', playNextSong);
    dom.playModeBtn.addEventListener('click', togglePlayMode);
    syncPlayModeUI();
    window.addEventListener('cplayer:locale', syncPlayModeUI);

    [dom.desktopProgressBarContainer, dom.mobileProgressBarContainer]
        .forEach(bindProgressScrubber);

    audio.addEventListener('timeupdate', updatePlayerState);
    audio.addEventListener('progress', updateBufferedProgress);
    audio.addEventListener('durationchange', updateBufferedProgress);
    audio.addEventListener('emptied', resetBufferedProgress);
    audio.addEventListener('play', onPlayStart);
    audio.addEventListener('pause', onPlayPause);
    audio.addEventListener('ended', handleSongEnd);
    audio.addEventListener('loadedmetadata', () => {
        updatePlayerState();
        updateBufferedProgress();
    });

    dom.volumeSlider.addEventListener('input', (e) => {
        audio.volume = e.target.value;
        audio.muted = false;
        updateVolumeIcon(audio.volume);
    });

    dom.volumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const popover = document.getElementById('volumePopover');
        if (popover.classList.contains('show')) {
            audio.muted = !audio.muted;
            updateVolumeIcon(audio.muted ? 0 : audio.volume);
        } else {
            popover.classList.add('show');
        }
    });

    document.addEventListener('click', (e) => {
        const popover = document.getElementById('volumePopover');
        const btn = document.getElementById('volumeBtn');
        if (popover && !popover.contains(e.target) && !btn.contains(e.target)) {
            popover.classList.remove('show');
        }

        // Close unified Sidebar
        const playlistPanel = document.getElementById('floatingPlaylistPanel');
        const queueTrigger = e.target.closest?.('[data-shell-destination="queue"]');
        const historyTrigger = e.target.closest?.('#desktopBackBtn, #desktopForwardBtn');
        const queueHistoryDestination = historyTrigger
            && document.querySelector('[data-shell-destination="queue"][aria-current="page"]');
        if (playlistPanel && !playlistPanel.classList.contains('translate-x-full') &&
            !playlistPanel.contains(e.target) && !queueTrigger && !queueHistoryDestination) {
            togglePlaylistPanel(false);
        }
    });

    dom.playlistFile.addEventListener('change', handlePlaylistUpload);
    dom.uploadContainer.addEventListener('click', (e) => {
        if (e.target === dom.playlistFile || e.target.closest?.('[data-shell-destination="import"]')) return;
        if (e.target.tagName !== "LABEL") dom.playlistFile.click();
    });
    dom.uploadContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.uploadContainer.style.transform = "scale(1.02)";
    });
    dom.uploadContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.uploadContainer.style.transform = "scale(1)";
        if (e.dataTransfer.files[0]) handlePlaylistFile(e.dataTransfer.files[0]);
    });
    dom.uploadContainer.addEventListener('dragleave', () => {
        dom.uploadContainer.style.transform = "scale(1)";
    });

    // 滚动事件由 setupVirtualScroll 中的 onscroll 处理

    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullScreen);

    // 移动端设置按钮
    const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
    if (mobileSettingsBtn) {
        mobileSettingsBtn.onclick = (e) => {
            e.stopPropagation();
            openSettings();
        };
    }

    dom.closeSettingsBtn.addEventListener('click', closeSettings);
    dom.settingsModal.addEventListener('click', (e) => {
        if (e.target === dom.settingsModal) closeSettings();
    });


    // Copy Interactions
    setupCopyInteraction('songTitle', () => dom.songTitle.textContent);
    setupCopyInteraction('artistName', () => dom.artistName.textContent);
    setupCopyInteraction('songIdTag', () => dom.songIdTag.textContent.replace('ID: ', ''));

    // Mobile Copy Interactions
    setupCopyInteraction('mobileTitle', () => dom.songTitle.textContent);
    setupCopyInteraction('mobileArtist', () => dom.artistName.textContent);
    setupCopyInteraction('mobileSongIdTag', () => dom.songIdTag.textContent.replace('ID: ', ''));

    // [需求4] 手机端设置按钮逻辑
    const settingsFullscreenBtn = document.getElementById('settingsFullscreenBtn');
    if (settingsFullscreenBtn) {
        settingsFullscreenBtn.onclick = () => {
            toggleFullScreen();
        };
    }

    const mobileSettingsButtons = document.getElementById('mobileSettingsButtons');
    const updateMobileButtonsVisibility = () => {
        const isMobile = isCompactLayout();
        if (mobileSettingsButtons) {
            if (isMobile) {
                mobileSettingsButtons.classList.remove('hidden');
            } else {
                mobileSettingsButtons.classList.add('hidden');
            }
        }
    };
    updateMobileButtonsVisibility();
    window.addEventListener('resize', updateMobileButtonsVisibility);
}

function toggleSearchPanel(forceState) {
    // Now just opens the sidebar and switches to search tab
    const shouldOpen = forceState !== undefined ? forceState : true;
    if (shouldOpen) {
        togglePlaylistPanel(true);
        switchDesktopTab('search');
        setTimeout(() => document.getElementById('searchInput')?.focus(), 200);
    } else {
        // no-op, closing is handled by togglePlaylistPanel
    }
}

function togglePlaylistPanel(forceState) {
    const panel = document.getElementById('floatingPlaylistPanel');
    const isOpen = !panel.classList.contains('translate-x-full');
    const shouldOpen = forceState !== undefined ? forceState : !isOpen;

    if (shouldOpen) {
        panel.classList.remove('translate-x-full');
        // 自动定位到正在播放的歌曲
        setTimeout(() => {
            if (desktopActiveTab === 'playlist' && queue.currentIndex !== -1) {
                highlightCurrentSong();
            }
        }, 300);
    } else {
        panel.classList.add('translate-x-full');
    }
}

// Desktop sidebar tab switching (mirroring mobile UX)
let desktopActiveTab = 'playlist';
function switchDesktopTab(tab) {
    desktopActiveTab = tab;
    const isPlaylist = tab === 'playlist';

    const tabPlaylist = document.getElementById('desktopTabPlaylist');
    const tabSearch = document.getElementById('desktopTabSearch');
    const contentPlaylist = document.getElementById('desktopContentPlaylist');
    const contentSearch = document.getElementById('desktopContentSearch');

    if (tabPlaylist) {
        tabPlaylist.setAttribute('aria-selected', String(isPlaylist));
        tabPlaylist.classList.toggle('opacity-100', isPlaylist);
        tabPlaylist.classList.toggle('opacity-50', !isPlaylist);
        tabPlaylist.classList.toggle('border-primary-color', isPlaylist);
        tabPlaylist.classList.toggle('border-transparent', !isPlaylist);
    }
    if (tabSearch) {
        tabSearch.setAttribute('aria-selected', String(!isPlaylist));
        tabSearch.classList.toggle('opacity-100', !isPlaylist);
        tabSearch.classList.toggle('opacity-50', isPlaylist);
        tabSearch.classList.toggle('border-primary-color', !isPlaylist);
        tabSearch.classList.toggle('border-transparent', isPlaylist);
    }
    if (contentPlaylist) {
        contentPlaylist.classList.toggle('hidden', !isPlaylist);
        contentPlaylist.classList.toggle('flex', isPlaylist);
    }
    if (contentSearch) {
        contentSearch.classList.toggle('hidden', isPlaylist);
        contentSearch.classList.toggle('flex', !isPlaylist);
    }

    // Auto-focus search input
    if (!isPlaylist) {
        setTimeout(() => document.getElementById('searchInput')?.focus(), 100);
    }
}

// ================= Copy Interaction Logic =================
function setupCopyInteraction(elementId, getContentFn) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const handleCopy = (e) => {
        e.preventDefault(); // Stop default context menu
        const text = getContentFn();
        if (!text) return;

        // Clipboard API Hack for iFrame
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showToast(`已复制: ${text}`);
        } catch (err) {
            console.error('Copy failed', err);
            showToast('复制失败', true);
        }
        document.body.removeChild(textArea);
    };

    // Desktop Right Click
    el.addEventListener('contextmenu', handleCopy);

    // Mobile Long Press Logic
    let pressTimer;
    el.addEventListener('touchstart', (e) => {
        // e.preventDefault(); // Optional: might block scrolling if not careful
        pressTimer = setTimeout(() => {
            handleCopy(e);
        }, 600); // 600ms long press
    }, { passive: false });

    el.addEventListener('touchend', () => clearTimeout(pressTimer));
    el.addEventListener('touchmove', () => clearTimeout(pressTimer));
}

let toastHideTimer = null;

function hideToast() {
    const toast = document.getElementById('copyToast');
    if (!toast) return;
    toast.classList.add('opacity-0', 'scale-90');
    toast.classList.remove('opacity-100', 'scale-100', 'has-action');
    const actionButton = document.getElementById('toastActionBtn');
    if (actionButton) {
        actionButton.classList.add('hidden');
        actionButton.onclick = null;
    }
}

function showToast(msg, isError = false, {
    actionLabel = '',
    onAction = null,
    duration = 2600,
} = {}) {
    const toast = document.getElementById('copyToast');
    if (!toast) return;
    window.clearTimeout(toastHideTimer);
    toast.querySelector('span').textContent = msg;
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.classList.remove('opacity-0', 'scale-90');
    toast.classList.add('opacity-100', 'scale-100');

    const icon = toast.querySelector('i');
    if (isError) {
        icon.className = "fas fa-times-circle text-red-500";
    } else {
        icon.className = "fas fa-check-circle text-primary-color";
    }

    const actionButton = document.getElementById('toastActionBtn');
    if (actionButton) {
        actionButton.onclick = null;
        if (actionLabel && typeof onAction === 'function') {
            actionButton.textContent = actionLabel;
            actionButton.classList.remove('hidden');
            toast.classList.add('has-action');
            actionButton.onclick = () => {
                hideToast();
                onAction();
            };
        } else {
            actionButton.classList.add('hidden');
            toast.classList.remove('has-action');
        }
    }

    toastHideTimer = window.setTimeout(hideToast, duration);
}

function applyTheme(theme, { persist = true, announce = false } = {}) {
    const nextTheme = theme === 'light' ? 'light' : 'night';
    const isNight = nextTheme === 'night';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = isNight ? 'dark' : 'light';

    if (persist) {
        try {
            localStorage.setItem('cp_theme', nextTheme);
        } catch (error) {
            console.warn('Theme preference could not be saved:', error);
        }
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', isNight ? '#151517' : '#fafafa');
    document.querySelectorAll('[data-android-theme]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.androidTheme === nextTheme));
    });
    document.querySelectorAll('[data-android-action="theme"]').forEach(button => {
        button.setAttribute('aria-label', isNight ? '切换到浅色主题' : '切换到深色主题');
    });
    if (androidPlayer) window.CPlayerNative?.postMessage(JSON.stringify({ op: 'appearance', theme: nextTheme }));

    [dom.desktopThemeBtn, dom.mobileThemeBtn].filter(Boolean).forEach(button => {
        button.setAttribute('aria-pressed', String(isNight));
        button.setAttribute('aria-label', isNight ? '切换到明亮模式' : '切换到夜间模式');
        button.title = isNight ? '切换到明亮模式' : '切换到夜间模式';
        const icon = button.querySelector('i');
        if (icon) icon.className = `fas ${isNight ? 'fa-sun' : 'fa-moon'}`;
        const label = button.querySelector('span');
        if (label) label.textContent = isNight ? '明亮' : '夜间';
    });

    if (announce) showToast(isNight ? '已切换到夜间模式' : '已切换到明亮模式');
}

function initThemeControls() {
    const initialTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'night';
    applyTheme(initialTheme, { persist: false });

    const toggleTheme = () => {
        const nextTheme = document.documentElement.dataset.theme === 'night' ? 'light' : 'night';
        applyTheme(nextTheme, { announce: true });
    };
    dom.desktopThemeBtn?.addEventListener('click', toggleTheme);
    dom.mobileThemeBtn?.addEventListener('click', toggleTheme);
    document.querySelectorAll('[data-android-theme]').forEach(button => {
        button.addEventListener('click', () => applyTheme(button.dataset.androidTheme, { announce: true }));
    });

    window.addEventListener('storage', event => {
        if (event.key === 'cp_theme' && (event.newValue === 'light' || event.newValue === 'night')) {
            applyTheme(event.newValue, { persist: false });
        }
    });
}

// ================= 设置 UI =================
let musicKeySettings;
function initSettingsUI() {
    musicKeySettings = createMusicKeySettings({
        onEnabled() {
            if (musicService.config.source !== 'bilibili') {
                loadNewSongDiscovery();
                scheduleMusicCollections();
            }
            if (contentViewFromHash() === 'charts') chartsController?.refresh();
        },
    });
}

function initMusicSourceControl() {
    const controls = [
        {
            select: document.getElementById('discoveryMusicSourceSelect'),
            hint: document.getElementById('discoveryMusicSourceHint'),
        },
        {
            select: document.getElementById('mobileMusicSourceSelect'),
            hint: document.getElementById('mobileMusicSourceHint'),
        },
        {
            select: document.getElementById('musicSourceSelect'),
            hint: document.getElementById('musicSourceHint'),
        },
        {
            select: document.getElementById('searchMusicSourceSelect'),
        },
    ].filter(control => control.select);
    if (!controls.length) return;
    const sourceTabs = controls.map(({ select }) => createMusicSourceTabs(select, MUSIC_SOURCE_OPTIONS));

    const sync = () => {
        const source = supportedMusicSource(musicService.config.source);
        const option = musicSourceOption(source);
        controls.forEach(({ select, hint }) => {
            select.value = source;
            if (hint) hint.textContent = option.detail;
        });
        sourceTabs.forEach(tabs => tabs.sync());
        if (!playback.state.currentSong) syncPlaybackQualityDisplay(musicService.config.quality);
        const isBilibili = source === 'bilibili';
        const isGd = source === 'gd';
        const isSearchSource = isGd || isMusicChannel(source);
        document.documentElement.classList.toggle('gd-source', isGd);
        document.documentElement.classList.toggle('channel-source', isMusicChannel(source));
        dom.gdSourceCredit.hidden = !isGd;
        dom.desktopDiscoveryView.classList.toggle('bilibili-discovery', isBilibili);
        dom.bilibiliCategories.hidden = !isBilibili;
        dom.mobileBilibiliBrowse.hidden = !isBilibili;
        dom.desktopLibraryTitle.textContent = isBilibili ? 'Bilibili 音乐' : '发现音乐';
        dom.desktopSearchSource.textContent = option.label;
        dom.desktopDiscoveryRefresh.setAttribute('aria-label', isBilibili ? '刷新 Bilibili 音乐' : isSearchSource ? '刷新音乐发现' : '刷新新歌速递');
        dom.desktopDiscoveryView.querySelector('.library-kicker').textContent = isBilibili ? 'BILIBILI' : 'DISCOVER';
        dom.desktopDiscoveryView.querySelector('.library-description').textContent = isBilibili
            ? '原创、翻唱与音乐现场' : '每日推荐、电台与此刻想听的声音';
        for (const grid of [dom.editorialPlaylistGrid, dom.newAlbumGrid, dom.scenePlaylistGrid]) {
            grid.closest('.music-shelf').hidden = Boolean(discoveryHome) || isBilibili || (isSearchSource && grid === dom.newAlbumGrid);
        }
        [dom.searchInput, dom.mobileSearchInput].filter(Boolean).forEach(input => {
            input.placeholder = isBilibili ? '视频标题、UP 主、BV 号或链接' : isSearchSource ? '歌曲名或歌手' : '歌曲名、歌手或歌曲 ID';
        });
    };

    sync();
    const categoryTabs = Array.from(dom.bilibiliCategories.querySelectorAll('[role="tab"]'));
    const selectCategory = tab => {
        bilibiliCategory = tab.dataset.bilibiliCategory;
        categoryTabs.forEach(item => {
            const selected = item === tab;
            item.setAttribute('aria-selected', String(selected));
            item.tabIndex = selected ? 0 : -1;
        });
        loadNewSongDiscovery();
    };
    categoryTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectCategory(tab));
        tab.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % categoryTabs.length;
            else if (event.key === 'ArrowLeft') next = (index + categoryTabs.length - 1) % categoryTabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = categoryTabs.length - 1;
            else return;
            event.preventDefault();
            categoryTabs[next].focus();
            selectCategory(categoryTabs[next]);
        });
    });
    dom.mobileBilibiliBrowse.addEventListener('click', () => mobileUI?.handleSearch('', { discover: true }));
    controls.forEach(({ select }) => {
        select.addEventListener('change', event => {
            const previousSource = supportedMusicSource(musicService.config.source);
            const nextSource = supportedMusicSource(event.target.value);
            if (nextSource === previousSource) return;
            desktopSearchController?.abort();
            mobileUI?.searchController?.abort();
            const discoverySourceChanged = previousSource !== nextSource;
            if (discoverySourceChanged) {
                desktopDiscoveryController?.abort();
                musicCollectionsController?.abort();
            }
            musicService.saveSettings('source', nextSource);
            const pageUrl = new URL(window.location.href);
            pageUrl.searchParams.set('source', nextSource);
            history.replaceState(history.state, '', pageUrl);
            sync();
            if (dom.searchResults) {
                setSearchStatus(dom.searchResults, '音源已切换，请重新搜索');
            }
            if (mobileUI?.dom.searchResults) {
                setSearchStatus(mobileUI.dom.searchResults, '音源已切换，请重新搜索');
            }
            // Reuse the visible query without treating a numeric query as an autoplay command.
            if (!isCompactLayout() && !dom.desktopSearchView.hidden && dom.searchInput.value.trim()) {
                searchSongs(dom.searchInput.value, { allowIdPlayback: false });
            } else if (isCompactLayout() && select.id === 'mobileMusicSourceSelect' && dom.mobileSearchInput.value.trim()) {
                mobileUI?.handleSearch(dom.mobileSearchInput.value, { allowIdPlayback: false });
            }
            if (discoverySourceChanged) {
                loadNewSongDiscovery();
                if (nextSource !== 'bilibili') scheduleMusicCollections();
                if (nextSource !== 'chksz' || contentViewFromHash() === 'charts') chartsController?.refresh();
            }
            showToast(`已切换音乐源：${musicSourceOption(nextSource).label}`);
        });
    });
}

const dialogTriggers = new WeakMap();

function getFocusableElements(dialog) {
    return Array.from(dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hidden && element.getClientRects().length > 0);
}

function activateDialog(dialog, focusTarget) {
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement) dialogTriggers.set(dialog, trigger);
    dialog.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        const target = focusTarget || getFocusableElements(dialog)[0];
        target?.focus();
    }, 0);
}

function deactivateDialog(dialog) {
    dialog.setAttribute('aria-hidden', 'true');
    const trigger = dialogTriggers.get(dialog);
    dialogTriggers.delete(dialog);
    if (trigger?.isConnected) trigger.focus();
}

function activeDialog() {
    const native = document.querySelector('dialog[open]');
    if (native) return native;
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-hidden="false"]'));
    return dialogs[dialogs.length - 1] || null;
}

function handleAndroidBack() {
    const modal = document.activeElement?.closest('dialog[open]') || document.querySelector('dialog[open]');
    if (modal) {
        if (modal.id === 'accountEntryDialog') return false;
        if (modal.requestClose) modal.requestClose();
        else if (modal.dispatchEvent(new Event('cancel', { cancelable: true }))) modal.close();
        return true;
    }
    if (dom.welcomeModal.getAttribute('aria-hidden') === 'false') closeWelcomeModal();
    else if (dom.settingsModal.getAttribute('aria-hidden') === 'false') { if (!androidSettingsUI?.back()) closeSettings(); }
    else if (dom.mobilePlaylistSheet.getAttribute('aria-hidden') === 'false') mobileUI?.closeSheet();
    else if (mobileExploreView === 'wall' && dom.mobileChartsSheet.getAttribute('aria-hidden') === 'false' && musicWall?.handleBack()) return true;
    else if (dom.mobileChartsSheet.getAttribute('aria-hidden') === 'true' && mobileUI?.currentMode === 'lyrics') mobileUI.resetView();
    else if (dom.mobileChartsSheet.getAttribute('aria-hidden') === 'true') setMobileExploreOpen(true);
    else if (mobileExploreView !== 'discovery') setMobileExploreView('discovery');
    else return false;
    return true;
}

document.addEventListener('keydown', event => {
    const dialog = activeDialog();
    if (!dialog) return;

    if (event.key === 'Escape') {
        if (dialog.id === 'settingsModal') { event.preventDefault(); if (!androidSettingsUI?.back()) closeSettings(); }
        if (dialog.id === 'mobilePlaylistSheet') { event.preventDefault(); mobileUI?.closeSheet(); }
        return;
    }

    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(dialog);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

function openSettings(options = {}) {
    androidSettingsUI?.open(options);
    void musicKeySettings?.refresh();
    dom.settingsModal.classList.remove('hidden');
    // Allow reflow
    void dom.settingsModal.offsetWidth;
    dom.settingsModal.classList.remove('opacity-0');
    dom.settingsModal.querySelector('.modal-card').classList.remove('scale-95');
    dom.settingsModal.querySelector('.modal-card').classList.add('scale-100');

    // 回显当前歌单 ID
    const idInput = document.getElementById('playlistIdInput');
    const savedId = localStorage.getItem('cp_playlistId');
    if (idInput && savedId) idInput.value = savedId;
    activateDialog(dom.settingsModal, androidPlayer ? document.getElementById('androidSettingsBack') : dom.closeSettingsBtn);

    // 刷新歌单来源状态
    updateSourceDisplay();
}

function updateSourceDisplay() {
    const sourceLabel = document.getElementById('sourceLabel');
    const sourceDetail = document.getElementById('sourceDetail');
    const sourceIconI = document.getElementById('sourceIconI');
    const sourceCount = document.getElementById('sourceCount');
    if (!sourceLabel) return;

    const count = queue.playlist ? queue.playlist.length : 0;
    sourceCount.querySelector('div:first-child').textContent = count;

    const configs = {
        'local':       { icon: 'fas fa-hdd',            label: '本地 playlist.js',       detail: '同目录下的 playlist.js 文件自动加载' },
        'online':      { icon: 'fas fa-cloud',          label: '在线歌单',               detail: `歌单 ID: ${playlistSourceName}` },
        'cache':       { icon: 'fas fa-database',       label: '本地缓存',               detail: `歌单 ID: ${playlistSourceName}（来自 IndexedDB 缓存）` },
        'import-js':   { icon: 'fas fa-file-code',      label: '导入的 JS 歌单',         detail: `文件: ${playlistSourceName}` },
        'import-json': { icon: 'fas fa-file-alt',       label: '导入的 JSON 歌单',       detail: `文件: ${playlistSourceName}` },
        '':            { icon: 'fas fa-music',           label: '未加载歌单',             detail: '请输入歌单 ID 或导入文件' }
    };

    const cfg = configs[playlistSource] || configs[''];
    sourceIconI.className = cfg.icon + ' text-primary-color text-sm';
    sourceLabel.textContent = cfg.label;
    sourceDetail.textContent = cfg.detail;
}

function closeSettings() {
    musicKeySettings?.resetInput();
    deactivateDialog(dom.settingsModal);
    dom.settingsModal.classList.add('opacity-0');
    dom.settingsModal.querySelector('.modal-card').classList.add('scale-95');
    dom.settingsModal.querySelector('.modal-card').classList.remove('scale-100');
    setTimeout(() => {
        if (dom.settingsModal.getAttribute('aria-hidden') === 'true') dom.settingsModal.classList.add('hidden');
    }, 300);
    androidSettingsUI?.closed();
}

function syncPlaybackControls(playing = Boolean(audio.src && !audio.paused && !audio.ended)) {
    isPlaying = Boolean(playing);
    document.body.classList.toggle('is-audio-playing', isPlaying);
    discoveryTable?.sync();
    animeProgressThumbs.forEach(component => component.setPlaying(isPlaying));
    setDesktopPlayIcon(isPlaying ? 'pause' : 'play');
    dom.playPauseBtn?.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
    dom.playPauseBtn?.setAttribute('aria-pressed', String(isPlaying));
    dom.albumArtWrapper?.classList.toggle('playing', isPlaying);
    mobileUI?.updatePlayState(isPlaying);

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = audio.usesNativeSession ? 'none' : isPlaying ? 'playing' : 'paused';
    }
}

function setPlaybackTransitionPending(pending) {
    playback.state.transitionPending = Boolean(pending);
    [dom.playPauseBtn, mobileUI?.dom?.playBtn].filter(Boolean).forEach(button => {
        button.toggleAttribute('aria-busy', playback.state.transitionPending);
    });
    if (playback.state.transitionPending) {
        setDesktopPlayIcon('circle-notch');
        const mobileIcon = mobileUI?.dom?.playBtn?.querySelector('i');
        if (mobileIcon) mobileIcon.className = 'fas fa-circle-notch fa-spin';
    }
}

function onPlayStart() {
    setPlaybackTransitionPending(false);
    syncPlaybackControls(true);
    if (!audioContext) setupAudioContext();
    else if (audioContext.state === 'suspended') audioContext.resume();
}

function onPlayPause() {
    setPlaybackTransitionPending(false);
    syncPlaybackControls(false);
}

function setDesktopPlayIcon(iconName) {
    const icon = dom.playPauseBtn?.querySelector('i');
    if (!icon) return;
    icon.className = `fas fa-${iconName}`;
}

function playbackDetailText(data, level) {
    if (data?.offline) return data.provider === 'local' ? '本地音频 · 离线播放' : '离线缓存 · 本机播放';
    if (data?.playbackSource) return [data.source, qualityDetails(level).name, data.format?.toUpperCase()].filter(Boolean).join(' · ');
    const resolvedLevel = supportedQuality(level);
    const bitrate = Number(data?.br ?? data?.bitrate);
    if (data?.provider === 'bilibili') return `Bilibili · ${Math.round(bitrate / 1000)} kbps · AAC`;
    const providerLabel = musicSourceOption(data?.provider).label;
    if (isMusicChannel(data?.provider)) return `${providerLabel}${bitrate > 0 ? ` · ${Math.round(bitrate / 1000)} kbps` : ''} · ${String(data.format || 'MP3').toUpperCase()}`;
    const isFlac = String(data?.url || '').toLowerCase().includes('flac')
        || ['lossless', 'hires', 'jymaster'].includes(resolvedLevel);
    const format = isFlac ? 'FLAC' : 'MP3';
    if (Number.isFinite(bitrate) && bitrate > 0) {
        return `${providerLabel} · ${Math.round(bitrate / 1000)} kbps · ${format}`;
    }
    if (resolvedLevel === 'standard') return `${providerLabel} · 128 kbps · ${format}`;
    if (resolvedLevel === 'exhigh') return `${providerLabel} · 320 kbps · ${format}`;
    return `${providerLabel} · ${qualityDetails(resolvedLevel).name} · ${format}`;
}

function syncDesktopPlayerAvailability() {
    if (!dom.desktopPlayerBar) return;
    const hasSong = Boolean(playback.state.currentSong?.id);
    dom.desktopPlayerBar.classList.toggle('is-empty', !hasSong);
    if (dom.desktopMiniPlayer) dom.desktopMiniPlayer.disabled = !hasSong;
    if (dom.prevBtn) dom.prevBtn.disabled = !hasSong;
    if (dom.nextBtn) dom.nextBtn.disabled = !hasSong;
    const originalUrl = bilibiliVideoUrl(playback.state.currentSong);
    if (dom.desktopDownloadBtn) {
        dom.desktopDownloadBtn.disabled = !hasSong || playback.state.currentSong?.downloadAllowed === false;
        dom.desktopDownloadBtn.hidden = false;
        dom.desktopDownloadBtn.title = dom.desktopDownloadBtn.disabled && hasSong ? '当前来源仅提供在线播放' : '下载当前音频';
    }
    if (dom.mobileDownloadBtn) {
        dom.mobileDownloadBtn.hidden = !originalUrl;
        dom.mobileDownloadBtn.disabled = playback.state.currentSong?.downloadAllowed === false;
        dom.mobileDownloadBtn.title = dom.mobileDownloadBtn.disabled ? '当前来源仅提供在线播放' : '下载当前音频';
    }
    [dom.desktopOriginalVideo, dom.mobileOriginalVideo].filter(Boolean).forEach(link => {
        link.hidden = !originalUrl;
        if (originalUrl) link.href = originalUrl;
        else link.removeAttribute('href');
    });

    [dom.desktopProgressBarContainer, dom.mobileProgressBarContainer].forEach(container => {
        if (!container) return;
        container.setAttribute('aria-disabled', String(!hasSong));
        container.tabIndex = hasSong ? 0 : -1;
        container.title = hasSong ? '播放进度' : '尚未选择歌曲';
    });

    if (hasSong) {
        if (dom.currentTime?.textContent === '--:--') dom.currentTime.textContent = '0:00';
        if (dom.totalTime && audio.duration > 0) dom.totalTime.textContent = formatTime(audio.duration);
        syncPlaybackControls();
        return;
    }

    if (dom.desktopMiniCover) dom.desktopMiniCover.src = './img/icon.png';
    if (dom.songTitle) dom.songTitle.textContent = '请选择歌曲';
    if (dom.artistName) dom.artistName.textContent = '从歌单或搜索中开始播放';
    if (dom.sourceTag) dom.sourceTag.textContent = '准备播放';
    if (dom.songIdTag) dom.songIdTag.textContent = 'ID: --';
    if (dom.currentTime) dom.currentTime.textContent = '--:--';
    if (dom.totalTime) dom.totalTime.textContent = '--:--';
    if (dom.progressBar) dom.progressBar.style.width = '0%';
    updateDoraemonProgress(0, 0, 0);
    resetBufferedProgress();
    setDesktopPlayIcon('list-ul');
    dom.playPauseBtn?.setAttribute('aria-label', '打开播放队列');
    dom.playPauseBtn?.setAttribute('aria-pressed', 'false');
}

async function togglePlayPause() {
    if (playback.state.quality.songLoading) return;
    if (!playback.state.currentSong?.id) {
        switchDesktopTab('playlist');
        togglePlaylistPanel(true);
        return;
    }
    if (playback.state.transitionPending) return;
    if (!audio.src || audio.readyState === 0) {
        // 如果还未加载过歌曲，直接播放播放列表中的当前或第一首歌
        if (queue.playlist.length) {
            if (queue.currentIndex === -1) {
                if (queue.playMode === 'random' && typeof queue.shuffledOrder !== 'undefined' && queue.shuffledOrder.length) {
                    queue.currentIndex = queue.shuffledOrder[0];
                } else {
                    queue.currentIndex = 0;
                }
            }
            playSongAtIndex(queue.currentIndex);
        }
        return;
    }

    return playback.toggle({
        onPending: setPlaybackTransitionPending,
        onError(error) {
            console.error('Playback toggle failed:', error);
            showToast('播放失败，请检查网络后重试', true);
        },
        onSettled: syncPlaybackControls,
    });
}

function setSearchStatus(container, message, { error = false } = {}) {
    const status = document.createElement('div');
    status.className = `p-4 text-center ${error ? 'text-red-400' : 'opacity-60'}`;
    status.textContent = message;
    container.replaceChildren(status);
}

let desktopSearchController = null;

async function searchSongs(query, { allowIdPlayback = true } = {}) {
    query = query.trim();
    if (!query) return;
    const requestSource = supportedMusicSource(musicService.config.source);

    desktopSearchController?.abort();
    const requestController = new AbortController();
    desktopSearchController = requestController;

    if (allowIdPlayback && requestSource === 'chksz' && /^\d+$/.test(query)) {
        dom.searchResults.innerHTML = Array.from({ length: 1 }).map(() => `
            <div class="playlist-item p-2 rounded-xl flex items-center gap-3 animate-pulse opacity-50 mb-1">
                <div class="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0 relative overflow-hidden"><div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]"></div></div>
                <div class="flex-1 min-w-0 space-y-2 py-1">
                    <div class="h-4 bg-white/10 rounded w-1/3 relative overflow-hidden"><div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]"></div></div>
                    <div class="h-3 bg-white/10 rounded w-1/4 relative overflow-hidden"><div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]"></div></div>
                </div>
            </div>
        `).join('');
        dom.searchResults.classList.remove('hidden');

        try {
            const songData = await musicService.getSong(query, {
                signal: requestController.signal
            });
            if (requestController.signal.aborted || musicService.config.source !== requestSource) return;
            if (songData && songData.url) {
                const newSong = {
                    id: songData.id,
                    sourceId: songData.sourceId,
                    name: songData.name,
                    artist: songData.artist,
                    cover: songData.cover,
                    album: songData.album || '',
                    source: 'id_search',
                    provider: songData.provider,
                    preferredProvider: requestSource,
                };

                // 插入到当前播放位置之后
                const targetIndex = window.insertSongToPlaylist(newSong);
                renderAllPlaylistItems();
                playSongAtIndex(targetIndex);

                setSearchStatus(dom.searchResults, `已加入队列: ${newSong.name}`);
                showToast(`已加入队列: ${newSong.name}`);
            } else {
                throw new Error('无效的歌曲ID');
            }
        } catch (e) {
            if (e instanceof RequestCancelledError || requestController.signal.aborted) return;
            console.error(e);
            setSearchStatus(dom.searchResults, `无法加载歌曲：${requestErrorMessage(e)}`, { error: true });
        } finally {
            if (desktopSearchController === requestController) {
                desktopSearchController = null;
            }
        }
        return;
    }

    // dom.searchLoader.style.display = 'block';
    dom.searchResults.innerHTML = Array.from({ length: 10 }).map(() => `
        <div class="playlist-item p-2 rounded-xl flex items-center gap-3 animate-pulse opacity-50 mb-1">
            <div class="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0 relative overflow-hidden"><div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]"></div></div>
            <div class="flex-1 min-w-0 space-y-2 py-1">
                <div class="h-4 bg-white/10 rounded w-3/4 relative overflow-hidden"><div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]"></div></div>
                <div class="h-3 bg-white/10 rounded w-1/2 relative overflow-hidden"><div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]"></div></div>
            </div>
        </div>
    `).join('');
    dom.searchResults.classList.remove('hidden');

    try {
        const songs = await musicService.search(query, {
            signal: requestController.signal,
            source: requestSource,
        });
        if (requestController.signal.aborted || musicService.config.source !== requestSource) return;

        // [需求4] 限制显示30条结果
        const limitedSongs = songs ? songs.slice(0, 30) : [];

        if (limitedSongs.length) {
            dom.searchResults.innerHTML = '';
            limitedSongs.forEach(song => {
                const div = document.createElement('div');
                div.className = 'playlist-item p-2 rounded-xl hover:bg-surface-container-high-color cursor-pointer flex items-center gap-3 transition-all theme-text-on-surface mb-1';

                const sourceBadge = song.source ? `<span class="ml-2 text-[10px] px-1 rounded bg-primary-color/20 text-primary-color uppercase">${song.source}</span>` : '';

                const coverDiv = document.createElement('div');
                coverDiv.className = 'w-10 h-10 rounded-lg bg-surface-container-color flex-shrink-0 overflow-hidden';
                const img = document.createElement('img');
                img.className = 'w-full h-full object-cover'; img.loading = 'lazy'; img.alt = '';
                bindArtwork(img, song, { size: 80 }); coverDiv.appendChild(img);

                const infoDiv = document.createElement('button');
                infoDiv.type = 'button';
                infoDiv.className = 'flex-1 min-w-0 text-left bg-transparent border-0 p-0';
                infoDiv.setAttribute('aria-label', `加入并播放 ${song.name || '歌曲'}`);
                const titleDiv = document.createElement('div');
                titleDiv.className = 'truncate text-sm font-medium flex items-center';
                titleDiv.textContent = song.name || '未知歌曲';
                const artistDiv = document.createElement('div');
                artistDiv.className = 'truncate text-xs opacity-50';
                artistDiv.textContent = song.artist || '未知艺术家';

                infoDiv.appendChild(titleDiv);
                infoDiv.appendChild(artistDiv);

                div.appendChild(coverDiv);
                div.appendChild(infoDiv);

                const downloadButton = document.createElement('button');
                downloadButton.type = 'button';
                downloadButton.className = 'discovery-download';
                downloadButton.setAttribute('aria-label', `下载 ${song.name || '歌曲'}`);
                downloadButton.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i>';
                downloadButton.addEventListener('click', event => {
                    event.stopPropagation();
                    openDownloadDialog({
                        id: song.id,
                        sourceId: song.sourceId,
                        name: song.name,
                        artist: song.artist,
                        album: song.album || '',
                        cover: song.cover,
                        provider: song.provider,
                    }, downloadButton);
                });
                div.appendChild(downloadButton);
                if (bilibiliVideoUrl(song)) div.appendChild(createOriginalVideoLink(song));

                div.onclick = () => {
                    const newSong = {
                        ...song,
                        id: song.id,
                        sourceId: song.sourceId,
                        name: song.name,
                        artist: song.artist,
                        cover: song.cover,
                        album: song.album || '',
                        source: song.source || 'Search',
                        provider: song.provider,
                        preferredProvider: requestSource,
                    };
                    const targetIndex = window.insertSongToPlaylist(newSong);
                    renderAllPlaylistItems();
                    playSongAtIndex(targetIndex);

                    showToast(`已加入队列: ${newSong.name}`);
                };
                catalogBrowser.decorateRow(div,song);
                dom.searchResults.appendChild(div);
            });
        } else {
            setSearchStatus(dom.searchResults, '未找到相关歌曲');
        }
    } catch (error) {
        if (error instanceof RequestCancelledError || requestController.signal.aborted) return;
        console.error(error);
        setSearchStatus(dom.searchResults, requestErrorMessage(error), { error: true });
    } finally {
        if (desktopSearchController === requestController) {
            desktopSearchController = null;
        }
    }
}

let desktopDiscoveryController = null;
let discoveryTable = null;
let discoveryHome = null;
let catalogBrowser = null;
let discoveryLoadingSong = null;
let discoveryOffset = 0;
let discoveryPageController = null;
function initDiscoveryTable() {
    catalogBrowser = createCatalogBrowser({document, musicService,
        onLibrary: song => personalLibrary?.song(song), onCollect: item => personalLibrary?.collect(item),
        onPlay: song => addDiscoverySong(song),
        onQueue: song => addChartSong(song, {playNow:false,source:song.source}),
    });
    discoveryHome = createDiscoveryHome({ onUpdate: () => musicWall?.refresh(), document, root: dom.discoveryHome, musicService, storage: localStorage,
        onCollect: item => personalLibrary?.collect(item),
        onPlay: (song, options) => addDiscoverySong(song, options),
        onBatch: (songs, label) => addCollectionTracks(songs, {label, playNow:true, source:'recommendations'}),
        onDetails: (song, trigger) => catalogBrowser.open({song,trigger}),
        getCurrentSong: () => playback.state.currentSong,
        getLibrary: () => queue.playlist,
        notify: showToast,
    });
    discoveryHome.connectAudio(audio);
    if (androidPlayer) {
        musicWall = createMusicWall({ document, root: dom.mobileExploreWallPane, storage: localStorage,
            getSnapshot: () => ({ ...discoveryHome.wallSnapshot(), queue: queue.playlist }),
            getCurrentSong: () => playback.state.currentSong,
            onPlay: song => addDiscoverySong(song),
            onQueue: song => addChartSong(song, { playNow: false, source: song.source }),
            onDetails: (song, trigger) => catalogBrowser.open({ song, trigger }),
            onSearch: openMusicSearch, onRetry: () => discoveryHome.load(),
        });
        musicWall.setActive(mobileExploreView === 'wall' && dom.mobileChartsSheet.getAttribute('aria-hidden') === 'false');
        for (const event of ['loadedmetadata', 'playing', 'pause', 'emptied']) audio.addEventListener(event, () => musicWall.refresh());
    }
    const sharedPage = new URLSearchParams(location.search);
    if (/^\d{1,20}$/.test(sharedPage.get('collection') || '')) {
        const openSharedPage = () => discoveryHome.openCollection(sharedPage.get('collectionType'), sharedPage.get('collection'));
        const entryDialog = document.getElementById('accountEntryDialog');
        if (entryDialog.open) entryDialog.addEventListener('close', openSharedPage, { once: true });
        else void openSharedPage();
    }
    const placeDiscoveryHome = () => {
        const host = isCompactLayout() ? dom.mobileExploreDiscoveryPane : dom.discoveryHomeHost;
        if (dom.discoveryHome.parentElement !== host) host.append(dom.discoveryHome);
    };
    placeDiscoveryHome();
    desktopShellMedia.addEventListener('change', placeDiscoveryHome);
    document.querySelectorAll('[data-open-discovery-charts]').forEach(button => button.addEventListener('click', () => discoveryHome.showCharts()));

    document.querySelectorAll('[data-open-catalog]').forEach(button => button.addEventListener('click', () => catalogBrowser.open({query:isCompactLayout() ? dom.mobileSearchInput.value : dom.searchInput.value,trigger:button})));

    discoveryTable = createDiscoveryTable({
        document, storage: localStorage, list: dom.desktopDiscoveryList,
        onPlay: song => {
            if (String(playback.state.currentSong?.id) === String(song.id) && (playback.state.currentSong?.provider || 'gd') === (song.provider || 'gd')) togglePlayPause();
            else addDiscoverySong(song);
        },
        onQueue: song => addChartSong(song, { playNow: false, source: song.source }),
        onBatch: (tracks, playNow) => addCollectionTracks(tracks, { label: '发现音乐', playNow, source: musicService.config.source }),
        onDownload: openDownloadDialog, onSearch: openMusicSearch, onRetry: loadNewSongDiscovery, onNotify: showToast,
        onMore: loadMoreDiscovery, onLibrary: song => personalLibrary?.song(song),
        onDetails: (song,trigger) => catalogBrowser.open({song,trigger}),
        canDownload: song => !['gd', ...Object.keys(MUSIC_SOURCE_OPTIONS).filter(isMusicChannel)].includes(song.provider) && song.downloadAllowed !== false,
        getPlayback: () => ({ song: discoveryLoadingSong || playback.state.currentSong, playing: !discoveryLoadingSong && !audio.paused && !audio.ended, loading: Boolean(discoveryLoadingSong), duration: discoveryLoadingSong ? 0 : audio.duration }),
    });
    for (const event of ['playing','pause','loadedmetadata','durationchange','emptied']) audio.addEventListener(event, () => discoveryTable.sync());
    audio.addEventListener('waiting', () => dom.desktopPlayerBar.classList.add('is-buffering'));
    for (const event of ['playing','pause','error']) audio.addEventListener(event, () => dom.desktopPlayerBar.classList.remove('is-buffering'));
    document.getElementById('desktopLyricsBtn').addEventListener('click', () => desktopShell.navigate(document.documentElement.classList.contains('desktop-immersive-open') ? 'library' : 'now-playing', { trigger: document.getElementById('desktopLyricsBtn') }));
    document.getElementById('playerFullscreenBtn').addEventListener('click', () => dom.fullscreenBtn.click());
    const skin = document.getElementById('animeThumbSkin');
    skin.checked = localStorage.getItem('cp_anime_thumb') === 'on';
    const applySkin = () => { document.documentElement.classList.toggle('anime-thumb-enabled', skin.checked); };
    skin.addEventListener('change', () => { localStorage.setItem('cp_anime_thumb', skin.checked ? 'on' : 'off'); applySkin(); });
    applySkin();

    document.querySelectorAll('.app-sidebar .app-nav-item, .app-topbar button, #desktopPlayerBar button').forEach(button => {
        if (!button.title) button.title = button.getAttribute('aria-label') || button.textContent.trim();
    });
    document.addEventListener('keydown', event => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="slider"],[role="radio"]') || activeDialog()) return;
        if (event.key === '/') { event.preventDefault(); openMusicSearch(); }
        else if (event.code === 'Space') { event.preventDefault(); togglePlayPause(); }
        else if (['ArrowLeft','ArrowRight'].includes(event.key) && audio.duration > 0) { event.preventDefault(); audio.currentTime = Math.max(0,Math.min(audio.duration,audio.currentTime + (event.key === 'ArrowLeft' ? -5 : 5))); updatePlayerState(); }
    });
}

async function loadMoreDiscovery() {
    const source = supportedMusicSource(musicService.config.source);
    const controller = new AbortController();
    discoveryPageController?.abort(); discoveryPageController = controller;
    const before = discoveryTable.count();
    try {
        const songs = await musicService.search('华语', { source, offset: discoveryOffset, limit: 10, signal: controller.signal });
        if (controller.signal.aborted || source !== musicService.config.source) return;
        discoveryOffset += 10;
        discoveryTable.setSongs(songs, { append: true, more: songs.length >= 10 });
        if (discoveryTable.count() === before) discoveryTable.setSongs([], { append: true, more: false });
    } catch (error) {
        if (!controller.signal.aborted) showToast(`暂时无法加载更多：${requestErrorMessage(error)}`, true);
    } finally { if (discoveryPageController === controller) discoveryPageController = null; }
}
let bilibiliCategory = 'all';

function useGdMusic() {
    const select = dom.musicSourceSelect;
    if (!select) return;
    select.value = 'gd';
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

function openMusicSearch(query = '') {
    if (isCompactLayout()) {
        if (!androidPlayer) setMobileExploreOpen(false);
        mobileUI?.switchSheetTab('search');
        mobileUI?.openSheet();
        dom.mobileSearchInput.value = query;
        dom.mobileSearchInput.focus();
        if (query) mobileUI?.handleSearch(query);
    } else {
        desktopShell.navigate('search');
        dom.searchInput.value = query;
        dom.searchInput.focus();
        if (query) searchSongs(query);
    }
}

async function loadNewSongDiscovery() {
    if (!dom.desktopDiscoveryList) return;
    discoveryPageController?.abort();
    discoveryOffset = 10;

    const requestSource = supportedMusicSource(musicService.config.source);
    const discoverySource = requestSource;
    const sourceOption = musicSourceOption(discoverySource);
    const snapshotKey = requestSource === 'gd' ? 'cp_gd_discovery_v1' : requestSource === 'bilibili' ? `cp_bilibili_discovery_v1_${bilibiliCategory}` : `cp_channel_discovery_v1_${requestSource}`;
    let snapshot = null;
    if (requestSource !== 'chksz') {
        try {
            const saved = JSON.parse(globalThis.localStorage?.getItem(snapshotKey) || 'null');
            if (saved?.savedAt > Date.now() - 86400000) {
                const songs = isMusicChannel(requestSource) ? normalizeChannelSongs({ code: 200, data: saved.songs }, requestSource) : requestSource === 'gd'
                    ? normalizeSearchPayload({ code: 200, data: saved.songs }).map(song => ({ ...song, provider: 'gd', source: 'GD 音乐台' }))
                    : normalizeBilibiliPayload({ code: 200, data: saved.songs });
                if (songs.length) snapshot = { songs: songs.slice(0, 12), savedAt: saved.savedAt };
            }
        } catch { }
    }
    const sourceLabel = dom.desktopDiscoverySection?.querySelector('.discovery-source');
    const sourceDetail = dom.desktopDiscoverySection?.querySelector('.discovery-heading-copy > p');
    if (sourceLabel) sourceLabel.textContent = discoverySource === 'chksz'
        ? 'ChKSz · 网易云新歌榜' : discoverySource !== 'bilibili' ? `${sourceOption.label} · 华语搜索` : 'Bilibili · 公开内容';
    if (sourceDetail) sourceDetail.textContent = discoverySource === 'chksz'
        ? '真实榜单数据 · 每次展示最新 12 首' : discoverySource !== 'bilibili' ? '关键词「华语」的搜索结果 · 点击即可播放' : '音乐区视频 · UP 主作品';
    if (dom.desktopDiscoveryTitle) dom.desktopDiscoveryTitle.textContent = discoverySource === 'chksz' ? '新歌速递'
        : discoverySource !== 'bilibili' ? '随心发现' : (dom.bilibiliCategories.querySelector('[aria-selected="true"]')?.textContent || '音乐区热榜');

    desktopDiscoveryController?.abort();
    const requestController = new AbortController();
    desktopDiscoveryController = requestController;
    dom.desktopDiscoveryList.setAttribute('aria-busy', 'true');
    if (dom.desktopDiscoveryRefresh) dom.desktopDiscoveryRefresh.disabled = true;
    setDiscoveryStatus(`正在获取${sourceOption.label}内容...`);
    if (discoverySource === 'chksz') setCollectionLoading(dom.newAlbumGrid, 6, '正在整理新碟上架');

    try {
        const songs = await musicService.getNewSongs({
            signal: requestController.signal,
            source: discoverySource,
            category: bilibiliCategory,
        });
        if (requestController.signal.aborted) return;
        if (!songs.length) { setDiscoveryStatus('还没有找到歌曲，换个音源或关键词试试。', { empty: true }); return; }
        renderDiscoverySongs(songs);
        if (discoverySource === 'chksz') renderNewAlbums(songs);
        else if (discoverySource !== 'chksz') {
            try {
                globalThis.localStorage?.setItem(snapshotKey, JSON.stringify({ songs, savedAt: Date.now() }));
            } catch { }
        }
    } catch (error) {
        if (error instanceof RequestCancelledError || requestController.signal.aborted) return;
        if (snapshot) {
            renderDiscoverySongs(snapshot.songs);
            if (sourceDetail) sourceDetail.textContent = `上次更新：${new Date(snapshot.savedAt).toLocaleString('zh-CN')}`;
            return;
        }
        console.error('新歌榜加载失败:', error);
        setDiscoveryStatus(`${sourceOption.label}加载失败：${requestErrorMessage(error)}。搜索与播放仍可独立使用。`, {
            error: true, action: discoverySource === 'chksz' ? useGdMusic : null,
        });
        setCollectionStatus(dom.newAlbumGrid, '新碟加载失败，请刷新后重试', {
            error: true,
            retry: loadNewSongDiscovery,
        });
    } finally {
        if (desktopDiscoveryController === requestController) {
            desktopDiscoveryController = null;
            dom.desktopDiscoveryList.setAttribute('aria-busy', 'false');
            if (dom.desktopDiscoveryRefresh) dom.desktopDiscoveryRefresh.disabled = false;
        }
    }
}

function setDiscoveryStatus(message, { error = false, action = null, empty = false } = {}) {
    if (discoveryTable) { discoveryTable.status(message, { error, action, loading: !error && !empty }); return; }
    const status = document.createElement('div');
    status.className = `discovery-status${error ? ' is-error' : ''}`;
    status.setAttribute('role', 'status');

    const icon = document.createElement('i');
    icon.className = error ? 'fas fa-exclamation-circle' : 'fas fa-spinner fa-spin';
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = message;
    status.append(icon, label);
    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'content-primary-action';
        button.textContent = '使用 GD 音乐台';
        button.addEventListener('click', action);
        status.appendChild(button);
    }
    dom.desktopDiscoveryList.replaceChildren(status);
}

function renderDiscoverySongs(songs) {
    if (discoveryTable && musicService.config.source !== 'bilibili') {
        discoveryTable.setSongs(songs, { more: musicService.config.source !== 'chksz' && songs.length >= 10 });
        return;
    }
    if (discoveryTable) discoveryTable.setSongs(songs, { more: false });
    const fragment = document.createDocumentFragment();
    songs.forEach((song, index) => fragment.appendChild(createDiscoverySongRow(song, index)));
    dom.desktopDiscoveryList.replaceChildren(fragment);
}

function createOriginalVideoLink(song) {
    const link = document.createElement('a');
    link.className = 'discovery-download bilibili-original';
    link.href = bilibiliVideoUrl(song);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = '打开 Bilibili 原视频';
    link.setAttribute('aria-label', `打开 ${song.name || '视频'} 的 Bilibili 原页`);
    link.innerHTML = '<i data-lucide="ArrowUpRight" aria-hidden="true"></i>';
    link.addEventListener('click', event => event.stopPropagation());
    return link;
}

function createDiscoverySongRow(song, index) {
    const row = document.createElement('article');
    row.className = 'discovery-song-row';
    row.dataset.songId = String(song.id);

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'discovery-song-play';
    playButton.setAttribute('aria-label', `加入并播放 ${song.name} - ${song.artist}`);

    const number = document.createElement('span');
    number.className = 'discovery-song-index';
    number.textContent = String(index + 1).padStart(2, '0');

    const main = document.createElement('span');
    main.className = 'discovery-song-main';

    const cover = document.createElement('span');
    cover.className = 'discovery-song-cover';
    const image = document.createElement('img');
    image.alt = ''; image.width = image.height = 48;
    bindArtwork(image, song, { size: 160 });
    cover.appendChild(image);

    const copy = document.createElement('span');
    copy.className = 'discovery-song-copy';
    const title = document.createElement('strong');
    title.textContent = song.name || '未知歌曲';
    const artist = document.createElement('span');
    artist.textContent = song.artist || '未知艺术家';
    copy.append(title, artist);
    main.append(cover, copy);

    const album = document.createElement('span');
    album.className = 'discovery-song-album';
    album.textContent = song.album || '单曲';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'discovery-song-action';
    const actionIcon = document.createElement('i');
    actionIcon.dataset.lucide = 'Plus';
    actionIcon.setAttribute('aria-hidden', 'true');
    const actionLabel = document.createElement('span');
    actionLabel.textContent = '加入播放';
    action.append(actionIcon, actionLabel);
    action.addEventListener('click', () => addDiscoverySong(song));

    const actions = document.createElement('div');
    actions.className = 'discovery-song-actions';
    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'discovery-download';
    downloadButton.setAttribute('aria-label', `下载 ${song.name || '歌曲'}`);
    downloadButton.innerHTML = '<i data-lucide="ArrowDownToLine" aria-hidden="true"></i>';
    downloadButton.addEventListener('click', () => {
        openDownloadDialog({
            id: song.id,
            sourceId: song.sourceId,
            name: song.name,
            artist: song.artist,
            album: song.album || '',
            cover: song.cover,
            provider: song.provider,
        }, downloadButton);
    });
    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'discovery-song-secondary-actions';
    secondaryActions.appendChild(downloadButton);
    if (bilibiliVideoUrl(song)) secondaryActions.appendChild(createOriginalVideoLink(song));
    actions.append(action, secondaryActions);

    playButton.append(number, main, album);
    row.append(playButton, actions);
    playButton.addEventListener('click', () => addDiscoverySong(song));
    return row;
}

function addDiscoverySong(song, options = {}) {
    const existingIndex = queue.playlist.findIndex(item => song.catalogId && item.catalogId ? song.catalogId === item.catalogId : String(item.id) === String(song.id) && (!item.provider || !song.provider || item.provider === song.provider));
    if (existingIndex >= 0) {
        if (song.catalogId) Object.assign(queue.playlist[existingIndex], song, {id:queue.playlist[existingIndex].id});
        const pending = window.playSongAtIndex(existingIndex, options);
        showToast(`已在播放列表: ${song.name}`);
        return pending;
    }

    const newSong = {
        ...song,
        id: song.catalogId || song.id,
        sourceId: song.sourceId,
        name: song.name,
        artist: song.artist,
        cover: song.cover,
        album: song.album || '',
        duration: song.duration,
        source: song.source || 'new-song-chart',
        provider: song.provider,
    };
    const targetIndex = window.insertSongToPlaylist(newSong);
    playlistTotalCount = queue.playlist.length;
    allSongsLoaded = true;
    renderAllPlaylistItems();
    if (mobileUI) mobileUI.loadPlaylist();
    if (dom.playlistCount) dom.playlistCount.textContent = `(${queue.playlist.length}首)`;
    const pending = window.playSongAtIndex(targetIndex, options);
    showToast(`已加入队列: ${newSong.name}`);
    return pending;
}

function addChartSong(song, { playNow = true, source = '' } = {}) {
    const playbackId = song.catalogId || song.playbackId || song.id;
    const existingIndex = queue.playlist.findIndex(item => String(item.id) === String(playbackId));
    if (existingIndex >= 0) {
        if (song.catalogId) Object.assign(queue.playlist[existingIndex], song, {id:queue.playlist[existingIndex].id});
        if (playNow) window.playSongAtIndex(existingIndex);
        showToast(playNow ? `已在播放列表: ${song.name}` : `${song.name} 已在播放队列`);
        if (isCompactLayout() && playNow) setMobileExploreOpen(false);
        return;
    }

    const newSong = {
        ...song,
        id: playbackId,
        sourceId: song.sourceId || playbackId,
        name: song.name,
        artist: song.artist,
        cover: song.cover,
        album: song.album || '',
        duration: song.duration,
        source: source || `chart-${chartsController?.current() || 'hot'}`,
        provider: song.provider || 'chksz',
    };
    const targetIndex = window.insertSongToPlaylist(newSong);
    playlistTotalCount = queue.playlist.length;
    allSongsLoaded = true;
    renderAllPlaylistItems();
    if (mobileUI) mobileUI.loadPlaylist();
    if (dom.playlistCount) dom.playlistCount.textContent = `(${queue.playlist.length}首)`;

    if (playNow) {
        window.playSongAtIndex(targetIndex);
        if (isCompactLayout()) setMobileExploreOpen(false);
        showToast(`已加入队列: ${newSong.name}`);
    } else {
        showToast(`已加入播放队列: ${newSong.name}`);
    }
}

let musicCollectionsController = null;

function setCollectionLoading(container, count, message, { scene = false } = {}) {
    if (!container) return;
    container.setAttribute('aria-busy', 'true');
    const fragment = document.createDocumentFragment();
    const status = document.createElement('span');
    status.className = 'collection-sr-only';
    status.setAttribute('role', 'status');
    status.textContent = message;
    fragment.appendChild(status);

    for (let index = 0; index < count; index += 1) {
        const skeleton = document.createElement('div');
        skeleton.className = scene ? 'collection-skeleton scene-skeleton' : 'collection-skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        const art = document.createElement('span');
        art.className = 'collection-skeleton-art';
        const line = document.createElement('span');
        line.className = 'collection-skeleton-line';
        const shortLine = document.createElement('span');
        shortLine.className = 'collection-skeleton-line is-short';
        skeleton.append(art, line, shortLine);
        fragment.appendChild(skeleton);
    }
    container.replaceChildren(fragment);
}

function setCollectionStatus(container, message, { error = false, retry = null, retryLabel = '重新加载' } = {}) {
    if (!container) return;
    container.setAttribute('aria-busy', 'false');
    const status = document.createElement('div');
    status.className = `collection-status${error ? ' is-error' : ''}`;
    status.setAttribute('role', 'status');

    const icon = document.createElement('i');
    icon.className = error ? 'fas fa-exclamation-circle' : 'fas fa-compact-disc';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = message;
    status.append(icon, label);

    if (retry) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.textContent = retryLabel;
        retryButton.addEventListener('click', retry);
        status.appendChild(retryButton);
    }
    container.replaceChildren(status);
}

function createCollectionArtwork(cover, title, { scene = false } = {}) {
    const media = document.createElement('span');
    media.className = scene ? 'scene-artwork' : 'collection-artwork';
    const image = document.createElement('img');
    image.alt = ''; image.width = scene ? 960 : 720; image.height = scene ? 540 : 720;
    image.loading = 'lazy';
    bindArtwork(image, { cover, name: title }, { size: scene ? 960 : 720 });
    media.setAttribute('title', `${title}封面`);
    media.appendChild(image);
    return media;
}

function createCollectionCard(collection, { description, tone = 'violet', type = 'playlist' } = {}) {
    const article = document.createElement('article');
    article.className = 'collection-card';
    article.dataset.tone = tone;

    const coverButton = document.createElement('button');
    coverButton.type = 'button';
    coverButton.className = 'collection-cover-button';
    coverButton.setAttribute('aria-label', `查看${type === 'album' ? '专辑' : '歌单'} ${collection.name} 的曲目`);
    coverButton.appendChild(createCollectionArtwork(collection.cover, collection.name));
    const playBadge = document.createElement('span');
    playBadge.className = 'collection-play-badge';
    playBadge.setAttribute('aria-hidden', 'true');
    const playIcon = document.createElement('i');
    playIcon.className = 'fas fa-list-ul';
    playBadge.appendChild(playIcon);
    coverButton.appendChild(playBadge);
    coverButton.addEventListener('click', () => openCollectionDialog(collection, {
        type,
        opener: coverButton,
    }));

    const copy = document.createElement('div');
    copy.className = 'collection-card-copy';
    const title = document.createElement('h3');
    title.textContent = collection.name;
    title.title = collection.name;
    const subtitle = document.createElement('p');
    subtitle.textContent = description || collection.artist || '来自真实音乐榜单';
    copy.append(title, subtitle);

    const footer = document.createElement('div');
    footer.className = 'collection-card-footer';
    const meta = document.createElement('span');
    const trackCount = Number.isFinite(Number(collection.trackCount))
        ? Number(collection.trackCount)
        : collection.tracks.length;
    meta.textContent = type === 'album'
        ? `${trackCount}首上榜 · 专辑`
        : `${trackCount}首 · ${collection.creator || '网易云音乐'}`;
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'collection-add-button';
    addButton.setAttribute('aria-label', `将 ${collection.name} 加入播放队列`);
    addButton.title = '加入播放队列';
    const addIcon = document.createElement('i');
    addIcon.className = 'fas fa-plus';
    addIcon.setAttribute('aria-hidden', 'true');
    addButton.appendChild(addIcon);
    addButton.addEventListener('click', () => handleCollectionAction(collection, {
        playNow: false,
        trigger: addButton,
    }));
    footer.append(meta, addButton);
    article.append(coverButton, copy, footer);
    return article;
}

function createSceneCard(scene, collection) {
    const article = document.createElement('article');
    article.className = 'scene-card';
    article.dataset.tone = scene.tone;
    article.appendChild(createCollectionArtwork(collection.cover, scene.title, { scene: true }));

    const content = document.createElement('div');
    content.className = 'scene-card-content';
    const icon = document.createElement('span');
    icon.className = 'scene-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    const iconGlyph = document.createElement('i');
    iconGlyph.className = `fas ${scene.icon}`;
    icon.appendChild(iconGlyph);

    const copy = document.createElement('div');
    copy.className = 'scene-card-copy';
    const title = document.createElement('h3');
    title.textContent = scene.title;
    const description = document.createElement('p');
    description.textContent = scene.description;
    const meta = document.createElement('span');
    meta.textContent = `${collection.trackCount || collection.tracks.length}首 · ${collection.name}`;
    copy.append(title, description, meta);

    const actions = document.createElement('div');
    actions.className = 'scene-card-actions';
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'scene-play-button';
    playButton.setAttribute('aria-label', `播放场景歌单 ${scene.title}`);
    const playIcon = document.createElement('i');
    playIcon.className = 'fas fa-play';
    playIcon.setAttribute('aria-hidden', 'true');
    const playLabel = document.createElement('span');
    playLabel.textContent = '播放';
    playButton.append(playIcon, playLabel);
    playButton.addEventListener('click', () => handleCollectionAction(collection, {
        playNow: true,
        trigger: playButton,
    }));

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'scene-add-button';
    addButton.setAttribute('aria-label', `将 ${scene.title} 加入播放队列`);
    addButton.title = '加入播放队列';
    const addIcon = document.createElement('i');
    addIcon.className = 'fas fa-plus';
    addIcon.setAttribute('aria-hidden', 'true');
    addButton.appendChild(addIcon);
    addButton.addEventListener('click', () => handleCollectionAction(collection, {
        playNow: false,
        trigger: addButton,
    }));
    actions.append(playButton, addButton);
    content.append(icon, copy, actions);
    article.appendChild(content);
    return article;
}

function renderEditorialCollections(collections) {
    const fragment = document.createDocumentFragment();
    collections.forEach(({ config, collection }) => {
        fragment.appendChild(createCollectionCard(collection, {
            description: config.description,
            tone: config.tone,
        }));
    });
    dom.editorialPlaylistGrid.replaceChildren(fragment);
    dom.editorialPlaylistGrid.setAttribute('aria-busy', 'false');
}

function renderSceneCollections(collectionMap) {
    const fragment = document.createDocumentFragment();
    SCENE_PLAYLISTS.forEach(scene => {
        const collection = collectionMap.get(scene.playlistId);
        if (collection) fragment.appendChild(createSceneCard(scene, collection));
    });

    if (!fragment.childNodes.length) {
        setCollectionStatus(dom.scenePlaylistGrid, '场景歌单暂时无法加载', {
            error: true,
            retry: loadMusicCollections,
        });
        return;
    }
    dom.scenePlaylistGrid.replaceChildren(fragment);
    dom.scenePlaylistGrid.setAttribute('aria-busy', 'false');
}

function scheduleMusicCollections() {
    if (discoveryHome) return;
    if (musicService.config.source !== 'chksz') {
        if (musicService.config.source !== 'bilibili') renderGdTopics();
        return;
    }
    updateCollectionHeadings(false);
    const shelves = [dom.editorialPlaylistGrid, dom.scenePlaylistGrid]
        .map(grid => grid?.closest('.music-shelf')).filter(Boolean);
    if (!shelves.length) return;
    if (typeof IntersectionObserver === 'undefined') {
        window.setTimeout(loadMusicCollections, 800);
        return;
    }
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        loadMusicCollections();
    }, { rootMargin: '240px' });
    shelves.forEach(shelf => observer.observe(shelf));
}

function updateCollectionHeadings(gd) {
    for (const [grid, title, description, note] of [
        [dom.editorialPlaylistGrid, gd ? '按主题发现' : '编辑精选', gd ? '选一个主题，寻找喜欢的声音' : '网易云精选榜单', gd ? '点击搜索' : '每日更新'],
        [dom.scenePlaylistGrid, gd ? '此刻想听' : '场景歌单', gd ? '通勤、专注、运动与夜晚' : '网易云歌单 · 通勤、专注、运动与夜晚', gd ? '按需加载' : '随心切换'],
    ]) {
        const shelf = grid?.closest('.music-shelf');
        if (!shelf) continue;
        shelf.querySelector('h2').textContent = title;
        shelf.querySelector('.music-shelf-heading > div > p:last-child').textContent = description;
        shelf.querySelector('.music-shelf-note').textContent = note;
    }
}

function renderGdTopics() {
    updateCollectionHeadings(true);
    const groups = [
        [dom.editorialPlaylistGrid, [
            ['华语旋律', '华语', '听见熟悉的声音'], ['粤语经典', '粤语', '旋律里的旧时光'],
            ['日语流行', '日语', '轻盈明亮的节奏'], ['古典乐章', '古典', '给思绪留一点空白'],
            ['民谣故事', '民谣', '吉他与生活的片段'], ['爵士时光', '爵士', '随性一点，慢一点'],
        ]],
        [dom.scenePlaylistGrid, [
            ['清晨通勤', '轻快', '让节奏叫醒今天'], ['沉浸专注', '纯音乐', '安静陪伴手边的事'],
            ['夜晚独处', '夜晚', '把一天慢慢放下'], ['运动能量', '运动', '跟随节拍向前'],
            ['雨天陪伴', '雨', '窗外与耳边的旋律'], ['周末散步', '治愈', '留一些时间给自己'],
        ]],
    ];
    for (const [container, topics] of groups) {
        if (!container) continue;
        const fragment = document.createDocumentFragment();
        topics.forEach(([title, keyword, description], index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gd-topic-card';
            button.style.setProperty('--topic-hue', String(190 + index * 29));
            button.setAttribute('aria-label', `搜索${title}`);
            const name = document.createElement('strong');
            name.textContent = title;
            const detail = document.createElement('span');
            detail.textContent = description;
            const action = document.createElement('span');
            action.className = 'gd-topic-action';
            action.textContent = '搜索歌曲 →';
            button.append(name, detail, action);
            button.addEventListener('click', () => openMusicSearch(keyword));
            fragment.appendChild(button);
        });
        container.replaceChildren(fragment);
        container.setAttribute('aria-busy', 'false');
    }
}

async function loadMusicCollections() {
    if (discoveryHome) return;
    if (!dom.editorialPlaylistGrid || !dom.scenePlaylistGrid || musicService.config.source !== 'chksz') return;
    musicCollectionsController?.abort();
    const requestController = new AbortController();
    musicCollectionsController = requestController;
    setCollectionLoading(dom.editorialPlaylistGrid, EDITORIAL_PLAYLISTS.length, '正在整理编辑精选');
    setCollectionLoading(dom.scenePlaylistGrid, SCENE_PLAYLISTS.length, '正在准备场景歌单', { scene: true });

    const collections = [];
    try {
        for (const config of EDITORIAL_PLAYLISTS) {
            const collection = await musicService.getPlaylistCollection(config.id, {
                signal: requestController.signal,
            });
            if (requestController.signal.aborted) return;
            if (!collection?.tracks?.length) throw new Error(`Playlist ${config.id} was empty`);
            collections.push({ config, collection });
            const partialMap = new Map(collections.map(item => [String(item.collection.id), item.collection]));
            renderEditorialCollections(collections);
            renderSceneCollections(partialMap);
        }
        if (requestController.signal.aborted) return;
        if (!collections.length) throw new Error('All editorial playlists failed');

        const collectionMap = new Map(collections.map(item => [String(item.collection.id), item.collection]));
        renderEditorialCollections(collections);
        renderSceneCollections(collectionMap);
    } catch (error) {
        if (error instanceof RequestCancelledError || requestController.signal.aborted) return;
        console.error('音乐精选加载失败:', error);
        if (collections.length) {
            for (const grid of [dom.editorialPlaylistGrid, dom.scenePlaylistGrid]) {
                grid.closest('.music-shelf').querySelector('.music-shelf-note').textContent = '部分内容暂不可用';
            }
            return;
        }
        setCollectionStatus(dom.editorialPlaylistGrid, requestErrorMessage(error), {
            error: true,
            retry: useGdMusic, retryLabel: '使用 GD 音乐台',
        });
        setCollectionStatus(dom.scenePlaylistGrid, requestErrorMessage(error), {
            error: true,
            retry: useGdMusic, retryLabel: '使用 GD 音乐台',
        });
    } finally {
        if (musicCollectionsController === requestController) {
            musicCollectionsController = null;
        }
    }
}

function renderNewAlbums(songs) {
    if (!dom.newAlbumGrid) return;
    const albums = new Map();
    songs.forEach(song => {
        const albumName = String(song.album || song.name || '单曲').trim();
        const artist = String(song.artist || '未知艺术家').trim();
        const key = `${albumName}\u0000${artist}`;
        if (!albums.has(key)) {
            albums.set(key, {
                id: key,
                name: albumName,
                artist,
                cover: song.cover,
                trackCount: 0,
                tracks: [],
                type: 'album',
            });
        }
        const album = albums.get(key);
        album.tracks.push(song);
        album.trackCount = album.tracks.length;
    });

    const albumList = Array.from(albums.values()).slice(0, 12);
    if (!albumList.length) {
        setCollectionStatus(dom.newAlbumGrid, '暂时没有可展示的新专辑', {
            error: true,
            retry: loadNewSongDiscovery,
        });
        return;
    }

    const fragment = document.createDocumentFragment();
    albumList.forEach((album, index) => {
        fragment.appendChild(createCollectionCard(album, {
            description: album.artist,
            tone: EDITORIAL_PLAYLISTS[index % EDITORIAL_PLAYLISTS.length].tone,
            type: 'album',
        }));
    });
    dom.newAlbumGrid.replaceChildren(fragment);
    dom.newAlbumGrid.setAttribute('aria-busy', 'false');
}

async function resolveAlbumTracks(collection) {
    if (collection.resolvedTracks?.length) return collection.resolvedTracks;
    const fallbackTracks = collection.tracks || [];
    try {
        const source = musicService.config.source === 'bilibili' ? 'gd' : musicService.config.source;
        const results = await musicService.search(`${collection.name} ${collection.artist || ''}`.trim(), { source });
        const expectedAlbum = collection.name.toLocaleLowerCase();
        const exactMatches = results.filter(song =>
            String(song.album || '').trim().toLocaleLowerCase() === expectedAlbum
        );
        collection.resolvedTracks = exactMatches.length ? exactMatches.slice(0, 30) : fallbackTracks;
    } catch (error) {
        console.warn('专辑曲目补全失败，使用榜单曲目:', error);
        collection.resolvedTracks = fallbackTracks;
    }
    return collection.resolvedTracks;
}

function collectionSource(type) {
    return type === 'album' ? 'new-album' : 'editorial-playlist';
}

function normalizedCollectionTracks(tracks, source) {
    const uniqueTracks = [];
    const ids = new Set();
    tracks.forEach(song => {
        const id = String(song?.catalogId || song?.id || '').trim();
        if (!id || ids.has(id)) return;
        ids.add(id);
        uniqueTracks.push({
            ...song,
            id,
            sourceId: song.sourceId || song.id,
            name: song.name || '未知歌曲',
            artist: song.artist || '未知艺术家',
            cover: song.cover || '',
            album: song.album || '',
            source,
            provider: song.provider,
        });
    });
    return uniqueTracks;
}

function setCollectionDialogStatus(message, { loading = false, error = false, retry = null } = {}) {
    dom.collectionTrackList.setAttribute('aria-busy', String(loading));
    dom.collectionTrackCount.textContent = loading ? '加载中' : '0首';
    dom.collectionPlayAll.disabled = true;
    dom.collectionAddAll.disabled = true;

    const status = document.createElement('div');
    status.className = `collection-library-status${error ? ' is-error' : ''}`;
    status.setAttribute('role', 'status');
    const icon = document.createElement('i');
    icon.className = loading ? 'fas fa-spinner fa-spin' : (error ? 'fas fa-exclamation-circle' : 'fas fa-compact-disc');
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = message;
    status.append(icon, label);

    if (retry) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.textContent = '重新加载';
        retryButton.addEventListener('click', retry);
        status.appendChild(retryButton);
    }
    dom.collectionTrackList.replaceChildren(status);
}

function renderCollectionTrackList(tracks) {
    const fragment = document.createDocumentFragment();
    const fallbackCover = collectionDialogState.type === 'album' ? collectionDialogState.collection?.cover : '';

    tracks.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'collection-track-row';
        row.setAttribute('role', 'listitem');

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'collection-track-play';
        playButton.setAttribute('aria-label', `播放 ${song.name} - ${song.artist}`);

        const number = document.createElement('span');
        number.className = 'collection-track-number';
        number.textContent = String(index + 1).padStart(2, '0');

        const cover = document.createElement('span');
        cover.className = 'collection-track-cover';
        const image = document.createElement('img');
        image.alt = ''; image.width = image.height = 48; image.loading = 'lazy';
        bindArtwork(image, song, { url: song.cover || fallbackCover, size: 192 });
        cover.appendChild(image);

        const copy = document.createElement('span');
        copy.className = 'collection-track-copy';
        const title = document.createElement('strong');
        title.textContent = song.name;
        title.title = song.name;
        const artist = document.createElement('span');
        artist.textContent = song.artist;
        artist.title = song.artist;
        copy.append(title, artist);

        const album = document.createElement('span');
        album.className = 'collection-track-album';
        album.textContent = song.album || '单曲';
        album.title = album.textContent;
        playButton.append(number, cover, copy, album);
        playButton.addEventListener('click', () => {
            addCollectionTracks([song], {
                label: song.name,
                playNow: true,
                source: song.source,
            });
            dom.collectionDialog.close('play');
        });

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'collection-track-add';
        addButton.setAttribute('aria-label', `将 ${song.name} 加入播放队列`);
        addButton.title = '加入播放队列';
        const addIcon = document.createElement('i');
        addIcon.className = 'fas fa-plus';
        addIcon.setAttribute('aria-hidden', 'true');
        addButton.appendChild(addIcon);
        addButton.addEventListener('click', () => {
            addCollectionTracks([song], {
                label: song.name,
                playNow: false,
                source: song.source,
            });
        });

        row.append(playButton, addButton);
        fragment.appendChild(row);
    });

    dom.collectionTrackList.replaceChildren(fragment);
    dom.collectionTrackList.setAttribute('aria-busy', 'false');
    dom.collectionTrackCount.textContent = `${tracks.length}首`;
    dom.collectionPlayAll.disabled = !tracks.length;
    dom.collectionAddAll.disabled = !tracks.length;
}

async function loadCollectionDialogTracks(version) {
    const { collection, type } = collectionDialogState;
    if (!collection) return;
    setCollectionDialogStatus(type === 'album' ? '正在整理专辑曲目…' : '正在打开歌单…', { loading: true });

    try {
        const source = collectionSource(type);
        const rawTracks = type === 'album'
            ? await resolveAlbumTracks(collection)
            : collection.tracks;
        if (version !== collectionDialogState.version || !dom.collectionDialog.open) return;
        const tracks = normalizedCollectionTracks(rawTracks || [], source);
        collectionDialogState.tracks = tracks;
        if (type === 'album' && tracks.length) {
            const seed = { ...tracks[0], cover: collection.cover || tracks[0].cover, album: collection.name };
            bindArtwork(dom.collectionDialogCover, seed, { size: 720 });
        }
        if (!tracks.length) {
            setCollectionDialogStatus(`这个${type === 'album' ? '专辑' : '歌单'}暂时没有可播放曲目`);
            return;
        }
        renderCollectionTrackList(tracks);
    } catch (error) {
        if (version !== collectionDialogState.version || !dom.collectionDialog.open) return;
        console.error('专辑曲目加载失败:', error);
        setCollectionDialogStatus('曲目加载失败，请重试', {
            error: true,
            retry: () => loadCollectionDialogTracks(collectionDialogState.version),
        });
    }
}

function openCollectionDialog(collection, { type = 'playlist', opener = null } = {}) {
    if (!collection?.tracks?.length) {
        showToast(`${collection?.name || '当前专辑'} 暂无可播放曲目`, true);
        return;
    }

    const version = collectionDialogState.version + 1;
    collectionDialogState = { collection, type, tracks: [], opener, version };
    const typeLabel = type === 'album' ? '专辑' : '歌单';
    const owner = type === 'album'
        ? (collection.artist || '未知艺术家')
        : (collection.creator || '网易云音乐');
    const declaredCount = Number(collection.trackCount) || collection.tracks.length;
    document.getElementById('collectionSavePersonal')?.remove();
    const savePersonal = document.createElement('button'); savePersonal.id = 'collectionSavePersonal'; savePersonal.type = 'button'; savePersonal.className = 'collection-library-secondary'; savePersonal.textContent = '收藏' + typeLabel;
    savePersonal.addEventListener('click', () => personalLibrary?.collect({ ...collection, type, provider: 'netease' }));
    document.querySelector('.collection-library-actions')?.append(savePersonal);
    dom.collectionDialogTitle.textContent = collection.name || `${typeLabel}音乐库`;
    dom.collectionDialogMeta.textContent = `${typeLabel} · ${owner} · ${declaredCount}首`;
    bindArtwork(dom.collectionDialogCover, { name: collection.name, cover: collection.cover }, { size: 720 });
    dom.collectionDialogCover.alt = `${collection.name || typeLabel}封面`;
    dom.collectionDialog.returnValue = '';
    if (!dom.collectionDialog.open) dom.collectionDialog.showModal();
    loadCollectionDialogTracks(version);
}

function runCollectionDialogAction(playNow) {
    const { collection, tracks, type } = collectionDialogState;
    if (!collection || !tracks.length) return;
    addCollectionTracks(tracks, {
        label: collection.name,
        playNow,
        source: collectionSource(type),
    });
    if (playNow) dom.collectionDialog.close('play-all');
}

async function handleCollectionAction(collection, { playNow, trigger }) {
    if (!collection?.tracks?.length || !trigger || trigger.disabled) return;
    const icon = trigger.querySelector('i');
    const iconClass = icon?.className || '';
    trigger.disabled = true;
    trigger.setAttribute('aria-busy', 'true');
    if (icon) icon.className = 'fas fa-spinner fa-spin';

    try {
        const tracks = collection.type === 'album'
            ? await resolveAlbumTracks(collection)
            : collection.tracks;
        addCollectionTracks(tracks, {
            label: collection.name,
            playNow,
            source: collection.type === 'album' ? 'new-album' : 'editorial-playlist',
        });
    } finally {
        trigger.disabled = false;
        trigger.removeAttribute('aria-busy');
        if (icon) icon.className = iconClass;
    }
}

function addCollectionTracks(tracks, { label, playNow, source }) {
    const uniqueTracks = normalizedCollectionTracks(tracks, source);
    if (!uniqueTracks.length) {
        showToast(`${label} 暂无可播放曲目`, true);
        return;
    }

    const firstSongId = String(uniqueTracks[0].id);
    const existingIds = new Set(queue.playlist.map(song => String(song.id)));
    const additions = uniqueTracks.filter(song => !existingIds.has(String(song.id)));

    if (additions.length) {
        if (!queue.playlist.length) {
            const [firstSong, ...remaining] = additions;
            window.insertSongToPlaylist(firstSong);
            [...remaining].reverse().forEach(song => window.insertSongToPlaylist(song));
        } else {
            [...additions].reverse().forEach(song => window.insertSongToPlaylist(song));
        }
        playlistTotalCount = queue.playlist.length;
        allSongsLoaded = true;
        renderAllPlaylistItems();
        if (mobileUI) mobileUI.loadPlaylist();
        if (dom.playlistCount) dom.playlistCount.textContent = `(${queue.playlist.length}首)`;
    }

    const targetIndex = queue.playlist.findIndex(song => String(song.id) === firstSongId);
    if (playNow && targetIndex >= 0) window.playSongAtIndex(targetIndex);
    const action = playNow ? '已加入队列，正在加载' : '已加入队列';
    const suffix = additions.length ? ` · ${additions.length}首` : ' · 已在队列中';
    showToast(`${action}：${label}${suffix}`);
}

// ★ Helper for MediaSession
function updateMediaSessionMetadata(data) {
    audio.setArtwork?.(data, data.cover);
    if (!('mediaSession' in navigator)) return;
    if (audio.usesNativeSession) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
    }

    const artwork = [];
    if (data.cover) {
        const src = normalizeMediaUrl(data.cover, { allowDataImage: true, baseUrl: window.location.href });
        if (src) artwork.push({ src, sizes: 'any' });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
        title: data.name || '未知歌曲',
        artist: data.artist || '未知艺术家',
        album: data.album || 'ZPlayer',
        artwork: artwork
    });
}

async function loadAndPlaySong(id, songOverride = null, {position = 0} = {}) {
    if (accountPanel?.canEnter && !accountPanel.canEnter()) return;
    discoveryHome?.beforePlay(songOverride);
    return playback.load(id, songOverride, {
        onLoading() {
            playerSourceUI?.close();
            playerSourceUI?.sync();
            artworkRecoveryUI?.update(songOverride || { id });
            queueStore.select(songOverride || { id });
            mobileUI?.syncCoverCarousel({ song: songOverride || { id }, loading: true });
            artworkPresenter.reset(songOverride || { id });
            playerExperience?.loading(songOverride || { id }, () => loadAndPlaySong(id, songOverride, { position }));
            discoveryLoadingSong = songOverride;
            setPlaybackTransitionPending(false);
    dom.playbackQualityDialog?.removeAttribute('aria-busy');
    if (dom.desktopLoaderOverlay) dom.desktopLoaderOverlay.classList.remove('opacity-0');
    if (dom.mobileLoaderOverlay) dom.mobileLoaderOverlay.classList.remove('opacity-0');
    dom.progressBar.style.width = '0%';
    dom.progressBarContainer?.setAttribute('aria-valuenow', '0');
    dom.currentTime.textContent = playback.state.currentSong ? '0:00' : '--:--';
    dom.totalTime.textContent = '--:--';
    updateDoraemonProgress(0, 0, 0);
    resetBufferedProgress();
    if (mobileUI) mobileUI.updateProgress(0, 0, 0);
    setLyricsStatus('加载中...');
    if (songOverride) lyricEffects?.prepare(songOverride);
    dom.sourceTag.textContent = musicSourceOption(playback.state.currentSong?.provider || musicService.config.source).label;
    dom.desktopPlayerBar?.classList.add('is-buffering');
    discoveryTable?.sync();
    dom.songIdTag.textContent = 'ID: —';
    syncPlaybackQualityDisplay(musicService.config.quality);

        },
        onAttempt(info) {
            const label = lxSourceLabel(info.provider) || musicSourceOption(info.provider).label;
            playerExperience?.recovering(info.stage === 'matching' ? `正在查找同一版本 · ${label}` : `正在尝试 ${label} · ${qualityDetails(info.level).name}`);
        },
        onRecovering(info) { playerExperience?.recovering(info.reason); },
        onSourceSwitched(info) { showToast(t('sourceSwitched', { source: lxSourceLabel(info.to) || musicSourceOption(info.to).label })); },
        onResolved(data, playbackData) {
            artworkRecoveryUI?.update(playbackData);
            mobileUI?.syncCoverCarousel({ song: playbackData });
            audio.setMetadata?.(playbackData);
            // Restore lyrics before audio preparation or the online lyric request can wait.
            lyricEffects?.prepare(playbackData);
            playerExperience?.resolved(playbackData);
            syncQueueActions();
            discoveryLoadingSong = null;
            discoveryTable?.sync();
            syncDesktopPlayerAvailability();
            dom.songTitle.textContent = data.name || '未知歌曲';
            dom.artistName.textContent = data.artist || '未知艺术家';
        },
        onAutoplayBlocked() {
            playerExperience?.blocked();
            dom.desktopPlayerBar?.classList.remove('is-buffering');
            syncPlaybackControls(false);
            showToast('歌曲已加载，请点击播放键继续');
        },
        onStarted(data, playbackData, session) {
            playerExperience?.started();
            playerSourceUI?.sync();
            const { isCurrent } = session;
            if (position > 0 && !session.recovering) {
                const resume = () => {
                    if (isCurrent() && Number.isFinite(audio.duration)) audio.currentTime = position >= audio.duration - 2 ? 0 : Math.min(position, Math.max(0,audio.duration - 1));
                };
                if (audio.readyState >= 1) resume();
                else audio.addEventListener('loadedmetadata', resume, {once:true,signal:session.signal});
            }
        // Show ID
        dom.songIdTag.textContent = `ID: ${data.id}`;

        // ★ 显示音质标识
        const qualityInfo = getQualityBadge(data.url, data.br || data.bitrate, data.level);
        if (qualityInfo) {
            syncPlaybackQualityDisplay(qualityInfo.level);
        }
        dom.sourceTag.textContent = playbackDetailText(playbackData, qualityInfo?.level || data.level);

        // Artwork resolves asynchronously; audio and lyrics never wait for it.
        void artworkPresenter.show(playbackData, session);

        if (queueStore.select(songOverride || { id }) >= 0) {
            highlightCurrentSong();
        }

        // ★ Mobile UI Updates
        if (mobileUI) {
            mobileUI.updateInfo(playbackData.name, playbackData.artist, null, { signal: session.signal });
            if (!session.recovering) { mobileUI.resetView(); mobileUI.closeSheet(); }
        }


        },
        onPreload: preloadNextSong,
        onSourceRestored() { playerExperience?.started(); },
        onLyrics(qjLyrics, data, playbackData) {
            const lrc = qjLyrics?.lrc || data.lrc || '';
            const tlrc = qjLyrics?.tlrc || data.tlrc || '';
            if (playbackData.provider === 'bilibili') {
                if (!lrc) {
                    if (lyricEffects?.refreshFailed()) return;
                    const messages = {
                        login_required: '此视频字幕需要登录 Bilibili',
                        restricted: '此视频字幕暂不开放',
                        error: `字幕加载失败：${qjLyrics?.message || '请稍后重试'}`,
                    };
                    setLyricsStatus(messages[qjLyrics?.status] || '该视频没有可公开读取的字幕');
                    return;
                }
                parseLyrics(lrc, tlrc, qjLyrics);
                [dom.desktopSubtitleSource, dom.mobileSubtitleSource].filter(Boolean).forEach(label => {
                    label.textContent = ['Bilibili 视频字幕', qjLyrics.language, qjLyrics.autoGenerated ? '自动生成' : ''].filter(Boolean).join(' · ');
                    label.hidden = false;
                });
                return;
            }
            parseLyrics(lrc, tlrc, qjLyrics);
        },
        onLyricsError() { if (!lyricEffects?.refreshFailed()) setLyricsStatus('歌词加载失败，请稍后重试'); },
        onError(e) {
        playerExperience?.failed(requestErrorMessage(e));
        discoveryHome?.playbackFailed(e);
        console.error(e);
        setPlaybackTransitionPending(false);
        syncPlaybackControls(false);
        showToast(e?.code === 'gd_error' || e?.code === 'chksz_error'
            ? requestErrorMessage(e) : '无法播放该歌曲 (版权限制或接口无响应)', true);
        setLyricsStatus('播放失败');
        // ★ Fix: 错误时也要关闭移动端播放列表弹窗，防止卡住
        if (mobileUI) {
            mobileUI.closeSheet();
        }
        },
        onSettled() {
            playerSourceUI?.sync();
            mobileUI?.syncCoverCarousel({ loading: false });
            discoveryLoadingSong = null;
            dom.desktopPlayerBar?.classList.remove('is-buffering');
            discoveryTable?.sync();
            if (dom.desktopLoaderOverlay) dom.desktopLoaderOverlay.classList.add('opacity-0');
            if (dom.mobileLoaderOverlay) dom.mobileLoaderOverlay.classList.add('opacity-0');
        },
    });
}

function updatePlayerState() {
    const state = getPlaybackProgressState(audio.currentTime, audio.duration);
    dom.progressBar.style.width = `${state.progress}%`;
    dom.currentTime.textContent = formatTime(state.currentTime);
    dom.totalTime.textContent = state.duration > 0 ? formatTime(state.duration) : '--:--';
    updateDoraemonProgress(state.progress, state.currentTime, state.duration);

    // ★ Mobile Update
    if (mobileUI) mobileUI.updateProgress(state.currentTime, state.duration, state.progress);

    if (state.duration) updateLyrics(state.currentTime);
}

function seekAudio(e) {
    if (!audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
}

function seekAudioByKeyboard(event) {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

    let targetTime;
    switch (event.key) {
        case 'ArrowLeft':
            targetTime = audio.currentTime - 5;
            break;
        case 'ArrowRight':
            targetTime = audio.currentTime + 5;
            break;
        case 'Home':
            targetTime = 0;
            break;
        case 'End':
            targetTime = audio.duration;
            break;
        default:
            return;
    }

    event.preventDefault();
    audio.currentTime = Math.max(0, Math.min(audio.duration, targetTime));
    updatePlayerState();
}

// ================= 歌词逻辑 =================

// 解析普通LRC歌词
function parseLrc(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const res = [];
    const regex = /^\[(\d{1,3}):(\d{1,2})(\.\d{1,3})?\](.*)/;

    for (let line of lines) {
        line = line.trim();
        // 跳过JSON元数据
        if (line.startsWith('{')) continue;

        const match = line.match(regex);
        if (match) {
            const min = parseInt(match[1]);
            const sec = parseInt(match[2]);
            const msStr = match[3] ? match[3].substring(1) : '0';
            const ms = parseInt(msStr.padEnd(3, '0').substring(0, 3));
            const time = min * 60 + sec + ms / 1000;
            const content = match[4].trim();
            if (content) res.push({ time, text: content });
        }
    }
    return res.sort((a, b) => a.time - b.time);
}

function setLyricsStatus(message) {
    listeningRoom?.resetLyrics();
    lyricEffects?.resetLyrics?.();
    parsedLyrics = [];
    activeLyricIndex = -1;
    [dom.desktopSubtitleSource, dom.mobileSubtitleSource].filter(Boolean).forEach(label => {
        label.hidden = true;
        label.textContent = '';
    });
    for (const id of ['lyricsScroller', 'mobileLyricsScroller']) {
        const scroller = document.getElementById(id);
        if (!scroller) continue;
        const status = document.createElement('div');
        status.className = 'lrc-line active lyrics-status';
        status.setAttribute('role', 'status');
        status.textContent = message;
        scroller.replaceChildren(status);
        scroller.scrollTop = 0;
    }
    lyricEffects?.status(message);
}

function parseLyrics(lrc, tlrc, payload = {}) {
    // 解析普通歌词和翻译
    const origin = parseLrc(lrc);
    const trans = parseLrc(tlrc);

    // 创建翻译映射，使用更宽松的时间匹配（0.5秒容差）
    const findTranslation = (time) => {
        if (!trans || trans.length === 0) return null;

        // 精确匹配
        const exact = trans.find(t => Math.abs(t.time - time) < 0.5);
        if (exact) return exact.text;

        // 尝试四舍五入匹配
        const rounded = trans.find(t => t.time.toFixed(0) === time.toFixed(0));
        if (rounded) return rounded.text;

        return null;
    };

    parsedLyrics = origin.map(item => {
        const tText = findTranslation(item.time);

        return {
            time: item.time,
            text: item.text,
            translation: tText || null
        };
    });
    renderLyrics();
    lyricEffects?.load({ ...payload, lrc, tlrc, source: payload?.source || musicSourceOption(playback.state.currentSong?.provider || musicService.config.source).label }, playback.state.currentSong || {});
}

function renderLyrics() {
    listeningRoom?.resetLyrics();
    lyricEffects?.resetLyrics?.(true);
    // Keep text content separate from its playback timing.
    const scroller = document.getElementById('lyricsScroller');
    const mobileScroller = document.getElementById('mobileLyricsScroller'); // ★ Mobile

    if (scroller) scroller.innerHTML = '';
    if (mobileScroller) mobileScroller.innerHTML = '';

    if (!parsedLyrics.length) {
        const emptyHTML = '<div class="lrc-line active"><span class="lrc-text">纯音乐 / 暂无歌词</span></div>';
        if (scroller) scroller.innerHTML = emptyHTML;
        if (mobileScroller) mobileScroller.innerHTML = emptyHTML;
        return;
    }

    const frag = document.createDocumentFragment();
    // Clone for mobile
    const mobileFrag = document.createDocumentFragment();

    parsedLyrics.forEach((line, idx) => {
        const div = document.createElement('div');
        div.className = 'lrc-line';
        div.dataset.time = line.time;
        div.dataset.idx = idx;
        div.setAttribute('role', 'button');
        div.tabIndex = idx === 0 ? 0 : -1;
        div.setAttribute('aria-label', `跳转到 ${formatTime(line.time)}：${line.text}`);

        // Click to seek
        div.onclick = () => {
            audio.currentTime = line.time;
            audio.play().catch(() => showToast('请点击播放键继续'));
        };
        div.onkeydown = event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); div.click(); }
        };

        const spanMain = document.createElement('span');
        spanMain.className = 'lrc-text';
        spanMain.textContent = line.text;
        div.appendChild(spanMain);

        if (line.translation) {
            const spanTrans = document.createElement('span');
            spanTrans.className = 'lrc-trans';
            spanTrans.textContent = line.translation;
            div.appendChild(spanTrans);
        }

        frag.appendChild(div);
        // Mobile uses same structure, clone it
        // We need to re-attach event listener because cloneNode doesn't copy events
        const mobileDiv = div.cloneNode(true);
        mobileDiv.onclick = () => {
            // Prevent jump if mobile playlist sheet is open
            if (mobileUI && mobileUI.dom.sheet.classList.contains('translate-y-0')) return;

            audio.currentTime = line.time;
            audio.play().catch(() => showToast('请点击播放键继续'));
        };
        mobileDiv.onkeydown = event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mobileDiv.click(); }
        };
        mobileFrag.appendChild(mobileDiv);
    });

    if (scroller) scroller.appendChild(frag);
    if (mobileScroller) mobileScroller.appendChild(mobileFrag);

    activeLyricIndex = -1;
}

function updateLyrics(time) {
    if (lyricEffects?.handlesTiming) return;
    if (!parsedLyrics.length) return;

    // 1. Find active index with binary search; timeupdate fires frequently.
    const targetTime = time + 0.3;
    let low = 0;
    let high = parsedLyrics.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (parsedLyrics[middle].time <= targetTime) low = middle + 1;
        else high = middle;
    }
    const idx = Math.max(0, low - 1);

    // 2. Update if changed
    if (idx !== activeLyricIndex) {
        const previousIndex = activeLyricIndex;
        activeLyricIndex = idx;

        const updateScroller = (scrollerId) => {
            const scroller = document.getElementById(scrollerId);
            if (!scroller) return;

            const lines = scroller.getElementsByClassName('lrc-line');
            new Set([
                previousIndex - 1,
                previousIndex,
                previousIndex + 1,
                idx - 1,
                idx,
                idx + 1,
            ]).forEach(lineIndex => {
                const line = lines[lineIndex];
                if (line) {
                    lyricEffects?.deactivateLine?.(line);
                    line.classList.remove('active', 'near');
                    line.removeAttribute('aria-current');
                    line.tabIndex = -1;
                }
            });

            if (lines[idx]) {
                lines[idx - 1]?.classList.add('near');
                lines[idx].classList.add('active');
                lines[idx].setAttribute('aria-current', 'true');
                lines[idx].tabIndex = 0;
                lyricEffects?.activateLine(lines[idx]);
                lines[idx + 1]?.classList.add('near');

                // Scroll logic
                const containerHeight = scroller.clientHeight;
                const lineTop = lines[idx].offsetTop;
                const lineHeight = lines[idx].clientHeight;
                const targetScroll = lineTop - containerHeight * 0.36 + lineHeight * 0.36;

                if (listeningRoom) listeningRoom.follow(scrollerId, targetScroll);
                else scroller.scrollTo({
                    top: targetScroll,
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
                });
            }
        };

        updateScroller('lyricsScroller');
        updateScroller('mobileLyricsScroller'); // ★ Mobile Sync
    }
}



// ================= 歌单逻辑 =================
let currentPlaylistId = localStorage.getItem('cp_playlistId') || '';
let playlistTotalCount = 0;
let isLoadingPlaylist = false;
let allSongsLoaded = false;
const EMPTY_PLAYLIST_MESSAGE = '当前没有歌曲，请使用搜索添加';

// 歌单来源追踪: 'local' | 'online' | 'cache' | 'import-js' | 'import-json' | ''
let playlistSource = '';
let playlistSourceName = ''; // 用于显示的附加信息（如歌单ID、文件名）

// 歌单服务 - ChKSz API（无分页，一次获取全部）
class PlaylistService {
    static async fetchPlaylist(listId) {
        const collection = await musicService.getPlaylistCollection(listId);
        return collection?.tracks || [];
    }
}

function handlePlaylistUpload(e) {
    handlePlaylistFile(e.target.files[0]);
}

function handlePlaylistFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data)) {
                // 支持旧格式（纯ID数组）
                queue.playlist = data.map(item => {
                    if (typeof item === 'object') return item;
                    return { id: String(item), name: `歌曲 ID: ${item}`, artist: '' };
                });
                queue.currentIndex = -1;
                playlistTotalCount = queue.playlist.length;
                allSongsLoaded = true;
                playlistSource = 'import-json';
                playlistSourceName = file.name;
                initPlaylistView();
                mobileUI?.loadPlaylist();
                dom.uploadContainer.classList.add('hidden');
                // dom.playlistInfo.classList.remove('hidden');
            }
        } catch (err) {
            showToast('歌单格式错误', true);
        }
    };
    reader.readAsText(file);
}

// 加载指定歌单
async function loadPlaylistById(listId, { cachedOnly = false, canApply = () => true, startup = false } = {}) {
    currentPlaylistId = listId;
    localStorage.setItem('cp_playlistId', listId);

    if (!startup) {
        queue.playlist = [];
        queue.currentIndex = -1;
        allSongsLoaded = false;
        renderedCount = 0;

        dom.uploadContainer.classList.add('hidden');
        dom.playlistContent.innerHTML = '<div class="text-center py-4 opacity-50"><i class="fas fa-spinner fa-spin mr-2"></i>正在加载歌单...</div>';
        document.getElementById('playlistCount').textContent = '(加载中...)';
    }

    // ★ 先尝试从 IndexedDB 缓存加载
    try {
        const cached = await getPlaylistFromCache(listId);
        if (!canApply()) return false;
        if (cached && cached.songs && cached.songs.length > 0) {
            console.log('💾 从缓存加载歌单:', cached.songs.length, '首');
            queue.playlist = cached.songs;
            window.playlist = queue.playlist;
            playlistTotalCount = queue.playlist.length;
            allSongsLoaded = true;
            playlistSource = 'cache';
            playlistSourceName = listId;
            initPlaylistView();
            document.getElementById('playlistCount').textContent = `(${queue.playlist.length}首)`;

            // 后台静默更新缓存
            if (!cachedOnly) setTimeout(() => refreshPlaylistInBackground(listId, startup ? () => playlistSource === 'cache' && queue.playlist === cached.songs : canApply), 5000);
            return true;
        }
    } catch (e) {
        console.warn('缓存读取失败:', e);
    }

    // GD 启动只恢复本地歌单，不依赖 ChKSz。
    if (cachedOnly || !canApply()) return false;
    return fetchAndLoadPlaylist(listId, canApply);
}

// 后台静默更新歌单缓存
async function refreshPlaylistInBackground(listId, canApply) {
    console.log('🔄 后台更新播放列表缓存...');
    try {
        const freshSongs = await PlaylistService.fetchPlaylist(listId);
        if (freshSongs.length > 0) {
            await savePlaylistToCache(listId, freshSongs);
            console.log('✅ 播放列表缓存已更新:', freshSongs.length, '首');
            if (!canApply()) return;
            // 后台更新成功后，来源标记为在线
            if (playlistSource === 'cache') {
                playlistSource = 'online';
                playlistSourceName = listId;
            }
            if (freshSongs.length !== queue.playlist.length) {
                document.getElementById('playlistCount').textContent = `(${freshSongs.length}首)`;
            }
        }
    } catch (e) {
        console.warn('后台更新失败:', e);
    }
}

// 从 API 获取并加载歌单（单次请求）
async function fetchAndLoadPlaylist(listId, canApply) {
    isLoadingPlaylist = true;
    try {
        const songs = await PlaylistService.fetchPlaylist(listId);
        if (!canApply()) return false;

        if (songs.length === 0) {
            throw new Error('歌单为空或不存在');
        }

        queue.playlist = songs;
        window.playlist = queue.playlist;
        playlistTotalCount = queue.playlist.length;
        allSongsLoaded = true;
        playlistSource = 'online';
        playlistSourceName = listId;

        document.getElementById('playlistCount').textContent = `(${queue.playlist.length}首)`;
        initPlaylistView();

        // ★ 保存到 IndexedDB 缓存
        await savePlaylistToCache(listId, queue.playlist);
        console.log('💾 播放列表已缓存:', songs.length, '首');
        return true;
    } catch (e) {
        if (!canApply()) return false;
        console.error('播放列表加载失败:', e);
        showToast('播放列表加载失败，请检查歌单ID是否正确', true);
        throw e;
    } finally {
        isLoadingPlaylist = false;
        const loader = document.getElementById('playlistLoader');
        if (loader) loader.classList.add('hidden');
    }
}

async function loadDefaultPlaylist(canApply) {
    if (!canApply()) return;
    // 优先级: 1. LOCAL_PLAYLIST → 2. localStorage → 3. 空播放列表

    // 1. 本地 playlist.js
    if (window.LOCAL_PLAYLIST && window.LOCAL_PLAYLIST.data && window.LOCAL_PLAYLIST.data.tracks) {
        console.log('📂 加载本地 playlist.js');
        const tracks = window.LOCAL_PLAYLIST.data.tracks;
        queue.playlist = tracks.map(item => ({
            id: item.id,
            name: item.name,
            artist: item.artists || 'Unknown',
            cover: item.picUrl || '',
            album: item.album || ''
        }));
        window.playlist = queue.playlist;
        playlistTotalCount = queue.playlist.length;
        allSongsLoaded = true;
        playlistSource = 'local';
        playlistSourceName = window.LOCAL_PLAYLIST.title || 'playlist.js';
        initPlaylistView();
        dom.uploadContainer.classList.add('hidden');
        return;
    }

    // 2. localStorage 保存的ID（用户之前成功加载过的）
    const savedId = localStorage.getItem('cp_playlistId');
    if (savedId) {
        console.log('💾 使用已保存的歌单ID:', savedId);
        const input = document.getElementById('playlistIdInput');
        if (input) input.value = savedId;
        try {
            const restored = await loadPlaylistById(savedId, { cachedOnly: musicService.config.source !== 'chksz', canApply, startup: true });
            if (restored) return;
        } catch (e) {
            console.error('已保存的歌单加载失败:', e);
        }
    }

    if (!canApply()) return;

    // 3. 没有任何歌单来源 → 直接进入播放器，通过搜索添加歌曲
    console.log('🎵 未配置歌单，直接进入播放器');
    queue.playlist = [];
    window.playlist = queue.playlist;
    playlistTotalCount = 0;
    allSongsLoaded = true;
    playlistSource = '';
    playlistSourceName = '';
    initPlaylistView();
}

// 从输入值中提取歌单 ID（支持纯数字、完整链接）
function extractPlaylistId(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/(\d{5,})/);
    return m ? m[1] : '';
}

// 解析 playlist.js 文件内容（window.LOCAL_PLAYLIST = {...};）
function parsePlaylistJsContent(text) {
    // 尝试提取 JSON 对象
    const match = text.match(/window\.LOCAL_PLAYLIST\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (match) {
        try {
            const obj = JSON.parse(match[1]);
            if (obj && obj.data && Array.isArray(obj.data.tracks)) {
                return obj.data.tracks.map(item => ({
                    id: item.id,
                    name: item.name || '未知歌曲',
                    artist: typeof item.artists === 'string'
                        ? item.artists
                        : (Array.isArray(item.artists)
                            ? item.artists.map(a => typeof a === 'string' ? a : a.name).join('/')
                            : (Array.isArray(item.ar) ? item.ar.map(a => a.name).join('/') : 'Unknown')),
                    cover: item.picUrl || (item.al ? item.al.picUrl : '') || '',
                    album: typeof item.album === 'string'
                        ? item.album
                        : (item.album?.name || item.al?.name || '')
                }));
            }
        } catch (e) {
            console.warn('playlist.js JSON parse failed:', e);
        }
    }
    return null;
}

// 处理导入的文件（.js 或 .json）
function handleImportedFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const isJs = file.name.endsWith('.js');

        if (isJs) {
            const tracks = parsePlaylistJsContent(text);
            if (tracks && tracks.length > 0) {
                queue.playlist = tracks;
                window.playlist = queue.playlist;
                queue.currentIndex = -1;
                playlistTotalCount = queue.playlist.length;
                allSongsLoaded = true;
                playlistSource = 'import-js';
                playlistSourceName = file.name;
                initPlaylistView();
                showToast(`已导入 ${queue.playlist.length} 首歌曲`);
                closeSettings();
                return;
            }
            showToast('无法解析该 .js 文件，请确认格式正确', true);
            return;
        }

        // JSON 格式
        handlePlaylistFile(file);
        closeSettings();
    };
    reader.readAsText(file);
}

// 手动加载歌单按钮事件
function setupPlaylistIdLoader() {
    const btn = document.getElementById('loadPlaylistBtn');
    const input = document.getElementById('playlistIdInput');
    const feedback = document.getElementById('playlistIdFeedback');

    if (btn && input) {
        const clearError = () => {
            input.removeAttribute('aria-invalid');
            if (feedback) {
                feedback.hidden = true;
                feedback.textContent = '';
            }
        };
        btn.onclick = () => {
            const id = extractPlaylistId(input.value);
            if (id) {
                clearError();
                loadPlaylistById(id);
                closeSettings();
            } else {
                input.setAttribute('aria-invalid', 'true');
                if (feedback) {
                    feedback.hidden = false;
                    feedback.textContent = '请输入至少 5 位数字的网易云歌单 ID，或包含歌单 ID 的链接。';
                }
                input.focus();
            }
        };

        input.oninput = clearError;
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                btn.click();
            }
        };
    }

    // 设置模态框内的拖拽区域
    const dropZone = document.getElementById('settingsDropZone');
    const fileInput = document.getElementById('settingsFileInput');

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) handleImportedFile(e.target.files[0]);
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-primary-color/60', 'bg-white/[0.06]');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('border-primary-color/60', 'bg-white/[0.06]');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-primary-color/60', 'bg-white/[0.06]');
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.js') || file.name.endsWith('.json'))) {
                handleImportedFile(file);
            } else {
                showToast('请拖入 .js 或 .json 文件', true);
            }
        });
    }

    // 全局拖拽支持（拖文件到页面任意位置）
    setupGlobalDragDrop();
}

// 全局拖拽覆盖层
function setupGlobalDragDrop() {
    let dragOverlay = null;
    let dragCounter = 0;

    function createOverlay() {
        if (dragOverlay) return dragOverlay;
        dragOverlay = document.createElement('div');
        dragOverlay.id = 'globalDropOverlay';
        dragOverlay.style.cssText = `
            position: fixed; inset: 0; z-index: 9999;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.25s ease;
            pointer-events: none;
        `;
        dragOverlay.innerHTML = `
            <div style="text-align:center; color:#fff;">
                <i class="fas fa-file-import" style="font-size:48px; opacity:0.7; margin-bottom:16px; display:block;"></i>
                <div style="font-size:18px; font-weight:700; margin-bottom:6px;">释放以导入歌单</div>
                <div style="font-size:13px; opacity:0.5;">支持 playlist.js 和 .json 文件</div>
            </div>
        `;
        document.body.appendChild(dragOverlay);
        return dragOverlay;
    }

    document.addEventListener('dragenter', (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragCounter++;
        const overlay = createOverlay();
        overlay.style.pointerEvents = 'auto';
        requestAnimationFrame(() => overlay.style.opacity = '1');
    });

    document.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
    });

    document.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (dragOverlay) {
                dragOverlay.style.opacity = '0';
                dragOverlay.style.pointerEvents = 'none';
            }
        }
    });

    document.addEventListener('drop', (e) => {
        dragCounter = 0;
        if (dragOverlay) {
            dragOverlay.style.opacity = '0';
            dragOverlay.style.pointerEvents = 'none';
        }

        const file = e.dataTransfer && e.dataTransfer.files[0];
        if (!file) return;

        // 如果拖到了设置模态框里的 dropZone，让那边的 handler 处理
        const settingsDropZone = document.getElementById('settingsDropZone');
        if (settingsDropZone && settingsDropZone.contains(e.target)) return;

        e.preventDefault();
        if (file.name.endsWith('.js') || file.name.endsWith('.json')) {
            handleImportedFile(file);
        } else {
            showToast('不支持的文件格式，请使用 .js 或 .json', true);
        }
    });
}

// ================= 欢迎引导模态框 =================
function openWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    const card = document.getElementById('welcomeCard');
    if (!modal || !card) return;

    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    card.classList.remove('scale-95');
    card.classList.add('scale-100');
    activateDialog(modal, document.getElementById('welcomePlaylistInput'));
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    const card = document.getElementById('welcomeCard');
    if (!modal || !card) return;

    deactivateDialog(modal);
    modal.classList.add('opacity-0');
    card.classList.add('scale-95');
    card.classList.remove('scale-100');
    setTimeout(() => {
        modal.classList.add('hidden');
        // Reset states
        const loading = document.getElementById('welcomeLoading');
        const error = document.getElementById('welcomeError');
        if (loading) loading.classList.add('hidden');
        if (error) error.classList.add('hidden');
    }, 500);
}

async function submitWelcomePlaylist() {
    const input = document.getElementById('welcomePlaylistInput');
    const errorDiv = document.getElementById('welcomeError');
    const errorText = document.getElementById('welcomeErrorText');
    const loadingDiv = document.getElementById('welcomeLoading');
    const loadBtn = document.getElementById('welcomeLoadBtn');

    const rawId = input.value.trim();

    // 支持纯数字ID或从链接中提取ID
    const idMatch = rawId.match(/(\d{5,})/);
    if (!idMatch) {
        errorDiv.classList.remove('hidden');
        errorText.textContent = '请输入有效的歌单ID（纯数字，或包含歌单ID的链接）';
        input.classList.add('border-red-400/50');
        setTimeout(() => input.classList.remove('border-red-400/50'), 2000);
        return;
    }

    const playlistId = idMatch[1];
    errorDiv.classList.add('hidden');

    // Show loading
    loadingDiv.classList.remove('hidden');
    loadBtn.disabled = true;

    try {
        await loadPlaylistById(playlistId);

        // Success!
        document.getElementById('welcomeLoadingText').textContent = '加载成功！';
        document.getElementById('welcomeLoadingSubtext').textContent = `已加载 ${queue.playlist.length} 首歌曲`;

        showToast(`歌单加载成功！共 ${queue.playlist.length} 首歌曲`);

        setTimeout(() => {
            closeWelcomeModal();
        }, 800);

    } catch (e) {
        // Failed
        loadingDiv.classList.add('hidden');
        loadBtn.disabled = false;
        errorDiv.classList.remove('hidden');
        errorText.textContent = '歌单加载失败，请检查ID是否正确或网络是否正常';
    }
}

// 欢迎模态框事件绑定（module script 执行时 DOM 已 ready，直接绑定）
{
    const welcomeInput = document.getElementById('welcomePlaylistInput');
    const welcomeBtn = document.getElementById('welcomeLoadBtn');
    if (welcomeInput) {
        welcomeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitWelcomePlaylist();
        });
    }
    if (welcomeBtn) {
        welcomeBtn.addEventListener('click', submitWelcomePlaylist);
    }
}

function initPlaylistView() {
    accountPanel?.queueChanged();
    const countText = allSongsLoaded ? `(${queue.playlist.length}首)` : `(${queue.playlist.length}+首)`;
    document.getElementById('playlistCount').textContent = countText;

    // 打乱播放顺序（如果是随机模式）
    if (queue.playMode === 'random') {
        shufflePlaylist();
    }

    // 虚拟滚动渲染
    setupVirtualScroll();

    // 隐藏加载器
    document.getElementById('playlistLoader').classList.add('hidden');
}

// ================= 桌面端虚拟滚动 =================
const VS_ITEM_H = 64;       // 每项高度 (px)，为删除按钮保留 44px 触控区
const VS_BUFFER = 30;       // 上下各多渲染30项
let vsDisplayOrder = [];     // 当前显示顺序
let vsRenderedRange = { start: -1, end: -1 };  // 当前已渲染范围
let vsScrollRAF = null;      // 防抖 requestAnimationFrame
let vsNodeMap = new Map();   // displayIndex -> DOM node

function syncQueueActions() {
    musicWall?.refresh();
    const selectedSong = mobileUI?.coverSong || playback.state.currentSong;
    if (selectedSong) queueStore.select(selectedSong);
    mobileUI?.syncCoverCarousel();
    const count = queue.playlist.length;
    const badge = document.getElementById('playerQueueCount');
    if (badge) badge.textContent = count;
    if (dom.playlistCount) dom.playlistCount.textContent = `(${count}首)`;
    if (dom.mobileQueueCount) dom.mobileQueueCount.textContent = `${count} 首歌曲`;
    [dom.clearPlaylistBtn, dom.mobileClearPlaylistBtn].filter(Boolean).forEach(button => {
        button.disabled = count === 0;
    });

    const transportDisabled = count === 0 || !playback.state.currentSong?.id;
    if (dom.prevBtn) dom.prevBtn.disabled = transportDisabled;
    if (dom.nextBtn) dom.nextBtn.disabled = transportDisabled;
    if (mobileUI?.dom?.prevBtn) mobileUI.dom.prevBtn.disabled = transportDisabled;
    if (mobileUI?.dom?.nextBtn) mobileUI.dom.nextBtn.disabled = transportDisabled;
}

function queueSnapshot() {
    return queueStore.snapshot(playback.state.currentSong?.id ?? null);
}

function syncQueueAfterMutation() {
    window.playlist = queue.playlist;
    accountPanel?.queueChanged();
    playlistTotalCount = queue.playlist.length;
    setupVirtualScroll();
    mobileUI?.loadPlaylist();
    syncQueueActions();
}

function restoreQueueSnapshot(snapshot) {
    if (!queueStore.restore(snapshot, playback.state.currentSong?.id ?? null)) return;
    syncQueueAfterMutation();
    highlightCurrentSong();
    showToast(`已恢复 ${queue.playlist.length} 首歌曲`);
}

function showQueueUndo(message, snapshot) {
    queue.undoSnapshot = snapshot;
    showToast(message, false, {
        actionLabel: '撤销',
        duration: 12000,
        onAction: () => restoreQueueSnapshot(queue.undoSnapshot),
    });
}

function removeSongFromPlaylist(index) {
    const result = queueStore.remove(index, playback.state.currentSong?.id ?? null);
    if (!result) return;
    const { removed: removedSong, snapshot } = result;
    syncQueueAfterMutation();
    showQueueUndo(`已从队列移除《${removedSong?.name || `歌曲 ${removedSong?.id ?? removedSong}`}》`, snapshot);
}

function clearPlaylist() {
    const snapshot = queueStore.clear(playback.state.currentSong?.id ?? null);
    if (!snapshot) return;
    syncQueueAfterMutation();
    showQueueUndo(`已清空 ${snapshot.songs.length} 首歌曲`, snapshot);
}

function getDisplayOrder() { return queueStore.displayOrder(); }

function setupVirtualScroll() {
    vsDisplayOrder = getDisplayOrder();
    vsRenderedRange = { start: -1, end: -1 };
    vsNodeMap.clear();
    syncQueueActions();

    if (!queue.playlist.length) {
        const emptyState = document.createElement('div');
        emptyState.className = 'text-center py-8 opacity-50';
        emptyState.textContent = EMPTY_PLAYLIST_MESSAGE;
        dom.playlistContent.replaceChildren(emptyState);
        dom.playlistContent.style.height = '';
        dom.playlistContent.style.position = '';
        return;
    }

    const totalHeight = vsDisplayOrder.length * VS_ITEM_H;
    dom.playlistContent.innerHTML = '';
    dom.playlistContent.style.height = totalHeight + 'px';
    dom.playlistContent.style.position = 'relative';

    vsRenderVisible(true);

    dom.playlistContainer.onscroll = () => {
        if (vsScrollRAF) return;
        vsScrollRAF = requestAnimationFrame(() => {
            vsScrollRAF = null;
            vsRenderVisible(false);
        });
    };
}

function vsCreateItem(i) {
    const actualIndex = vsDisplayOrder[i];
    const song = queue.playlist[actualIndex];
    const songId = typeof song === 'object' ? song.id : song;
    const songName = typeof song === 'object' ? song.name : `歌曲 ID: ${song}`;
    const songArtist = typeof song === 'object' ? song.artist : '';

    const div = document.createElement('div');
    div.className = 'playlist-item p-2 rounded-xl hover:bg-surface-container-high-color cursor-pointer flex items-center gap-3 group theme-text-on-surface';
    div.dataset.idx = actualIndex;
    div.dataset.vsIdx = i;
    div.style.cssText = `position:absolute;top:${i * VS_ITEM_H}px;left:0;right:0;height:${VS_ITEM_H}px;`;
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-label', `播放《${songName}》`);

    if (actualIndex === queue.currentIndex) {
        div.classList.add('bg-primary-color/20', 'text-primary-color', 'font-bold', 'border-l-4', 'border-primary-color', 'pl-2', 'playing-item', 'shadow-md');
    }

    const numSpan = document.createElement('span');
    numSpan.className = 'song-index opacity-50 group-hover:opacity-100 font-mono text-xs w-6 text-right flex-shrink-0';
    numSpan.textContent = `${i + 1}`;

    const coverDiv = document.createElement('div');
    coverDiv.className = 'w-10 h-10 rounded-lg bg-surface-container-color flex-shrink-0 overflow-hidden';
    const img = document.createElement('img');
    img.className = 'w-full h-full object-cover'; img.alt = '';
    bindArtwork(img, typeof song === 'object' ? song : { id: song }, { size: 80 });
    coverDiv.appendChild(img);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1 min-w-0';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'truncate text-sm font-medium';
    titleDiv.textContent = songName;
    const artistDiv = document.createElement('div');
    artistDiv.className = 'truncate text-xs opacity-50';
    artistDiv.textContent = songArtist || '未知艺术家';
    infoDiv.appendChild(titleDiv);
    infoDiv.appendChild(artistDiv);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'queue-remove-button';
    removeButton.setAttribute('aria-label', `从播放队列删除《${songName}》`);
    removeButton.title = '从队列删除';
    removeButton.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
    removeButton.addEventListener('click', event => {
        event.stopPropagation();
        removeSongFromPlaylist(actualIndex);
    });

    div.appendChild(numSpan);
    div.appendChild(coverDiv);
    div.appendChild(infoDiv);
    div.appendChild(removeButton);

    div.onclick = () => {
        queue.currentIndex = actualIndex;
        loadAndPlaySong(songId, typeof song === 'object' ? song : null);
    };
    div.addEventListener('keydown', event => {
        if (event.target !== div) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        div.click();
    });
    return div;
}

function vsRenderVisible(forceRebuild) {
    const scrollTop = dom.playlistContainer.scrollTop;
    const viewHeight = dom.playlistContainer.clientHeight;
    const totalItems = vsDisplayOrder.length;

    let newStart = Math.floor(scrollTop / VS_ITEM_H) - VS_BUFFER;
    let newEnd = Math.ceil((scrollTop + viewHeight) / VS_ITEM_H) + VS_BUFFER;
    newStart = Math.max(0, newStart);
    newEnd = Math.min(totalItems, newEnd);

    const oldStart = vsRenderedRange.start;
    const oldEnd = vsRenderedRange.end;

    if (!forceRebuild && newStart === oldStart && newEnd === oldEnd) return;

    if (forceRebuild) {
        // 全量初始化
        dom.playlistContent.innerHTML = '';
        vsNodeMap.clear();
        const frag = document.createDocumentFragment();
        for (let i = newStart; i < newEnd; i++) {
            const node = vsCreateItem(i);
            vsNodeMap.set(i, node);
            frag.appendChild(node);
        }
        dom.playlistContent.appendChild(frag);
    } else {
        // 增量：移除离开范围的节点
        for (let i = oldStart; i < oldEnd; i++) {
            if (i < newStart || i >= newEnd) {
                const node = vsNodeMap.get(i);
                if (node && node.parentNode) node.parentNode.removeChild(node);
                vsNodeMap.delete(i);
            }
        }
        // 增量：添加新进入范围的节点
        const frag = document.createDocumentFragment();
        let added = false;
        for (let i = newStart; i < newEnd; i++) {
            if (!vsNodeMap.has(i)) {
                const node = vsCreateItem(i);
                vsNodeMap.set(i, node);
                frag.appendChild(node);
                added = true;
            }
        }
        if (added) dom.playlistContent.appendChild(frag);
    }

    vsRenderedRange = { start: newStart, end: newEnd };
}

// 一次性渲染播放列表（保留作为兼容入口，内部走虚拟滚动）
function renderAllPlaylistItems() {
    musicWall?.refresh();
    setupVirtualScroll();
}

// Expose functions globally for Mobile UI
window.playSongAtIndex = (index, options = {}) => {
    if (index < 0 || index >= queue.playlist.length) return;
    queue.currentIndex = index; // Sync with global variable
    // currentSongIndex = index; // Removed if not defined

    const song = queue.playlist[index];
    const songId = typeof song === 'object' ? song.id : song;

    return loadAndPlaySong(songId, typeof song === 'object' ? song : null, options);

    // Sync mobile playlist view if active
    if (mobileUI && mobileUI.activeSheetTab === 'playlist') {
        mobileUI.loadPlaylist();
    }
};

function highlightCurrentSong() {
    // 移除旧的高亮
    const old = dom.playlistContent.querySelector('.playing-item');
    if (old) old.classList.remove('bg-primary-color/20', 'text-primary-color', 'font-bold', 'border-l-4', 'border-primary-color', 'pl-2', 'playing-item', 'shadow-md');

    // 添加新的高亮（如果当前歌曲在可见区域内）
    let el = dom.playlistContent.querySelector(`div[data-idx="${queue.currentIndex}"]`);
    if (el) {
        el.classList.add('bg-primary-color/20', 'text-primary-color', 'font-bold', 'border-l-4', 'border-primary-color', 'pl-2', 'playing-item', 'shadow-md');
    }

    // 滚动到当前歌曲在显示顺序中的位置
    const displayPos = vsDisplayOrder.indexOf(queue.currentIndex);
    if (displayPos !== -1) {
        const targetTop = displayPos * VS_ITEM_H - dom.playlistContainer.clientHeight / 2 + VS_ITEM_H / 2;
        dom.playlistContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
}

function playNextSong() {
    mobileUI?.coverCarousel?.expectDirection(1);
    if (discoveryHome?.radio.active()) return discoveryHome.advanceRadio();
    if (!queue.playlist.length) return;
    // ★ Fix: 首次播放时（currentIndex === -1），直接从第一首开始
    if (queue.currentIndex === -1) {
        if (queue.playMode === 'random' && queue.shuffledOrder.length === queue.playlist.length) {
            queue.currentIndex = queue.shuffledOrder[0];
        } else {
            queue.currentIndex = 0;
        }
    } else {
        queue.currentIndex = getNextSongIndex();
    }
    const song = queue.playlist[queue.currentIndex];
    const songId = typeof song === 'object' ? song.id : song;
    loadAndPlaySong(songId, typeof song === 'object' ? song : null);
}

function playPreviousSong() {
    mobileUI?.coverCarousel?.expectDirection(-1);
    discoveryHome?.radio.stop();
    if (!queue.playlist.length) return;
    // ★ Fix: 首次播放时（currentIndex === -1），直接从第一首开始
    if (queue.currentIndex === -1) {
        if (queue.playMode === 'random' && queue.shuffledOrder.length === queue.playlist.length) {
            queue.currentIndex = queue.shuffledOrder[0];
        } else {
            queue.currentIndex = 0;
        }
    } else {
        queue.currentIndex = getPreviousSongIndex();
    }
    const song = queue.playlist[queue.currentIndex];
    const songId = typeof song === 'object' ? song.id : song;
    loadAndPlaySong(songId, typeof song === 'object' ? song : null);
}

function handleSongEnd() {
    if (discoveryHome?.radio.active()) return discoveryHome.advanceRadio();
    return playback.ended({
        onEmpty() {
            setPlaybackTransitionPending(false);
            syncPlaybackControls(false);
        },
        onError(error) {
            console.error('Single-track replay failed:', error);
            syncPlaybackControls(false);
        },
        onNext: playNextSong,
    });
}

function syncPlayModeUI() {
    const modes = {
        sequence: { icon: 'ListOrdered', label: 'playModeSequence', hint: 'playModeSequenceHint' },
        random: { icon: 'Shuffle', label: 'playModeRandom', hint: 'playModeRandomHint' },
        single: { icon: 'Repeat1', label: 'playModeSingle', hint: 'playModeSingleHint' },
    };
    const mode = modes[queue.playMode] || modes.random;
    const message = `${t(mode.label)}：${t(mode.hint)}`;
    for (const button of [dom.playModeBtn, dom.mobileModeBtn].filter(Boolean)) {
        button.innerHTML = `<i data-lucide="${mode.icon}" class="text-xl" aria-hidden="true"></i>`;
        button.dataset.playMode = queue.playMode;
        button.dataset.lucideTooltip = 'false';
        button.setAttribute('title', message);
        button.setAttribute('aria-label', `${t(mode.label)}，${t('switchPlayMode')}`);
    }
    return message;
}

function togglePlayMode() {
    const modes = ['sequence', 'random', 'single'];
    queue.playMode = modes[(modes.indexOf(queue.playMode) + 1) % modes.length];
    if (queue.playMode === 'random') shufflePlaylist();
    showToast(syncPlayModeUI(), false, { duration: 3200 });

    // 立即重绘列表以反映打乱或恢复顺序的UI
    renderAllPlaylistItems();
    highlightCurrentSong();
    // ★ 同步移动端播放列表
    if (mobileUI) mobileUI.loadPlaylist();
}

// ================= 视觉与主题 =================
function setupAudioContext() {
    if (audio.isNative) return; // Android Media3 owns the output and audio focus.
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioContext.createMediaElementSource(audio);

    gainNode = audioContext.createGain();
    gainNode.gain.value = 2.0;

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    // ★ 动态压缩器（音量标准化，防止爆音）
    compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime);
    compressorNode.knee.setValueAtTime(30, audioContext.currentTime);
    compressorNode.ratio.setValueAtTime(12, audioContext.currentTime);
    compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);

    // 音频图连接：src -> gainNode -> analyser -> compressor -> destination
    src.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(compressorNode);
    compressorNode.connect(audioContext.destination);

    console.log('🔊 音量标准化已启用（动态压缩器）');
}

// ================= 安全插入歌曲到播放列表 =================
window.insertSongToPlaylist = function (newSong) {
    const cover = artworkResolver.knownCover(newSong);
    const index = queueStore.insert(cover ? { ...newSong, cover } : newSong);
    accountPanel?.queueChanged();
    window.playlist = queue.playlist;
    return index;
};

function initVisualizer() {
    const canvas = document.getElementById('audioVisualizer');
    const ctx = canvas.getContext('2d');

    if (!audioContext && isPlaying) setupAudioContext();

    function resize() {
        // 画布比封面大一些，用来画波形
        const coverSizePx = parseInt(getComputedStyle(dom.html).getPropertyValue('--cover-size'));
        const size = coverSizePx + 100; // 留足空间画波浪
        canvas.width = size;
        canvas.height = size;
    }
    window.addEventListener('resize', resize);
    resize();

    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);

    let frameCount = 0;
    let animationFrame = null;

    function draw() {
        animationFrame = requestAnimationFrame(draw);

        // 1. 实验性功能：背景激荡逻辑 (已移除 isGradientMode 依赖)
        // if (analyser && isPlaying && ++frameCount % 5 === 0) {
        // 移除旧的背景逻辑，避免报错
        // }

        // 2. 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!analyser || !isPlaying) return;

        // 3. Siri 环形波形绘制 (Experimental)
        analyser.getByteFrequencyData(dataArray);

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        // 半径基于封面大小，确保紧贴边缘
        const coverRadius = (canvas.width - 100) / 2;
        const radius = coverRadius + 5; // 基础半径比封面稍大

        ctx.beginPath();

        // 获取主色调
        const primaryColor = getComputedStyle(dom.html).getPropertyValue('--primary-color').trim();
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        const skipLow = Math.floor(bufferLength * 0.1);  // 跳过最低的10%频率
        const skipHigh = Math.floor(bufferLength * 0.1); // 跳过最高的10%频率
        const midStart = skipLow;
        const midEnd = bufferLength - skipHigh;
        const sliceLen = midEnd - midStart;
        const angleStep = (Math.PI * 2) / sliceLen;

        for (let i = 0; i < sliceLen; i++) {
            const dataIndex = midStart + i; // 从中间频段开始取值
            const value = dataArray[dataIndex];
            // 动态计算波幅：中频区域更平滑
            const amp = (value / 255) * 40;

            const angle = i * angleStep - (Math.PI / 2); // 从顶部开始

            // 计算外圈波形的坐标
            // 使用正弦波平滑处理，避免锯齿
            const r = radius + amp;

            const x = centerX + Math.cos(angle) * r;
            const y = centerY + Math.sin(angle) * r;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        // 闭合路径
        ctx.closePath();

        // 添加发光效果
        ctx.shadowBlur = 15;
        ctx.shadowColor = primaryColor;

        ctx.stroke();

        // 重置阴影，避免影响性能
        ctx.shadowBlur = 0;
    }

    function start() {
        if (animationFrame !== null) return;
        animationFrame = requestAnimationFrame(draw);
    }

    function stop() {
        if (animationFrame === null) return;
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    return { start, stop };
}

// rgbToHsl - 保留供流体背景使用
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) h = s = 0;
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s, l };
}

function syncFullscreenButton() {
    const icon = document.querySelector('#fullscreenBtn i');
    if (!icon) return;
    const isFullscreen = Boolean(document.fullscreenElement);
    icon.classList.toggle('fa-expand', !isFullscreen);
    icon.classList.toggle('fa-compress', isFullscreen);
}

document.addEventListener('fullscreenchange', syncFullscreenButton);
syncFullscreenButton();

async function toggleFullScreen() {
    const enteringFullscreen = !document.fullscreenElement;
    try {
        if (enteringFullscreen) {
            await document.documentElement.requestFullscreen();
        } else if (document.exitFullscreen) {
            await document.exitFullscreen();
        }
    } catch (err) {
        showToast(`无法${enteringFullscreen ? '启用' : '退出'}全屏: ${err.message}`, true);
        syncFullscreenButton();
    }
}




// 沉浸模式状态
let isImmersiveMode = false;

function toggleImmersiveMode() {
    isImmersiveMode = !isImmersiveMode;
    const topSection = document.getElementById('topSectionArea');
    const btn = document.getElementById('immersiveModeBtn');
    const btnText = document.getElementById('immersiveModeText');
    const btnIcon = btn ? btn.querySelector('i') : null;

    if (topSection) {
        if (isImmersiveMode) {
            topSection.classList.add('immersive-hidden');
            if (btnText) btnText.textContent = '退出沉浸模式';
            if (btnIcon) {
                btnIcon.classList.remove('fa-eye');
                btnIcon.classList.add('fa-eye-slash');
            }
            if (btn) btn.classList.add('bg-primary-color', 'text-on-primary-color');
        } else {
            topSection.classList.remove('immersive-hidden');
            if (btnText) btnText.textContent = '开启沉浸模式';
            if (btnIcon) {
                btnIcon.classList.remove('fa-eye-slash');
                btnIcon.classList.add('fa-eye');
            }
            if (btn) btn.classList.remove('bg-primary-color', 'text-on-primary-color');
        }
    }

    // 保存状态
    localStorage.setItem('cp_immersiveMode', isImmersiveMode ? 'on' : 'off');
}

function initImmersiveMode() {
    // 绑定沉浸模式按钮事件
    const immersiveModeBtn = document.getElementById('immersiveModeBtn');
    if (immersiveModeBtn) {
        immersiveModeBtn.onclick = toggleImmersiveMode;
    }

    // 恢复保存的状态
    const savedMode = localStorage.getItem('cp_immersiveMode');
    if (savedMode === 'on') {
        toggleImmersiveMode();
    }
}

function formatTime(s) {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}
function updateVolumeIcon(vol) {
    let icon = 'fa-volume-mute';
    if (vol > 0.5) icon = 'fa-volume-up';
    else if (vol > 0) icon = 'fa-volume-down';
    dom.volumeBtn.innerHTML = `<i id="volumeIcon" class="fas ${icon} text-xl"></i>`;
}

// ================= ★ WebGL 流体背景渲染器 (参考 aura-music 风格) =================
// ================= ★ Mobile UI Manager (Updated) =================
class MobileUIManager {
    constructor() {
        this.isMobile = isCompactLayout();
        this.currentMode = 'cover';
        this.activeSheetTab = 'playlist'; // playlist | search
        this.searchController = null;

        this.dom = {
            mobileLayout: document.getElementById('mobileLayout'),
            // Main Views
            mobileCoverContainer: document.getElementById('mobileCoverContainer'),
            mobileLyricsContainer: document.getElementById('mobileLyricsPage'),

            // Sheet
            sheet: document.getElementById('mobilePlaylistSheet'),
            sheetToggleBtn: document.getElementById('mobilePlaylistToggleBtn'),
            closeSheetBtn: document.getElementById('closeSheetBtn'),

            // Sheet Tabs
            tabPlaylist: document.getElementById('sheetTabPlaylist'),
            tabSearch: document.getElementById('sheetTabSearch'),

            // Sheet Content
            contentPlaylist: document.getElementById('sheetContentPlaylist'),
            contentSearch: document.getElementById('sheetContentSearch'),
            playlistContainer: document.getElementById('mobilePlaylistContainer'),
            searchResults: document.getElementById('mobileSearchResults'),
            searchInput: document.getElementById('mobileSearchInput'),

            // Elements
            vinyl: document.getElementById('mobileAlbumArtWrapper'),
            vinylContainer: document.getElementById('mobileVinylContainer'),
            coverImg: document.getElementById('mobileCoverImg'),
            title: document.getElementById('mobileTitle'),
            artist: document.getElementById('mobileArtist'),
            // Metadata
            sourceTag: document.getElementById('mobileSourceTag'),
            songIdTag: document.getElementById('mobileSongIdTag'),
            qualityBadge: document.getElementById('mobileQualityBadge'),

            // Controls
            playBtn: document.getElementById('mobilePlayBtn'),
            progressBar: document.getElementById('mobileProgressBar'),
            progressContainer: document.getElementById('mobileProgressBarContainer'),
            currentTime: document.getElementById('mobileCurrentTime'),
            duration: document.getElementById('mobileDuration'),
            prevBtn: document.getElementById('mobilePrevBtn'),
            nextBtn: document.getElementById('mobileNextBtn'),
            modeBtn: document.getElementById('mobileModeBtn')
        };

        this.init();
    }

    init() {
        if (androidPlayer) {
            this.coverCarousel = createCoverCarousel({
                host: this.dom.vinylContainer,
                caption: document.getElementById('mobileCoverCaption'),
                getSnapshot: () => {
                    const snapshot = coverQueueWindow(queue, this.coverSong || playback.state.currentSong);
                    // Radio chooses its next recording asynchronously; don't preview a queued song it won't play.
                    if (discoveryHome?.radio.active()) {
                        snapshot.entries = snapshot.entries.filter(entry => entry.slot === 0);
                        snapshot.position = snapshot.total = 0;
                    }
                    return { ...snapshot, loading: Boolean(this.coverLoading) };
                },
                onNavigate: direction => direction > 0 ? playNextSong() : playPreviousSong(),
                onLyrics: () => this.toggleView(),
            });
        }
        this.bindEvents();
        this.bindSheetEvents();
        // 延迟执行 initial resize 以确保 DOM就绪
        requestAnimationFrame(() => this.handleResize());
        window.addEventListener('resize', () => this.handleResize());

        // Preload Playlist (Wait for global playlist to be ready)
        const checkPlaylist = setInterval(() => {
            if (Array.isArray(window.playlist)) {
                this.loadPlaylist();
                clearInterval(checkPlaylist);

                // Initial scroll to current song if playing
                setTimeout(() => {
                    const activeItem = document.getElementById('mobile-playing-item');
                    if (activeItem) {
                        activeItem.scrollIntoView({ block: 'center', behavior: 'auto' });
                    }
                }, 500);
            }
        }, 500);
    }

    bindEvents() {
        document.getElementById('mobileLyricsToggle').addEventListener('click', () => this.toggleView());
        document.getElementById('mobileBrowseOpen').addEventListener('click', () => { this.closeSheet(); setMobileExploreOpen(false); });
        document.getElementById('mobileBrowsePlay').addEventListener('click', event => { event.stopPropagation(); togglePlayPause(); });
        document.getElementById('mobileBrowseNext').addEventListener('click', event => { event.stopPropagation(); playNextSong(); });

        // Swipe Logic
        let touchStartX = 0;
        let touchEndX = 0;
        let touchStartY = 0;
        let coverGesture = false;

        const handleSwipe = () => {
            const SWIPE_THRESHOLD = 50;
            if (touchEndX < touchStartX - SWIPE_THRESHOLD) {
                // Swipe Left -> Show Lyrics
                if (this.currentMode === 'cover') this.toggleView();
            }
            if (touchEndX > touchStartX + SWIPE_THRESHOLD) {
                // Swipe Right -> Show Cover
                if (this.currentMode === 'lyrics') this.toggleView();
            }
        };

        const mainView = document.getElementById('mobileMainView');
        mainView?.addEventListener('touchstart', (e) => {
            coverGesture = androidPlayer && Boolean(e.target.closest('.cover-carousel'));
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });
        mainView?.addEventListener('touchend', (e) => {
            if (coverGesture || Math.abs(e.changedTouches[0].screenY - touchStartY) >= Math.abs(e.changedTouches[0].screenX - touchStartX)) return;
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        });

        // Click Vinyl to Toggle View (ONLY if sheet is closed)
        this.dom.vinylContainer?.addEventListener('click', (e) => {
            if (androidPlayer) return; // The carousel owns cover taps and drags.
            e.stopPropagation(); // Prevent bubbling
            if (!this.dom.sheet.classList.contains('translate-y-0')) {
                this.toggleView();
            } else {
                // If sheet is open, close it (handled by document click, but just in case)
                this.closeSheet();
            }
        });

        // Global Click to Close Sheet
        document.addEventListener('click', (e) => {
            const sheet = this.dom.sheet;
            const toggleBtn = this.dom.sheetToggleBtn;

            // If sheet is open (translate-y-0)
            if (sheet.classList.contains('translate-y-0') && !e.target.closest('[data-android-action="search"], dialog[open]')) {
                // If click is OUTSIDE sheet and NOT on toggle button
                if (!sheet.contains(e.target) && !toggleBtn.contains(e.target)) {
                    this.closeSheet();
                }
            }
        });

        // Sync Controls
        this.dom.playBtn?.addEventListener('click', togglePlayPause);
        this.dom.prevBtn?.addEventListener('click', playPreviousSong);
        this.dom.nextBtn?.addEventListener('click', playNextSong);
        this.dom.modeBtn?.addEventListener('click', togglePlayMode);

        // Progress (鼠标、触摸、键盘统一处理)
        bindProgressScrubber(this.dom.progressContainer);
    }

    bindSheetEvents() {
        // Toggle Sheet
        this.dom.sheetToggleBtn?.addEventListener('click', () => {
            if (androidPlayer) this.switchSheetTab('playlist');
            this.openSheet();
        });
        this.dom.closeSheetBtn?.addEventListener('click', () => this.closeSheet());

        // Switch Tabs
        this.dom.tabPlaylist?.addEventListener('click', () => this.switchSheetTab('playlist'));
        this.dom.tabSearch?.addEventListener('click', () => this.switchSheetTab('search'));

        // Search Input
        if (!androidPlayer) this.dom.searchInput?.addEventListener('change', e => this.handleSearch(e.target.value));
        dom.mobileSearchForm.addEventListener('submit', event => {
            event.preventDefault();
            if (androidPlayer) this.dom.searchInput.blur();
            this.handleSearch(this.dom.searchInput.value);
        });

        // ★ 拖拽关闭手势
        this.bindSheetDrag();
    }

    bindSheetDrag() {
        const sheet = this.dom.sheet;
        const handle = document.getElementById('sheetDragHandle');
        if (!sheet || !handle) return;

        let startY = 0;
        let currentTranslateY = 0;
        let isDragging = false;

        const onTouchStart = (e) => {
            isDragging = true;
            startY = e.touches[0].clientY;
            currentTranslateY = 0;
            sheet.style.transition = 'none'; // 拖拽时禁用过渡
        };

        const onTouchMove = (e) => {
            if (!isDragging) return;
            const deltaY = e.touches[0].clientY - startY;
            if (deltaY > 0) { // 只允许下拉
                currentTranslateY = deltaY;
                sheet.style.transform = `translateY(${deltaY}px)`;
            }
        };

        const onTouchEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            sheet.style.transition = ''; // 恢复过渡
            sheet.style.transform = ''; // 清除内联 transform

            const THRESHOLD = 100; // 下拉超过100px则关闭
            if (currentTranslateY > THRESHOLD) {
                this.closeSheet();
            } else {
                // 弹回
                this.openSheet();
            }
            currentTranslateY = 0;
        };

        // 在手柄和整个 sheet 顶部区域监听
        handle.addEventListener('touchstart', onTouchStart, { passive: true });
        handle.addEventListener('touchmove', onTouchMove, { passive: true });
        handle.addEventListener('touchend', onTouchEnd);

        // 也允许从 sheet 头部拖拽
        const tabArea = sheet.querySelector('.flex-none');
        if (tabArea) {
            tabArea.addEventListener('touchstart', onTouchStart, { passive: true });
            tabArea.addEventListener('touchmove', onTouchMove, { passive: true });
            tabArea.addEventListener('touchend', onTouchEnd);
        }
    }

    // Sheet Logic
    openSheet() {
        // ★ Fix: 打开前刷新播放列表，确保显示最新状态
        this.loadPlaylist();
        if (androidPlayer) this.dom.sheet.inert = false;
        this.dom.sheet.classList.remove('translate-y-[110%]');
        this.dom.sheet.classList.add('translate-y-0');
        if (this.dom.sheet.getAttribute('aria-hidden') !== 'false') {
            activateDialog(this.dom.sheet, this.activeSheetTab === 'search'
                ? this.dom.searchInput
                : this.dom.closeSheetBtn);
        }
        if (androidPlayer) this.syncSheetBackground(true);
        this.syncBrowsePlayer();
    }

    closeSheet() {
        if (androidPlayer) this.syncSheetBackground(false);
        if (this.dom.sheet.getAttribute('aria-hidden') === 'false') {
            deactivateDialog(this.dom.sheet);
        }
        if (androidPlayer) this.dom.sheet.inert = true;
        this.dom.sheet.style.transform = ''; // 清除拖拽残留
        this.dom.sheet.classList.remove('translate-y-0');
        this.dom.sheet.classList.add('translate-y-[110%]');
        this.syncBrowsePlayer();
    }

    syncSheetBackground(sheetOpen) {
        const browsing = dom.mobileChartsSheet.getAttribute('aria-hidden') === 'false';
        dom.mobileChartsSheet.inert = sheetOpen || !browsing;
        for (const element of [dom.mobileMainView, dom.mobileLayout.querySelector(':scope > header'), document.querySelector('.mobile-control-deck')]) {
            element.inert = sheetOpen || browsing;
        }
    }

    switchSheetTab(tab) {
        this.activeSheetTab = tab;
        const isPlaylist = tab === 'playlist';

        // Update Tab Styles
        this.dom.tabPlaylist.setAttribute('aria-selected', String(isPlaylist));
        this.dom.tabSearch.setAttribute('aria-selected', String(!isPlaylist));
        this.dom.tabPlaylist.classList.toggle('opacity-100', isPlaylist);
        this.dom.tabPlaylist.classList.toggle('opacity-50', !isPlaylist);
        this.dom.tabPlaylist.classList.toggle('border-primary-color', isPlaylist);
        this.dom.tabPlaylist.classList.toggle('border-transparent', !isPlaylist);

        this.dom.tabSearch.classList.toggle('opacity-100', !isPlaylist);
        this.dom.tabSearch.classList.toggle('opacity-50', isPlaylist);
        this.dom.tabSearch.classList.toggle('border-primary-color', !isPlaylist);
        this.dom.tabSearch.classList.toggle('border-transparent', isPlaylist);

        // Update Content Visibility
        this.dom.contentPlaylist.classList.toggle('hidden', !isPlaylist);
        this.dom.contentSearch.classList.toggle('hidden', isPlaylist);
        this.dom.contentSearch.classList.toggle('flex', !isPlaylist);
    }

    // Data Logic
    loadPlaylist() { // Virtual scroll for mobile playlist (diff-based)
        try {
            if (!window.playlist || !Array.isArray(window.playlist)) return;
            syncQueueActions();

            const container = this.dom.playlistContainer;
            const scrollParent = container.parentElement; // sheetContentPlaylist

            let displayOrder = [];
            if (queue.playMode === 'random' && queue.shuffledOrder.length === window.playlist.length) {
                displayOrder = queue.shuffledOrder;
            } else {
                displayOrder = window.playlist.map((_, i) => i);
            }

            if (!displayOrder.length) {
                const emptyState = document.createElement('div');
                emptyState.className = 'p-6 text-center text-sm opacity-50';
                emptyState.textContent = EMPTY_PLAYLIST_MESSAGE;
                container.replaceChildren(emptyState);
                container.style.height = '';
                container.style.position = '';
                return;
            }

            const MH = androidPlayer ? 72 : 64; // Match the row height used by virtualization.
            const MB = 20;  // buffer
            const totalHeight = displayOrder.length * MH;

            container.innerHTML = '';
            container.style.height = totalHeight + 'px';
            container.style.position = 'relative';
            container.classList.remove('pb-20');

            let mRange = { start: -1, end: -1 };
            let mRAF = null;
            let mNodes = new Map(); // displayIndex -> DOM node
            const self = this;

            function mCreateItem(i) {
                const actualIndex = displayOrder[i];
                const song = window.playlist[actualIndex];
                const isPlaying = actualIndex === queue.currentIndex;
                const textClass = isPlaying ? 'text-primary-color' : '';

                const div = document.createElement('div');
                div.className = `mobile-queue-item flex items-center gap-3 px-3 rounded-xl cursor-pointer ${isPlaying ? 'is-playing' : ''}`;
                div.style.cssText = `position:absolute;top:${i * MH}px;left:0;right:0;height:${MH}px;display:flex;align-items:center;`;
                div.dataset.mvsIdx = i;
                div.setAttribute('role', 'button');
                div.setAttribute('tabindex', '0');
                div.setAttribute('aria-label', `播放《${song.name || '未知歌曲'}》`);
                if (isPlaying) div.id = 'mobile-playing-item';

                div.innerHTML = `
                    <span data-song-index class="text-xs font-mono opacity-50 w-6 text-center"></span>
                    <img alt="" class="w-10 h-10 rounded-lg object-cover bg-white/5 flex-none" loading="lazy">
                    <div class="flex-1 min-w-0">
                        <div data-song-title class="mobile-queue-title font-bold truncate text-sm ${textClass}"></div>
                        <div data-song-artist class="text-xs truncate opacity-50"></div>
                    </div>
                    <button data-queue-library type="button" class="w-11 h-11 flex-none" aria-haspopup="dialog" title="收藏与歌单"><i data-lucide="Heart" aria-hidden="true"></i></button>
                    <button data-remove-song class="queue-remove-button" type="button"
                        aria-label="从播放队列删除歌曲" title="从队列删除">
                        <i class="fas fa-times" aria-hidden="true"></i>
                    </button>
                `;
                div.querySelector('[data-song-index]').textContent = String(i + 1);
                div.querySelector('[data-song-title]').textContent = song.name || '未知歌曲';
                div.querySelector('[data-song-artist]').textContent = song.artist || '未知艺术家';
                div.onclick = () => {
                    playSongAtIndex(actualIndex);
                    self.closeSheet();
                };
                div.addEventListener('keydown', event => {
                    if (event.target !== div || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    div.click();
                });
                const removeButton = div.querySelector('[data-remove-song]');
                removeButton?.setAttribute('aria-label', `从播放队列删除《${song.name || '未知歌曲'}》`);
                removeButton?.addEventListener('click', event => {
                    event.stopPropagation();
                    removeSongFromPlaylist(actualIndex);
                });

                bindArtwork(div.querySelector('img'), typeof song === 'object' ? song : { id: song }, { size: 80 });
                const libraryButton = div.querySelector('[data-queue-library]');
                libraryButton.setAttribute('aria-label', `收藏与歌单 · ${song.name || song.id || song}`);
                libraryButton.addEventListener('click', event => {
                    event.stopPropagation();
                    personalLibrary?.song(typeof song === 'object' ? song : { id: song });
                });
                return div;
            }

            function mRender(force) {
                const st = Math.max(0, scrollParent.scrollTop - container.offsetTop);
                const vh = scrollParent.clientHeight;

                let s = Math.max(0, Math.floor(st / MH) - MB);
                let e = Math.min(displayOrder.length, Math.ceil((st + vh) / MH) + MB);

                if (!force && s === mRange.start && e === mRange.end) return;

                if (force) {
                    container.innerHTML = '';
                    mNodes.clear();
                    const frag = document.createDocumentFragment();
                    for (let i = s; i < e; i++) {
                        const node = mCreateItem(i);
                        mNodes.set(i, node);
                        frag.appendChild(node);
                    }
                    container.appendChild(frag);
                } else {
                    // 移除离开范围的
                    for (let i = mRange.start; i < mRange.end; i++) {
                        if (i < s || i >= e) {
                            const node = mNodes.get(i);
                            if (node && node.parentNode) node.parentNode.removeChild(node);
                            mNodes.delete(i);
                        }
                    }
                    // 添加新进入范围的
                    const frag = document.createDocumentFragment();
                    let added = false;
                    for (let i = s; i < e; i++) {
                        if (!mNodes.has(i)) {
                            const node = mCreateItem(i);
                            mNodes.set(i, node);
                            frag.appendChild(node);
                            added = true;
                        }
                    }
                    if (added) container.appendChild(frag);
                }
                mRange = { start: s, end: e };
            }

            mRender(true);

            scrollParent.onscroll = () => {
                if (mRAF) return;
                mRAF = requestAnimationFrame(() => {
                    mRAF = null;
                    mRender(false);
                });
            };

            // 自动滚动到当前播放
            const playingPos = displayOrder.indexOf(queue.currentIndex);
            if (playingPos !== -1) {
                requestAnimationFrame(() => {
                    const targetTop = playingPos * MH - scrollParent.clientHeight / 2 + MH / 2;
                    scrollParent.scrollTo({
                        top: Math.max(0, targetTop + container.offsetTop),
                        behavior: 'smooth'
                    });
                });
            }
        } catch (e) {
            console.error('Failed to load playlist', e);
            this.dom.playlistContainer.innerHTML = '<div class="p-4 text-center opacity-50 text-xs text-red-400">加载失败</div>';
        }
    }

    async handleSearch(query, { discover = false, allowIdPlayback = true } = {}) {
        if (!query.trim() && !discover) return;
        const requestSource = supportedMusicSource(musicService.config.source);

        this.searchController?.abort();
        const requestController = new AbortController();
        this.searchController = requestController;

        // [紧急Fix] 纯数字ID直接添加并播放
        if (allowIdPlayback && requestSource === 'chksz' && /^\d+$/.test(query.trim())) {
            const container = this.dom.searchResults;
            container.innerHTML = '<div class="p-4 text-center opacity-50 text-xs">正在加载ID歌曲...</div>';

            try {
                const songData = await musicService.getSong(query.trim(), {
                    signal: requestController.signal
                });
                if (requestController.signal.aborted || musicService.config.source !== requestSource) return;
                if (songData && songData.url) {
                    const newSong = {
                        id: songData.id,
                        sourceId: songData.sourceId,
                        name: songData.name,
                        artist: songData.artist,
                        cover: songData.cover,
                        album: songData.album || '',
                        source: 'id_search',
                        provider: songData.provider,
                        preferredProvider: requestSource,
                    };

                    // 插入到播放列表
                    // 直接访问 module scope 的变量
                    const targetIndex = window.insertSongToPlaylist(newSong);

                    // 刷新所有 UI
                    if (typeof renderAllPlaylistItems === 'function') renderAllPlaylistItems();
                    this.loadPlaylist();

                    // 播放
                    window.playSongAtIndex(targetIndex);

                    setSearchStatus(container, `已加入队列: ${newSong.name}`);
                    showToast(`已加入队列: ${newSong.name}`);
                } else {
                    container.innerHTML = '<div class="p-4 text-center opacity-50 text-xs text-red-400">无效的ID</div>';
                }
            } catch (e) {
                if (e instanceof RequestCancelledError || requestController.signal.aborted) return;
                console.error(e);
                setSearchStatus(container, requestErrorMessage(e), { error: true });
            } finally {
                if (this.searchController === requestController) {
                    this.searchController = null;
                }
            }
            return;
        }

        const container = this.dom.searchResults;
        container.innerHTML = '<div class="p-4 text-center opacity-50 text-xs">搜索中...</div>';

        try {
            // Use global musicService instance
            const results = await (discover ? musicService.getNewSongs({
                signal: requestController.signal, source: requestSource,
            }) : musicService.search(query, {
                signal: requestController.signal,
                source: requestSource,
            }));
            if (requestController.signal.aborted || musicService.config.source !== requestSource) return;
            container.innerHTML = '';

            if (!results || results.length === 0) {
                setSearchStatus(container, '无结果');
                return;
            }

            results.forEach(song => {
                const div = document.createElement('div');
                div.className = 'mobile-search-item flex items-center gap-3 p-2 rounded-xl active:bg-white/5 transition-colors cursor-pointer';

                div.innerHTML = `
                    <img alt="" class="w-10 h-10 rounded-lg object-cover bg-white/5 flex-none shadow-md" loading="lazy">
                    <div class="flex-1 min-w-0">
                        <div data-song-title class="font-bold truncate text-sm text-white/90"></div>
                        <div data-song-artist class="text-xs truncate opacity-50"></div>
                    </div>
                    <button aria-label="添加并播放歌曲" class="p-2 w-11 h-11 flex-none flex items-center justify-center rounded-full border border-white/20 text-xs active:bg-primary-color active:border-primary-color transition-colors">
                        <i class="fas fa-plus"></i>
                    </button>
                `;
                const targetImg = div.querySelector('img');
                div.querySelector('[data-song-title]').textContent = song.name || '未知歌曲';
                div.querySelector('[data-song-artist]').textContent = song.artist || '未知艺术家';

                bindArtwork(targetImg, song, { size: 80 });

                // Click entire item to add and play? Or button to add?
                // NetEase: Click item to play (and add to list)
                div.onclick = () => {
                    const newSong = {
                        ...song,
                        id: song.id,
                        sourceId: song.sourceId,
                        name: song.name,
                        artist: song.artist,
                        cover: song.cover,
                        album: song.album,
                        source: song.source || 'Search',
                        provider: song.provider,
                        preferredProvider: requestSource,
                    };
                    const targetIndex = window.insertSongToPlaylist(newSong);

                    // 刷新双端 UI
                    if (typeof renderAllPlaylistItems === 'function') renderAllPlaylistItems();
                    this.loadPlaylist();

                    // 播放
                    if (typeof window.playSongAtIndex === 'function') {
                        window.playSongAtIndex(targetIndex);
                    }

                    showToast(`已加入队列: ${song.name}`);
                };
                if (bilibiliVideoUrl(song)) {
                    const download = document.createElement('button');
                    download.type = 'button';
                    download.className = 'bilibili-original';
                    download.setAttribute('aria-label', `下载 ${song.name || '视频'} 音频`);
                    download.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i>';
                    download.addEventListener('click', event => {
                        event.stopPropagation();
                        openDownloadDialog(song, download);
                    });
                    div.append(download, createOriginalVideoLink(song));
                }
                catalogBrowser.decorateRow(div,song);
                container.appendChild(div);
            });

        } catch (e) {
            if (e instanceof RequestCancelledError || requestController.signal.aborted) return;
            console.error('Search failed', e);
            setSearchStatus(container, requestErrorMessage(e), { error: true });
        } finally {
            if (this.searchController === requestController) {
                this.searchController = null;
            }
        }
    }

    handleResize() {
        const isNowMobile = isCompactLayout();
        if (this.isMobile !== isNowMobile) {
            this.isMobile = isNowMobile;
            if (!this.isMobile) {
                this.closeSheet();
            }
        }
    }

    // View Toggles
    toggleView() {
        this.currentMode = this.currentMode === 'cover' ? 'lyrics' : 'cover';
        this.dom.mobileLyricsContainer.inert = this.currentMode !== 'lyrics';
        this.dom.mobileCoverContainer.inert = this.currentMode !== 'cover';
        document.getElementById('mobileLyricsToggle').setAttribute('aria-pressed', String(this.currentMode === 'lyrics'));

        if (this.currentMode === 'cover') {
            // Show Cover
            this.dom.mobileCoverContainer.classList.remove('opacity-0', 'pointer-events-none', 'translate-x-[-100%]');
            this.dom.mobileCoverContainer.classList.add('opacity-100', 'translate-x-0');

            // Hide Lyrics
            this.dom.mobileLyricsContainer.classList.add('opacity-0', 'pointer-events-none', 'translate-x-full');
            this.dom.mobileLyricsContainer.classList.remove('opacity-100', 'translate-x-0');
        } else {
            // Hide Cover
            this.dom.mobileCoverContainer.classList.add('opacity-0', 'pointer-events-none', 'translate-x-[-100%]');
            this.dom.mobileCoverContainer.classList.remove('opacity-100', 'translate-x-0');

            // Show Lyrics
            this.dom.mobileLyricsContainer.classList.remove('opacity-0', 'pointer-events-none', 'translate-x-full');
            this.dom.mobileLyricsContainer.classList.add('opacity-100', 'translate-x-0');
        }
    }

    resetView() {
        if (this.currentMode !== 'cover') this.toggleView();
    }

    // Updates - 带过渡动画
    syncCoverCarousel({ song, loading } = {}) {
        if (song) this.coverSong = song;
        if (loading !== undefined) this.coverLoading = loading;
        this.coverCarousel?.update();
    }

    updateInfo(title, artist, cover, { signal } = {}) {
        clearTimeout(this.infoTransitionTimer);
        const elements = [this.dom.title, this.dom.artist].filter(Boolean);


        // 淡出
        elements.forEach(el => el.style.transition = 'opacity 0.2s ease');
        elements.forEach(el => el.style.opacity = '0');

        this.infoTransitionTimer = setTimeout(() => {
            if (signal?.aborted) {
                elements.forEach(el => el.style.opacity = '1');
                return;
            }
            // 更新内容
            if (this.dom.title) this.dom.title.textContent = title || '未知歌曲';
            if (this.dom.artist) this.dom.artist.textContent = artist || '未知艺术家';

            // Sync metadata badges from desktop DOM
            const desktopSource = document.getElementById('sourceTag');
            if (this.dom.sourceTag && desktopSource) {
                this.dom.sourceTag.textContent = desktopSource.textContent;
                this.dom.sourceTag.classList.toggle('hidden', desktopSource.classList.contains('hidden'));
            }

            const desktopId = document.getElementById('songIdTag');
            if (this.dom.songIdTag && desktopId) {
                this.dom.songIdTag.textContent = desktopId.textContent;
                this.dom.songIdTag.className = desktopId.className;
            }

            const desktopQuality = document.getElementById('qualityBadge');
            if (this.dom.qualityBadge && desktopQuality) {
                this.dom.qualityBadge.innerHTML = desktopQuality.innerHTML;
                this.dom.qualityBadge.className = desktopQuality.className;
            }

            // 淡入
            requestAnimationFrame(() => {
                elements.forEach(el => el.style.opacity = '1');
            });
        }, 200); // 等淡出完成
    }

    updatePlayState(isPlaying) {
        if (this.dom.vinyl) {
            this.dom.vinyl.classList.toggle('playing', isPlaying);
        }
        this.dom.playBtn?.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
        this.dom.playBtn?.setAttribute('aria-pressed', String(Boolean(isPlaying)));
        const icon = this.dom.playBtn?.querySelector('i');
        if (icon) icon.className = isPlaying ? 'fas fa-pause pl-0' : 'fas fa-play pl-1';
        this.syncBrowsePlayer();
    }

    syncBrowsePlayer() {
        const bar = document.getElementById('mobileBrowsePlayer');
        if (!bar) return;
        const song = playerExperience?.song || playback.state.currentSong;
        const container = this.dom.sheet.getAttribute('aria-hidden') === 'false' ? this.dom.sheet
            : dom.mobileChartsSheet?.getAttribute('aria-hidden') === 'false' ? dom.mobileChartsSheet : null;
        bar.hidden = !song?.id || !container;
        if (bar.hidden) return;
        if (bar.parentElement !== container) {
            const nav = container.querySelector('.android-nav');
            container.insertBefore(bar, nav);
        }
        document.getElementById('mobileBrowseTitle').textContent = song.name || '未知歌曲';
        document.getElementById('mobileBrowseArtist').textContent = playerExperience?.statusText() || song.artist || '未知歌手';
        const cover = document.getElementById('mobileBrowseCover');
        const src = playbackArtworkUrl || fallbackArtwork(song).url;
        if (cover.getAttribute('src') !== src) cover.src = src;
        const playing = !audio.paused && !audio.ended;
        const button = document.getElementById('mobileBrowsePlay');
        button.setAttribute('aria-label', playing ? '暂停' : '播放');
        button.title = playing ? '暂停' : '播放';
        button.setAttribute('aria-pressed', String(playing));
        const glyph = playing ? 'Pause' : 'Play';
        if (button.dataset.glyph !== glyph) { button.innerHTML = `<i data-lucide="${glyph}" aria-hidden="true"></i>`; button.dataset.glyph = glyph; }
        document.getElementById('mobileBrowseNext').disabled = queue.playlist.length < 2;
    }

    updateProgress(currentTime, duration, progressPercent) {
        if (this.dom.currentTime) this.dom.currentTime.textContent = formatTime(currentTime);
        if (this.dom.duration) this.dom.duration.textContent = formatTime(duration);
        if (this.dom.progressBar) this.dom.progressBar.style.width = `${progressPercent}%`;
    }
}

// Global Instance
let mobileUI = null;

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function shouldAnimateContinuously() {
    const desktopBrowsing = desktopShellMedia.matches
        && !document.documentElement.classList.contains('desktop-immersive-open');
    return !document.hidden && !motionPreference.matches && !desktopBrowsing;
}

// ================= ★ FluidBackground (复制 aura-music WebGL) =================
class FluidBackground {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        if (!this.gl) {
            console.warn('WebGL 不支持');
            return;
        }

        this.isPlaying = true;
        this.timeAccumulator = 0;
        this.lastFrameTime = performance.now();
        this.animationFrame = null;

        // 默认颜色 (aura-music)
        this.colors = [
            'rgb(151, 215, 255)',
            'rgb(193, 177, 255)',
            'rgb(218, 240, 255)',
            'rgb(166, 225, 245)'
        ];

        this.initShader();
        this.resize();
        this.start();
        window.addEventListener('resize', () => this.resize());
    }

    parseColor(colorStr) {
        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!match) return [0, 0, 0];
        return [parseInt(match[1], 10) / 255, parseInt(match[2], 10) / 255, parseInt(match[3], 10) / 255];
    }

    initShader() {
        const gl = this.gl;
        const vs = `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
        const fs = `
            precision highp float;
            uniform vec2 uResolution; uniform float uTime;
            uniform vec3 uColor1, uColor2, uColor3, uColor4;
            #define S(a,b,t) smoothstep(a,b,t)
            mat2 Rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
            vec2 hash(vec2 p) { p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37))); return fract(sin(p) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
                float n = mix(mix(dot(-1.0 + 2.0 * hash(i), f), dot(-1.0 + 2.0 * hash(i + vec2(1,0)), f - vec2(1,0)), u.x),
                              mix(dot(-1.0 + 2.0 * hash(i + vec2(0,1)), f - vec2(0,1)), dot(-1.0 + 2.0 * hash(i + vec2(1,1)), f - vec2(1,1)), u.x), u.y);
                return 0.5 + 0.5 * n;
            }
            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                float ratio = uResolution.x / uResolution.y;
                vec2 tuv = uv - 0.5;
                float degree = noise(vec2(uTime * 0.1, tuv.x * tuv.y));
                tuv.y *= 1.0 / ratio;
                tuv *= Rot(radians((degree - 0.5) * 720.0 + 180.0));
                tuv.y *= ratio;
                float frequency = 5.0, amplitude = 30.0, speed = uTime * 2.0;
                tuv.x += sin(tuv.y * frequency + speed) / amplitude;
                tuv.y += sin(tuv.x * frequency * 1.5 + speed) / (amplitude * 0.5);
                vec3 layer1 = mix(uColor1, uColor2, S(-0.3, 0.2, (tuv * Rot(radians(-5.0))).x));
                vec3 layer2 = mix(uColor3, uColor4, S(-0.3, 0.2, (tuv * Rot(radians(-5.0))).x));
                gl_FragColor = vec4(mix(layer1, layer2, S(0.5, -0.3, tuv.y)), 1.0);
            }
        `;
        const createShader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
        const vShader = createShader(gl.VERTEX_SHADER, vs), fShader = createShader(gl.FRAGMENT_SHADER, fs);
        if (!vShader || !fShader) return;
        this.program = gl.createProgram();
        gl.attachShader(this.program, vShader); gl.attachShader(this.program, fShader);
        gl.linkProgram(this.program); gl.useProgram(this.program);
        const posBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const posLoc = gl.getAttribLocation(this.program, 'position');
        gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        this.uResolution = gl.getUniformLocation(this.program, 'uResolution');
        this.uTime = gl.getUniformLocation(this.program, 'uTime');
        this.uColor1 = gl.getUniformLocation(this.program, 'uColor1');
        this.uColor2 = gl.getUniformLocation(this.program, 'uColor2');
        this.uColor3 = gl.getUniformLocation(this.program, 'uColor3');
        this.uColor4 = gl.getUniformLocation(this.program, 'uColor4');
    }

    resize() { if (!this.gl) return; this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; this.gl.viewport(0, 0, this.canvas.width, this.canvas.height); }

    async extractColorsFromImage(imgUrl, { signal } = {}) {
        try {
            // console.log('🎨 开始从封面提取颜色:', imgUrl);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer';
            img.src = imgUrl;

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                setTimeout(reject, 5000); // 5秒超时
            });
            if (signal?.aborted) return;

            if (typeof ColorThief !== 'undefined') {
                const colorThief = new ColorThief();
                const palette = colorThief.getPalette(img, 4);
                // console.log('🎨 ColorThief 提取的调色板:', palette);

                if (palette && palette.length >= 4) {
                    // 确保格式正确：rgb(r, g, b) 带空格
                    this.colors = palette.map(([r, g, b]) => {
                        const factor = 0.32;
                        const lift = 168;
                        const nr = Math.min(255, Math.round(r * factor + lift));
                        const ng = Math.min(255, Math.round(g * factor + lift));
                        const nb = Math.min(255, Math.round(b * factor + lift));
                        return `rgb(${nr}, ${ng}, ${nb})`;
                    });
                    console.log('🎨 更新后的背景颜色:', this.colors);
                    return;
                }
            } else {
                console.warn('⚠️ ColorThief 未加载');
            }

            // 降级：简单采样四个角落的颜色
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 2;
            canvas.height = 2;
            ctx.drawImage(img, 0, 0, 2, 2);
            const data = ctx.getImageData(0, 0, 2, 2).data;

            const toPastel = value => Math.min(255, Math.round(value * 0.32 + 168));
            this.colors = [
                `rgb(${toPastel(data[0])}, ${toPastel(data[1])}, ${toPastel(data[2])})`,
                `rgb(${toPastel(data[4])}, ${toPastel(data[5])}, ${toPastel(data[6])})`,
                `rgb(${toPastel(data[8])}, ${toPastel(data[9])}, ${toPastel(data[10])})`,
                `rgb(${toPastel(data[12])}, ${toPastel(data[13])}, ${toPastel(data[14])})`
            ];
            console.log('🎨 降级采样的背景颜色:', this.colors);
        } catch (e) {
            console.warn('❌ 颜色提取失败:', e);
        }
    }

    render() {
        if (!this.gl || !this.program) return;
        const gl = this.gl, now = performance.now(), delta = now - this.lastFrameTime;
        this.lastFrameTime = now;
        if (this.isPlaying) this.timeAccumulator += delta;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.program);
        gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uTime, this.timeAccumulator * 0.0005);
        const [c1, c2, c3, c4] = this.colors.map(c => this.parseColor(c));
        gl.uniform3f(this.uColor1, c1[0], c1[1], c1[2]);
        gl.uniform3f(this.uColor2, c2[0], c2[1], c2[2]);
        gl.uniform3f(this.uColor3, c3[0], c3[1], c3[2]);
        gl.uniform3f(this.uColor4, c4[0], c4[1], c4[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    start() {
        if (!this.gl || this.animationFrame) return;
        if (!shouldAnimateContinuously()) {
            this.render();
            return;
        }
        this.lastFrameTime = performance.now();
        this.animate();
    }

    animate() {
        if (!shouldAnimateContinuously()) {
            this.animationFrame = null;
            return;
        }
        this.render();
        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    stop() {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
    }

    setPlaying(p) { this.isPlaying = p; }
    setColors(c) { if (c && c.length >= 4) this.colors = c; }
}

// ================= ★ Canvas 歌词渲染器 (参考 aura-music 效果) =================
class LyricsCanvasRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = null;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.lines = [];
        this.activeIndex = -1;
        this.scrollY = 0;
        this.targetScrollY = 0;
        this.scrollVelocity = 0;
        this.isDragging = false;
        this.lastTouchY = 0;
        this.lastInteractionTime = 0;
        this.isAnimating = false;
        this.animationFrame = null;
        this.width = 0;
        this.height = 0;

        // 当前版本使用 DOM 歌词；没有兼容 Canvas 时保持为空渲染器。
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        this.bindEvents();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * this.pixelRatio;
        this.canvas.height = this.height * this.pixelRatio;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }

    bindEvents() {
        // 鼠标/触摸交互
        this.canvas.addEventListener('mousedown', e => this.onPointerDown(e.clientY));
        this.canvas.addEventListener('mousemove', e => this.onPointerMove(e.clientY));
        this.canvas.addEventListener('mouseup', () => this.onPointerUp());
        this.canvas.addEventListener('mouseleave', () => this.onPointerUp());

        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            this.onPointerDown(e.touches[0].clientY);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            this.onPointerMove(e.touches[0].clientY);
        }, { passive: false });
        this.canvas.addEventListener('touchend', () => this.onPointerUp());

        // 鼠标滚轮
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            this.lastInteractionTime = performance.now();
            this.targetScrollY += e.deltaY * 0.5;
            this.clampScroll();
        }, { passive: false });

        // 点击跳转
        this.canvas.addEventListener('click', e => {
            if (this.isDragging) return;
            const rect = this.canvas.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            this.handleClick(clickY);
        });
    }

    onPointerDown(y) {
        this.isDragging = true;
        this.lastTouchY = y;
        this.scrollVelocity = 0;
        this.lastInteractionTime = performance.now();
    }

    onPointerMove(y) {
        if (!this.isDragging) return;
        const dy = this.lastTouchY - y;
        this.scrollVelocity = dy * 60;
        this.targetScrollY += dy;
        this.lastTouchY = y;
        this.clampScroll();
    }

    onPointerUp() {
        this.isDragging = false;
        this.lastInteractionTime = performance.now();
    }

    clampScroll() {
        const totalHeight = this.lines.reduce((sum, l) => sum + l.height + 16, 0);
        const maxScroll = Math.max(0, totalHeight - this.height * 0.5);
        this.targetScrollY = Math.max(-this.height * 0.3, Math.min(maxScroll, this.targetScrollY));
    }

    handleClick(clickY) {
        const focalY = this.height * 0.35;
        let y = focalY - this.scrollY;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const lineBottom = y + line.height;

            if (clickY >= y && clickY <= lineBottom) {
                // 点击跳转播放
                audio.currentTime = line.time;
                audio.play();
                break;
            }
            y = lineBottom + 16;
        }
    }

    setLyrics(parsedLyrics) {
        this.lines = parsedLyrics.map((item, idx) => ({
            time: item.time,
            text: item.text,
            words: [],
            translation: item.html?.includes('lyric-trans')
                ? item.html.match(/<div class="lyric-trans">(.*?)<\/div>/)?.[1]
                : null,
            height: 0,  // 动态计算
            measured: false
        }));

        this.measureLines();
        this.scrollY = -this.height * 0.3;
        this.targetScrollY = this.scrollY;
        this.activeIndex = -1;

        this.start();
    }

    measureLines() {
        const ctx = this.ctx;
        const isMobile = this.width < 768; // Match aura-music breakpoint
        // ★ 字体配置 (aura-music)
        const baseSize = isMobile ? 32 : 40;
        const transSize = isMobile ? 18 : 22;
        const mainFont = `800 ${baseSize}px "PingFang SC", "Noto Sans SC", "Inter", sans-serif`;
        const transFont = `500 ${transSize}px "PingFang SC", "Noto Sans SC", "Inter", sans-serif`;
        this.paddingX = isMobile ? 24 : 56; // 增加边距
        const maxWidth = this.width - this.paddingX * 2;

        this.lines.forEach(line => {
            ctx.font = mainFont;
            const mainMetrics = ctx.measureText(line.text || '');
            const mainWidth = mainMetrics.width;
            const mainLines = Math.ceil(mainWidth / maxWidth);
            const mainHeight = mainLines * (baseSize * 1.35); // line-height 1.35

            let transHeight = 0;
            if (line.translation) {
                ctx.font = transFont;
                const transMetrics = ctx.measureText(line.translation);
                const transLines = Math.ceil(transMetrics.width / maxWidth);
                transHeight = transLines * (transSize * 1.3) + 8; // margin-top 8
            }

            line.height = mainHeight + transHeight + 20; // margin-bottom 20
            line.measured = true;
        });
    }

    update(currentTime) {
        if (!this.lines.length) return;

        // 找当前行
        let newActive = 0;
        for (let i = 0; i < this.lines.length; i++) {
            if (this.lines[i].time <= currentTime + 0.2) { // Slightly fast anticipation
                newActive = i;
            } else {
                break;
            }
        }

        // 更新滚动目标
        const userScrolling = performance.now() - this.lastInteractionTime < 3000;
        if (!userScrolling && !this.isDragging) {
            // 计算目标行位置
            let targetY = 0;
            for (let i = 0; i < newActive; i++) {
                targetY += this.lines[i].height;
            }
            targetY += this.lines[newActive]?.height * 0.5 || 0;
            this.targetScrollY = targetY;
        }

        this.activeIndex = newActive;

        // ★ 弹簧物理滚动 (aura-music 参数)
        // Stiffness: 120 (loose) -> 300-400 (snap)
        // Damping: 20 -> 35-40
        const stiffness = this.isDragging ? 0 : (userScrolling ? 150 : 350);
        const damping = this.isDragging ? 10 : 35;
        const dt = 1 / 60;

        const displacement = this.scrollY - this.targetScrollY;
        const springForce = -stiffness * displacement;
        const dampingForce = -damping * this.scrollVelocity;
        const acceleration = springForce + dampingForce;

        this.scrollVelocity += acceleration * dt;
        this.scrollY += this.scrollVelocity * dt;

        if (Math.abs(this.scrollVelocity) < 0.1 && Math.abs(displacement) < 0.5) {
            this.scrollY = this.targetScrollY;
            this.scrollVelocity = 0;
        }
    }

    render(currentTime) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        if (!this.lines.length) {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '800 24px "PingFang SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('播放音乐以查看歌词', this.width / 2, this.height / 2);
            return;
        }

        const isMobile = this.width < 768;
        const baseSize = isMobile ? 32 : 40;
        const transSize = isMobile ? 18 : 22;
        const mainFont = `800 ${baseSize}px "PingFang SC", "Noto Sans SC", "Inter", sans-serif`;
        const transFont = `500 ${transSize}px "PingFang SC", "Noto Sans SC", "Inter", sans-serif`;

        // Focal Point: 35% from top (desktop) or near center?
        // aura-music uses 0.35 (ish)
        const focalY = this.height * 0.35;

        let y = focalY - this.scrollY;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const lineBottom = y + line.height;

            // 视口裁剪
            if (lineBottom < -100 || y > this.height + 100) {
                y = lineBottom; // Note: margin included in line.height now
                continue;
            }

            const isActive = i === this.activeIndex;

            // 渐变与模糊逻辑
            const distFromFocal = Math.abs(y + line.height / 2 - focalY);
            const normDist = Math.min(distFromFocal / (this.height * 0.5), 1);

            // aura-music opacity logic
            let opacity = isActive ? 1 : 0.3 + (0.7 * (1 - Math.pow(normDist, 0.5))) * 0.2;
            // Simplified: Active 1.0, others 0.3 dim
            if (!isActive) opacity = 0.3; // Stricter contrast like aura-music

            ctx.save();
            ctx.globalAlpha = opacity;

            // 缩放效果 (aura-music: Active 1.03, others 1.0)
            const scale = isActive ? 1.03 : 1.0;

            // Center of the line for scaling (vertically), but left aligned horizontally
            const centerY = y + line.height / 2;
            // Translate to paddingX, centerY
            ctx.translate(this.paddingX, centerY);
            ctx.scale(scale, scale);
            // Translate back up to top-left of text block (relative to center)
            ctx.translate(0, -line.height / 2);

            // 渲染主歌词
            ctx.font = mainFont;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left'; // 明确左对齐

            // aura-music: Active White, Inactive White (opacity handles dimming usually, or explicit color)
            // Inactiv color is rgba(255,255,255,0.85) but with opacity 0.3 applied globally
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(line.text, 0, 0);

            // 渲染翻译
            if (line.translation) {
                ctx.font = transFont;
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillText(line.translation, 0, baseSize * 1.35 + 8);
            }

            ctx.restore();

            y = lineBottom;
        }

        // 顶部/底部渐隐遮罩
        this.drawMask(ctx);
    }



    drawMask(ctx) {
        // 顶部渐隐
        const topGradient = ctx.createLinearGradient(0, 0, 0, this.height * 0.15);
        topGradient.addColorStop(0, 'rgba(0,0,0,1)');
        topGradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = topGradient;
        ctx.fillRect(0, 0, this.width, this.height * 0.15);

        // 底部渐隐
        const bottomGradient = ctx.createLinearGradient(0, this.height * 0.85, 0, this.height);
        bottomGradient.addColorStop(0, 'rgba(0,0,0,0)');
        bottomGradient.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = bottomGradient;
        ctx.fillRect(0, this.height * 0.85, this.width, this.height * 0.15);

        ctx.globalCompositeOperation = 'source-over';
    }

    animate() {
        if (!this.isAnimating) return;
        if (!shouldAnimateContinuously()) {
            this.isAnimating = false;
            this.animationFrame = null;
            return;
        }

        const time = audio?.currentTime || 0;
        this.update(time);
        this.render(time);

        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    start() {
        if (this.isAnimating || !this.lines.length) return;
        if (!shouldAnimateContinuously()) {
            this.render(audio?.currentTime || 0);
            return;
        }
        this.isAnimating = true;
        this.animate();
    }

    stop() {
        this.isAnimating = false;
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
    }
}

// ★ 全局实例
let fluidBg = null;
let lyricsCanvas = null;

// 初始化渲染器
function initCanvasRenderers() {
    // 流体背景
    if (getComputedStyle(document.getElementById('fluidBg')).display !== 'none') {
        fluidBg = new FluidBackground('fluidBg');
    }

    // Canvas 歌词
    lyricsCanvas = new LyricsCanvasRenderer('lyricsCanvas');

    // ★ Mobile UI
    mobileUI = new MobileUIManager();
    document.getElementById('mobileLyricsPage').inert = true;
    listeningRoom = createListeningRoom({
        audio, artwork: dom.albumArt, titleSource: dom.songTitle, artistSource: dom.artistName,
    });
    lyricEffects = createLyricEffects({
        audio, analyser: () => analyser, artwork: () => dom.albumArt?.getAttribute('src') || '',
        onLayoutChange: () => listeningRoom?.recenterLyrics(),
        onFollow: (id, top) => listeningRoom?.follow(id, top),
        getCandidates: song => [song, ...(song.sources || []).filter(source => source.id || source.sourceId).map(source => ({ ...song, ...source, sources: undefined }))],
        fetchLyrics: (song, { signal } = {}) => musicService.getLyric(song.id || song.sourceId, { song, signal }),
        fetchRicherLyrics: androidPlayer ? createNativeLyricLookup() : null,
    });
    document.getElementById('desktopLyricSettingsBtn').addEventListener('click', () => {
        openSettings();
        requestAnimationFrame(() => document.getElementById('lyricEffectSelect').focus({ preventScroll: false }));
    });
}

function syncContinuousRendering() {
    const lyricsButton = document.getElementById('desktopLyricsBtn');
    const lyricsOpen = document.documentElement.classList.contains('desktop-immersive-open');
    if (lyricsButton) {
        lyricsButton.setAttribute('aria-expanded', String(lyricsOpen));
        lyricsButton.setAttribute('aria-label', lyricsOpen ? '关闭歌词' : '打开歌词');
        lyricsButton.title = lyricsOpen ? '关闭歌词' : '打开歌词';
    }
    const continuousRendering = shouldAnimateContinuously();
    const desktopVisualizerActive = continuousRendering
        && desktopShellMedia.matches
        && document.documentElement.classList.contains('desktop-immersive-open');

    if (desktopVisualizerActive) {
        visualizer?.start();
    } else {
        visualizer?.stop();
    }

    if (continuousRendering) {
        fluidBg?.start();
        lyricsCanvas?.start();
    } else {
        fluidBg?.stop();
        lyricsCanvas?.stop();
    }
}

document.addEventListener('visibilitychange', syncContinuousRendering);
if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', syncContinuousRendering);
} else {
    motionPreference.addListener(syncContinuousRendering);
}
if (typeof desktopShellMedia.addEventListener === 'function') {
    desktopShellMedia.addEventListener('change', syncContinuousRendering);
} else {
    desktopShellMedia.addListener(syncContinuousRendering);
}

// 在 DOMContentLoaded 后初始化
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCanvasRenderers, 100);
});
