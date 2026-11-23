import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerAudio } from "../js/native-audio.js";
function fixture() {
  let now = 0;
  const calls = [],
    bridge = { postMessage: (body) => calls.push(JSON.parse(body)) };
  const local = Object.assign(new EventTarget(), {
    pause() {},
    load() {},
    play: async () => {},
    volume: 1,
  });
  const audio = createPlayerAudio({
    bridge,
    createAudio: () => local,
    now: () => now,
  });
  const state = (data = {}) =>
    bridge.onmessage({
      data: JSON.stringify({
        type: "state",
        token: calls.findLast((c) => c.op === "load")?.token,
        position: 0,
        duration: 100,
        ready: true,
        playWhenReady: true,
        playing: true,
        ...data,
      }),
    });
  return {
    audio,
    calls,
    local,
    state,
    advance: (ms) => {
      now += ms;
    },
  };
}
test("ordinary browsers retain HTML audio and native metadata arrives with the new source", async () => {
  const fallback = {};
  assert.equal(
    createPlayerAudio({ bridge: null, createAudio: () => fallback }),
    fallback,
  );
  const f = fixture();
  f.audio.setMetadata({ name: "Song", artist: "Artist" });
  f.audio.src = "https://media.test/song.flac";
  assert.equal(f.calls.find((c) => c.op === "load").title, "Song");
  let started = false,
    playing = 0;
  f.audio.addEventListener("playing", () => playing++);
  const play = f.audio.play().then(() => (started = true));
  f.state({ playing: false });
  await Promise.resolve();
  assert.equal(started, false);
  f.state();
  await play;
  assert.equal(playing, 1);
  f.advance(500);
  assert.equal(f.audio.currentTime, 0.5);
  f.state({ position: 1, playing: false, ready: false });
  f.advance(1000);
  assert.equal(f.audio.currentTime, 1);
});
test("late native messages cannot replace a new song, pause rejects waiting play, and errors recover", async () => {
  const f = fixture();
  f.audio.src = "https://media.test/old";
  const old = f.audio.play();
  f.audio.src = "https://media.test/new";
  await assert.rejects(old, { name: "AbortError" });
  f.state({ token: 1, position: 90 });
  assert.equal(f.audio.currentTime, 0);
  const paused = f.audio.play();
  f.audio.pause();
  await assert.rejects(paused, { name: "AbortError" });
  const bad = f.audio.play();
  let errors = 0;
  f.audio.addEventListener("error", () => errors++);
  f.state({ error: { code: 2, message: "Disconnected" } });
  await assert.rejects(bad, { mediaCode: 2 });
  assert.equal(errors, 1);
});
test("blob audio uses the browser and forwards its events", async () => {
  const f = fixture();
  f.audio.src = "blob:https://music.test/local";
  assert.equal(f.audio.usesNativeSession, false);
  let plays = 0;
  f.audio.addEventListener("playing", () => plays++);
  await f.audio.play();
  f.local.dispatchEvent(new Event("playing"));
  assert.equal(plays, 1);
  assert.equal(f.local.src, f.audio.src);
  assert.equal(
    f.calls.some((c) => c.op === "load"),
    false,
  );
});

test("native metadata belongs to its load and late artwork cannot repaint another source", () => {
  const f = fixture();
  const first = { id: '101', provider: 'gd', name: 'First', url: 'https://media.test/first' };
  const second = { id: '102', provider: 'gd', name: 'Second', url: 'https://media.test/second' };
  f.audio.setMetadata(first);
  f.audio.src = first.url;
  assert.equal(f.audio.usesNativeSession, true);
  f.audio.setArtwork(first, 'https://music.test/api/cover?url=first');
  assert.equal(f.calls.at(-1).op, 'artwork');
  const before = f.calls.length;
  f.audio.setMetadata(second);
  assert.equal(f.calls.length, before);
  f.audio.src = second.url;
  assert.equal(f.calls.at(-1).mediaId, 'gd:102');
  assert.equal(f.calls.at(-1).title, 'Second');
  const loaded = f.calls.length;
  f.audio.setArtwork(first, 'https://music.test/api/cover?url=first');
  f.audio.setArtwork({ ...second, provider: 'qq' }, 'https://music.test/api/cover?url=wrong');
  assert.equal(f.calls.length, loaded);
  f.audio.setArtwork(second, 'https://music.test/api/cover?url=second');
  assert.equal(f.calls.at(-1).mediaId, 'gd:102');
  assert.equal(f.calls.at(-1).token, 2);
  f.audio.setArtwork(second, 'data:image/svg+xml,invalid');
  assert.equal(f.calls.at(-1).artworkUri, '');
  f.audio.removeAttribute('src');
  const stopped = f.calls.length;
  f.audio.setArtwork(second, 'https://music.test/api/cover?url=late');
  assert.equal(f.calls.length, stopped);
});
test("native failure packets retain position for source recovery", () => {
  const f = fixture();
  f.audio.src = "https://media.test/song";
  f.state({ position: 42 });
  f.advance(500);
  f.state({
    position: undefined,
    duration: undefined,
    error: { code: 2, message: "Disconnected" },
  });
  assert.equal(f.audio.currentTime, 42.5);
  assert.equal(f.audio.duration, 100);
  f.advance(1000);
  assert.equal(f.audio.currentTime, 42.5);
});
