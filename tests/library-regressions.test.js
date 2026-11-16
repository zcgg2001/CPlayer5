import test from "node:test";
import assert from "node:assert/strict";
import { cleanSong, cleanEntity, songKey } from "../js/library-data.js";
import { cleanRecords } from "../js/account-data.js";
import { createPersonalLibraryStore } from "../js/personal-library-store.js";
test("opaque channel IDs and selected provider survive favorites, playlists and cloud projection", () => {
  const song = {
    id: "jianbin-qq:" + encodeURIComponent("https://jbsou.cn/api.php?id=123"),
    sourceId: "https://jbsou.cn/api.php?id=123",
    provider: "jianbin-qq",
    preferredProvider: "jianbin-qq",
    name: "测试",
    url: "https://secret.test/audio",
  };
  const cleaned = cleanSong(song);
  assert.equal(cleaned.preferredProvider, song.preferredProvider);
  assert.equal(cleaned.sourceId, song.sourceId);
  assert.equal(cleaned.url, undefined);
  const records = cleanRecords({
    ["favorite:" + songKey(song)]: song,
    queue: { songs: [song] },
    "playlist:test": { songs: [song] },
  });
  assert.equal(records.queue.songs[0].preferredProvider, "jianbin-qq");
  const album = {
    type: "album",
    id: "album:" + encodeURIComponent("测试专辑|歌手"),
    provider: "netease",
    name: "测试专辑",
  };
  assert.equal(cleanEntity(album).id, album.id);
  assert.doesNotThrow(() =>
    cleanRecords({ ["entity:album:netease:" + album.id]: album }),
  );
  for (const id of ["bad%ZZ", "<script>", "x\ny", ""])
    assert.throws(() => cleanSong({ ...song, id }));
});
test("listening statistics use the local calendar at a month boundary", () => {
  const old = process.env.TZ;
  process.env.TZ = "Asia/Shanghai";
  try {
    const data = new Map(),
      store = createPersonalLibraryStore({
        storage: {
          getItem: (k) => data.get(k),
          setItem: (k, v) => data.set(k, v),
        },
        now: () => Date.parse("2026-11-01T00:30:00+08:00"),
      });
    store.record({
      sessionId: "s",
      deviceId: "d",
      song: { id: "1", artist: "测试" },
      seconds: 10,
      position: 10,
      first: true,
    });
    assert.equal(store.records()["listen:2026-11:d"].days["01"], 10);
    assert.equal(store.records()["listen:2026-10:d"], undefined);
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
