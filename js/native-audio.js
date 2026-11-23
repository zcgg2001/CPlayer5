// The website uses HTMLAudioElement; the Android host provides an origin-scoped
// message port backed by Media3. Blob/local audio keeps the browser path.
export function createPlayerAudio({
  bridge = globalThis.CPlayerNative,
  createAudio = () => new Audio(),
  now = () => performance.now(),
} = {}) {
  if (!bridge?.postMessage) return createAudio();
  const local = createAudio(),
    events = new EventTarget();
  let native = true,
    token = 0,
    src = "",
    volume = 1,
    muted = false,
    pending = [],
    position = 0,
    sampled = now(),
    metadata = {},
    loadedMediaId = "";
  const mediaId = song => `${song.provider || 'gd'}:${song.sourceId || song.id || ''}`;
  let state = {
    paused: true,
    playing: false,
    ended: false,
    duration: NaN,
    readyState: 0,
    playbackRate: 1,
    error: null,
    buffered: 0,
  };
  const emit = (name) => events.dispatchEvent(new Event(name));
  const send = (op, extra = {}) =>
    bridge.postMessage(JSON.stringify({ op, token, ...extra }));
  const settle = (error) => {
    const callbacks = pending;
    pending = [];
    for (const item of callbacks) error ? item.reject(error) : item.resolve();
  };
  const currentTime = () =>
    Math.min(
      Number.isFinite(state.duration) ? state.duration : Infinity,
      position +
        (state.playing && !state.paused && !state.ended
          ? ((now() - sampled) / 1000) * state.playbackRate
          : 0),
    );
  for (const event of [
    "play",
    "playing",
    "pause",
    "waiting",
    "stalled",
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "progress",
    "seeking",
    "seeked",
    "ended",
    "error",
    "emptied",
    "volumechange",
  ]) {
    local.addEventListener(event, () => {
      if (!native) emit(event);
    });
  }
  bridge.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "action") {
      events.dispatchEvent(
        new CustomEvent("nativeaction", { detail: data.action }),
      );
      return;
    }
    if (!native || data.token !== token || data.type !== "state") return;
    if (data.error) {
      // Failure packets contain no clock sample. Keep the last position so
      // playback-controller can resume a replacement source at the same point.
      position = currentTime();
      sampled = now();
      state = {
        ...state,
        playing: false,
        error: { code: data.error.code, message: data.error.message },
      };
      settle(
        Object.assign(new Error(state.error.message), {
          mediaCode: state.error.code,
        }),
      );
      emit("error");
      return;
    }
    const previous = state;
    position = Math.max(0, Number(data.position) || 0);
    sampled = now();
    state = {
      ...state,
      paused: !data.playWhenReady,
      playing: Boolean(data.playing),
      ended: Boolean(data.ended),
      duration:
        Number.isFinite(data.duration) && data.duration > 0
          ? data.duration
          : NaN,
      readyState: data.ready ? 4 : 0,
      buffered: Number(data.buffered) || 0,
      error: data.error
        ? { code: data.error.code, message: data.error.message }
        : null,
    };
    if (state.readyState && !previous.readyState) emit("loadedmetadata");
    if (state.duration !== previous.duration && Number.isFinite(state.duration))
      emit("durationchange");
    if (!state.paused && previous.paused) emit("play");
    if (data.playing) {
      settle();
      if (!previous.playing) emit("playing");
    } else if (state.paused && !previous.paused) {
      settle(new DOMException("Playback paused", "AbortError"));
      emit("pause");
    } else if (data.buffering) emit("waiting");
    if (data.seeked) {
      emit("seeked");
    }
    emit("timeupdate");
    emit("progress");
    if (state.ended && !previous.ended) emit("ended");
  };
  const audio = {
    isNative: true,
    get usesNativeSession() {
      return native;
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    get src() {
      return src;
    },
    set src(value) {
      settle(new DOMException("Playback superseded", "AbortError"));
      local.pause();
      send("stop");
      token++;
      src = value || "";
      native = !src.startsWith("blob:");
      loadedMediaId = src ? metadata.mediaId : "";
      position = 0;
      sampled = now();
      state = {
        ...state,
        paused: true,
        playing: false,
        ended: false,
        readyState: 0,
        duration: NaN,
        error: null,
      };
      if (!native) {
        local.src = src;
        local.volume = volume;
        local.muted = muted;
      } else if (src)
        send("load", { url: src, volume: muted ? 0 : volume, ...metadata });
      emit("emptied");
    },
    get currentSrc() {
      return native ? src : local.currentSrc;
    },
    get currentTime() {
      return native ? currentTime() : local.currentTime;
    },
    set currentTime(value) {
      if (!native) {
        local.currentTime = value;
        return;
      }
      position = Math.max(0, Number(value) || 0);
      sampled = now();
      emit("seeking");
      send("seek", { position });
    },
    get duration() {
      return native ? state.duration : local.duration;
    },
    get paused() {
      return native ? state.paused : local.paused;
    },
    get ended() {
      return native ? state.ended : local.ended;
    },
    get readyState() {
      return native ? state.readyState : local.readyState;
    },
    get error() {
      return native ? state.error : local.error;
    },
    get seeking() {
      return native ? false : local.seeking;
    },
    get playbackRate() {
      return native ? state.playbackRate : local.playbackRate;
    },
    get buffered() {
      return native
        ? {
            length: state.buffered > 0 ? 1 : 0,
            start: () => 0,
            end: () => state.buffered,
          }
        : local.buffered;
    },
    get volume() {
      return volume;
    },
    set volume(value) {
      volume = Math.max(0, Math.min(1, Number(value) || 0));
      local.volume = volume;
      if (native) send("volume", { volume: muted ? 0 : volume });
      emit("volumechange");
    },
    get muted() {
      return muted;
    },
    set muted(value) {
      muted = Boolean(value);
      local.muted = muted;
      if (native) send("volume", { volume: muted ? 0 : volume });
      emit("volumechange");
    },
    set crossOrigin(value) {
      local.crossOrigin = value;
    },
    play() {
      if (!native) return local.play();
      if (!src) return Promise.reject(new Error("No audio source"));
      const result = new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
      send("play");
      return result;
    },
    pause() {
      if (!native) {
        local.pause();
        return;
      }
      position = currentTime();
      sampled = now();
      const wasPlaying = !state.paused;
      state.paused = true;
      send("pause");
      settle(new DOMException("Playback paused", "AbortError"));
      if (wasPlaying) emit("pause");
    },
    load() {
      if (!native) local.load();
      else if (!src) send("stop");
    },
    removeAttribute(name) {
      if (name === "src") audio.src = "";
    },
    fastSeek(value) {
      audio.currentTime = value;
    },
    setMetadata(song) {
      // Stage metadata for the next load. The previous source may still be active.
      metadata = {
        mediaId: mediaId(song),
        title: song.name || "",
        artist: song.artist || "",
        album: song.album || "",
        ...(song.playbackSource ? { importedAudio: true } : {}),
      };
    },
    setArtwork(song, cover) {
      if (!native || !src || song.url !== src || mediaId(song) !== loadedMediaId) return;
      let artworkUri = "";
      try {
        if (cover) {
          const url = new URL(cover, globalThis.location?.href);
          if (url.protocol === "https:") artworkUri = url.href;
        }
      } catch { /* Missing covers retain the system's music icon. */ }
      send("artwork", { mediaId: loadedMediaId, artworkUri });
    },
  };
  return audio;
}
