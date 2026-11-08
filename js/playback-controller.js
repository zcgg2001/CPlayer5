import { createPlaybackSession } from './playback-session.js';
import { normalizeMediaUrl } from './security.js';
import { bilibiliVideoUrl } from './music-data.js';

// Owns audio commands and request lifetimes; views receive only current-session events.
export function createPlaybackController({
    audio, preloadAudio, musicService, queueStore,
    baseUrl = globalThis.location?.href,
    setTimer = setTimeout, clearTimer = clearTimeout,
    replaceSource, mediaTimeoutMs = 8000, stallTimeoutMs = 8000,
} = {}) {
    const state = {
        currentSong: null, transitionPending: false,
        quality: { controller: null, version: 0, songLoading: false },
    };
    const sessions = createPlaybackSession();
    let commandVersion = 0;
    let preloadController = null;
    let preloadedSong = null;
    let activeLoad = null;
    const mediaUrl = url => normalizeMediaUrl(url, { baseUrl });
    const songId = song => song?.id ?? song;

    function cancelPreload() {
        preloadController?.abort();
        preloadController = null;
        preloadedSong = null;
        if (preloadAudio?.src) {
            preloadAudio.removeAttribute('src');
            preloadAudio.load();
        }
    }

    async function preloadNext() {
        if (musicService.config?.source !== 'chksz') return;
        if (!preloadAudio || !queueStore.state.playlist.length) return;
        const next = queueStore.state.playlist[queueStore.next()];
        if (next == null || bilibiliVideoUrl(next) || preloadedSong === next) return;
        preloadController?.abort();
        const controller = new AbortController();
        preloadController = controller;
        try {
            const data = await musicService.getSong(songId(next), {
                song: typeof next === 'object' ? next : null, signal: controller.signal,
            });
            if (controller.signal.aborted || queueStore.state.playlist[queueStore.next()] !== next) return;
            const url = mediaUrl(data?.url);
            if (url) {
                preloadAudio.src = url;
                preloadAudio.load();
                preloadedSong = next;
            }
        } catch { /* Preloading is optional. */ }
        finally { if (preloadController === controller) preloadController = null; }
    }

    async function load(id, songOverride = null, view = {}, options = {}) {
        const session = sessions.start();
        const isCurrent = () => sessions.isCurrent(session);
        commandVersion += 1;
        state.transitionPending = false;
        cancelPreload();
        state.quality.controller?.abort();
        state.quality.controller = null;
        state.quality.version += 1;
        state.quality.songLoading = true;
        audio.pause?.();
        view.onLoading?.();
        const queuedSong = songOverride || queueStore.state.playlist.find(song => (
            typeof song === 'object' && String(song.id) === String(id)
        )) || null;
        const automatic = typeof musicService.playbackCandidates === 'function';
        const routeOptions = { song: queuedSong, signal: session.signal, level: options.level,
            onAttempt: info => { if (isCurrent()) view.onAttempt?.(info); } };
        const iterator = automatic ? musicService.playbackCandidates(id, routeOptions)
            : (async function* () { yield await musicService.getSong(id, routeOptions); })();
        const active = { id, original: queuedSong, view, session, attempting: false, recovering: false,
            wantsPlay: options.shouldPlay !== false, position: options.resumeAt || 0 };
        activeLoad = active;
        let stallTimer = null, lastTime = 0, mediaGeneration = 0;
        const stopStall = () => { if (stallTimer !== null) clearTimer(stallTimer); stallTimer = null; };
        const mediaError = () => Object.assign(new Error('音频无法播放'), { mediaCode: audio.error?.code });
        const startAudio = (url, position, shouldPlay) => new Promise((resolve, reject) => {
            let settled = false, timer;
            const finish = error => {
                if (settled) return;
                settled = true; clearTimer(timer);
                audio.removeEventListener?.('loadedmetadata', loaded);
                audio.removeEventListener?.('error', failed);
                session.signal.removeEventListener('abort', aborted);
                error ? reject(error) : resolve();
            };
            const loaded = () => {
                if (!isCurrent()) return;
                if (position > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(position, Math.max(0, audio.duration - 0.25));
                if (!shouldPlay) finish();
            };
            const failed = () => finish(mediaError());
            const aborted = () => finish(new DOMException('Playback superseded', 'AbortError'));
            timer = setTimer(() => finish(Object.assign(new Error('音频加载超时'), { mediaCode: 2 })), mediaTimeoutMs);
            audio.addEventListener?.('loadedmetadata', loaded);
            audio.addEventListener?.('error', failed);
            session.signal.addEventListener('abort', aborted, { once: true });
            if (!isCurrent()) return aborted();
            try {
                audio.src = url;
                if (shouldPlay) Promise.resolve(audio.play()).then(() => { loaded(); finish(); }, finish);
                else audio.load?.();
            } catch (error) { finish(error); }
        });
        async function advance(feedback, position = 0) {
            active.attempting = true;
            state.quality.songLoading = true;
            stopStall();
            try {
                while (isCurrent()) {
                    const next = await iterator.next(feedback); feedback = undefined;
                    if (!isCurrent()) return;
                    if (next.done) throw Object.assign(new Error('当前歌曲的可用音源已尝试完毕'), { code: 'playback_exhausted' });
                    const data = next.value, url = mediaUrl(data?.url);
                    const generation = ++mediaGeneration;
                    const isMediaCurrent = () => isCurrent() && generation === mediaGeneration;
                    if (!url) throw new Error('Invalid media URL');
                    const coverOptions = { baseUrl, allowDataImage: true };
                    const cover = normalizeMediaUrl(queuedSong?.cover || data.cover, coverOptions)
                        || normalizeMediaUrl(data.cover, coverOptions) || '';
                    const playbackData = { ...queuedSong, ...data, id: queuedSong?.id || id, url, cover,
                        name: queuedSong?.name || data.name, artist: queuedSong?.artist || data.artist,
                        album: queuedSong?.album || data.album || '' };
                    state.currentSong = playbackData;
                    view.onResolved?.(data, playbackData);
                    let blocked = false;
                    const began = Date.now();
                    try { await startAudio(url, position, active.wantsPlay); }
                    catch (error) {
                        if (!isCurrent()) return;
                        if (error?.name === 'NotAllowedError') { blocked = true; active.wantsPlay = false; view.onAutoplayBlocked?.(error); }
                        else if (automatic) {
                            musicService.recordPlaybackFailure?.(data, error);
                            feedback = { error, skipProvider: error.mediaCode === 2 };
                            view.onRecovering?.({ reason: '当前资源无法播放，正在尝试其他音质或音源…' });
                            audio.pause?.();
                            continue;
                        } else throw error;
                    }
                    if (!isCurrent()) return;
                    if (!blocked && active.wantsPlay) musicService.recordPlaybackSuccess?.(data, Date.now()-began+(data.routing?.resolveMs||0));
                    view.onStarted?.(data, playbackData, { signal: session.signal, isCurrent:isMediaCurrent, recovering: active.recovering });
                    Promise.resolve().then(() => isMediaCurrent() ? musicService.getLyric(id, { song: playbackData, signal: session.signal }) : null)
                        .then(lyrics => { if (isMediaCurrent()) view.onLyrics?.(lyrics, data, playbackData); })
                        .catch(error => { if (isMediaCurrent()) view.onLyricsError?.(error); });
                    if (!automatic) setTimer(() => { if (isCurrent()) (view.onPreload ? view.onPreload() : preloadNext()); }, 2000);
                    return;
                }
            } catch (error) {
                if (isCurrent()) { active.wantsPlay = false; view.onError?.(error); }
            } finally {
                active.attempting = false;
                if (isCurrent()) { state.quality.songLoading = false; view.onSettled?.(); }
            }
        }
        async function recover(error) {
            if (!automatic || !isCurrent() || active.attempting || !active.wantsPlay) return;
            active.recovering = true;
            mediaGeneration += 1;
            const position = audio.currentTime || 0;
            musicService.recordPlaybackFailure?.(state.currentSong, error);
            view.onRecovering?.({ reason: '播放连接中断，正在自动切换音源…' });
            // Set before pause: recovery must retain the user's playback intent.
            active.attempting = true;
            audio.pause?.();
            await advance({ error, skipProvider: error.mediaCode === 2 }, position);
        }
        const onError = () => { void recover(mediaError()); };
        const onWaiting = () => {
            if (!automatic || active.attempting || !active.wantsPlay || audio.paused || stallTimer !== null) return;
            const position = audio.currentTime;
            stallTimer = setTimer(() => {
                stallTimer = null;
                if (!audio.paused && audio.currentTime <= position + 0.1) void recover(Object.assign(new Error('缓冲超时'), { mediaCode: 2 }));
            }, stallTimeoutMs);
        };
        const onPlaying = () => { stopStall(); active.wantsPlay = true; };
        const onProgress = () => { if (audio.currentTime > lastTime + 0.1) stopStall(); lastTime = audio.currentTime; };
        const onPause = () => { stopStall(); if (!active.attempting && !audio.error) active.wantsPlay = false; };
        const listeners = { error:onError, waiting:onWaiting, stalled:onWaiting, playing:onPlaying, timeupdate:onProgress, pause:onPause };
        for (const [event, handler] of Object.entries(listeners)) audio.addEventListener?.(event, handler);
        session.signal.addEventListener('abort', () => {
            stopStall();
            for (const [event, handler] of Object.entries(listeners)) audio.removeEventListener?.(event, handler);
        }, { once:true });
        await advance(undefined, active.position);
    }

    async function toggle(view = {}) {
        if (state.transitionPending) return;
        const version = ++commandVersion;
        const shouldPlay = audio.paused || audio.ended;
        state.transitionPending = true;
        view.onPending?.(true);
        try {
            if (shouldPlay) await audio.play();
            else audio.pause();
        } catch (error) {
            if (version === commandVersion) view.onError?.(error);
        } finally {
            if (version === commandVersion) {
                state.transitionPending = false;
                view.onPending?.(false);
                view.onSettled?.();
            }
        }
    }

    function replaceAudioSource(url, resumeAt, shouldResume, signal) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimer(timer);
                audio.removeEventListener('loadedmetadata', loaded);
                audio.removeEventListener('error', failed);
                signal.removeEventListener('abort', aborted);
                error ? reject(error) : resolve();
            };
            const aborted = () => finish(new DOMException('Playback superseded', 'AbortError'));
            const failed = () => finish(new Error('Audio source failed'));
            const loaded = async () => {
                if (signal.aborted) return aborted();
                if (Number.isFinite(audio.duration) && resumeAt > 0) {
                    audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
                }
                if (shouldResume) {
                    try { await audio.play(); } catch { /* User can resume with the play button. */ }
                }
                finish();
            };
            const timer = setTimer(() => finish(new Error('Audio metadata timed out')), 10_000);
            signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) return aborted();
            audio.addEventListener('loadedmetadata', loaded);
            audio.addEventListener('error', failed);
            try { audio.src = url; audio.load(); } catch (error) { finish(error); }
        });
    }

    async function changeQuality(level, view = {}) {
        if (state.quality.songLoading || !state.currentSong?.id || state.currentSong.provider === 'bilibili') return;
        if (activeLoad && typeof musicService.playbackCandidates === 'function') {
            const previous = activeLoad, position = audio.currentTime || 0, shouldPlay = !audio.paused;
            view.onStart?.();
            return load(previous.id, previous.original, {
                ...previous.view,
                onStarted(data, song, session) { previous.view.onStarted?.(data, song, { ...session, recovering:true }); view.onSuccess?.(data); },
                onError(error) { previous.view.onError?.(error); view.onError?.(error); },
                onSettled() { previous.view.onSettled?.(); view.onSettled?.(); },
            }, { level, resumeAt:position, shouldPlay });
        }
        state.quality.controller?.abort();
        cancelPreload();
        const controller = new AbortController();
        const version = ++state.quality.version;
        state.quality.controller = controller;
        const song = state.currentSong;
        const previousSrc = audio.src;
        const resumeAt = audio.currentTime || 0;
        const shouldResume = !audio.paused;
        const isCurrent = () => !controller.signal.aborted && version === state.quality.version && state.currentSong?.id === song.id;
        const replace = url => (view.replaceAudioSource || replaceSource || replaceAudioSource)(url, resumeAt, shouldResume, controller.signal);
        view.onStart?.();
        try {
            const data = await musicService.getSong(song.id, { song, level, signal: controller.signal });
            if (!isCurrent()) return;
            const url = mediaUrl(data?.url);
            if (!url) throw new Error('Invalid media URL');
            await replace(url);
            if (!isCurrent()) return;
            state.currentSong = { ...song, ...data, url, cover: song.cover };
            view.onSuccess?.(data);
        } catch (error) {
            if (!isCurrent()) return;
            if (previousSrc && audio.src !== previousSrc) {
                try { await replace(previousSrc); } catch { /* Keep controls available for retry. */ }
            }
            if (isCurrent()) view.onError?.(error);
        } finally {
            if (isCurrent()) {
                state.quality.controller = null;
                view.onSettled?.();
            }
        }
    }

    async function ended(view = {}) {
        if (!queueStore.state.playlist.length) {
            state.transitionPending = false;
            view.onEmpty?.();
        } else if (queueStore.state.playMode === 'single') {
            const version = ++commandVersion;
            audio.currentTime = 0;
            try { await audio.play(); }
            catch (error) { if (version === commandVersion) view.onError?.(error); }
        } else view.onNext?.();
    }

    return { state, load, toggle, changeQuality, preloadNext, ended };
}
