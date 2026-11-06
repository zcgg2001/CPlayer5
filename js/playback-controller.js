import { createPlaybackSession } from './playback-session.js';
import { normalizeMediaUrl } from './security.js';
import { bilibiliVideoUrl } from './music-data.js';

// Owns audio commands and request lifetimes; views receive only current-session events.
export function createPlaybackController({
    audio, preloadAudio, musicService, queueStore,
    baseUrl = globalThis.location?.href,
    setTimer = setTimeout, clearTimer = clearTimeout,
    replaceSource,
} = {}) {
    const state = {
        currentSong: null, transitionPending: false,
        quality: { controller: null, version: 0, songLoading: false },
    };
    const sessions = createPlaybackSession();
    let commandVersion = 0;
    let preloadController = null;
    let preloadedSong = null;
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
        if (musicService.config?.source === 'gd') return;
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

    async function load(id, songOverride = null, view = {}) {
        const session = sessions.start();
        const isCurrent = () => sessions.isCurrent(session);
        commandVersion += 1;
        state.transitionPending = false;
        cancelPreload();
        state.quality.controller?.abort();
        state.quality.controller = null;
        state.quality.version += 1;
        state.quality.songLoading = true;
        view.onLoading?.();
        try {
            const queuedSong = songOverride || queueStore.state.playlist.find(song => (
                typeof song === 'object' && String(song.id) === String(id)
            )) || null;
            const data = await musicService.getSong(id, { song: queuedSong, signal: session.signal });
            if (!isCurrent()) return;
            const url = mediaUrl(data?.url);
            if (!url) throw new Error('Invalid media URL');
            const coverOptions = { baseUrl, allowDataImage: true };
            const cover = normalizeMediaUrl(queuedSong?.cover || data.cover, coverOptions)
                || normalizeMediaUrl(data.cover, coverOptions) || '';
            const playbackData = {
                ...data, ...queuedSong, url, cover,
                provider: data.provider || queuedSong?.provider,
                source: data.source || queuedSong?.source,
                br: data.br || data.bitrate || 0,
                downloadAllowed: data.downloadAllowed,
                album: queuedSong?.album || data.album || '',
            };
            state.currentSong = playbackData;
            audio.src = url;
            view.onResolved?.(data, playbackData);
            try { await audio.play(); }
            catch (error) {
                if (!isCurrent()) return;
                if (error?.name !== 'NotAllowedError') throw error;
                view.onAutoplayBlocked?.(error);
            }
            if (!isCurrent()) return;
            view.onStarted?.(data, playbackData, { signal: session.signal, isCurrent });
            // Lyrics are non-critical; failed or stale lyrics must never fail audio playback.
            Promise.resolve().then(() => {
                if (!isCurrent()) return null;
                return musicService.getLyric(id, { song: playbackData, signal: session.signal });
            }).then(lyrics => {
                if (isCurrent()) view.onLyrics?.(lyrics, data, playbackData);
            }).catch(error => {
                if (isCurrent()) view.onLyricsError?.(error);
            });
            setTimer(() => { if (isCurrent()) (view.onPreload ? view.onPreload() : preloadNext()); }, 2000);
        } catch (error) {
            if (isCurrent()) view.onError?.(error);
        } finally {
            if (isCurrent()) {
                state.quality.songLoading = false;
                view.onSettled?.();
            }
        }
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
