# 音乐下载与音质选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让桌面网页端的搜索结果、新歌速递与当前播放歌曲支持单曲下载，并能选择音质和自动降级。

**Architecture:** 新建 js/music-download.js，集中管理音质档位、向低档位降级、文件名安全化和 Blob 下载。页面只将现有 MusicService、三个下载入口和原生对话框连接到该模块；Service Worker 只缓存模块，不缓存下载音频。

**Tech Stack:** 原生 ES Modules、HTML dialog、Fetch/Blob/Object URL、Vanilla JavaScript、Node 内置测试、Python unittest。

## Global Constraints

- 保持 MIT、静态部署和 Vanilla JavaScript；不增加依赖、服务端代理、账号体系或下载历史。
- 仅实现单曲下载；不批量下载歌单，不写入 IndexedDB 或 Service Worker 音频缓存。
- 支持 standard、exhigh、lossless、hires、jymaster；不可用时只能向更低档位降级。
- 所有远程音频 URL 必须通过 normalizeMediaUrl；下载失败不能影响播放队列或播放音质。
- 所有图标按钮必须有中文可访问名称；对话框须有可访问标题和状态播报。

## File Structure

- Create: js/music-download.js — 可单测的下载核心。
- Create: tests/music-download.test.js — 音质降级、文件名、URL 校验与 Blob 下载测试。
- Modify: index.html — 下载入口、对话框、MusicService 按档位请求和 UI 连接。
- Modify: css/app-shell.css — 下载入口、操作区、对话框样式。
- Modify: sw.js — 预缓存下载模块，升级 shell 缓存。
- Modify: tests/test_desktop_shell_markup.py、tests/test_accessibility_markup.py、tests/test_startup_behavior.py、tests/test_pwa_contract.py、tests/service-worker.test.js。
- Modify: README.md — 说明下载范围和浏览器限制。

---

### Task 1: 建立可测试的下载核心

**Files:**
- Create: js/music-download.js
- Test: tests/music-download.test.js

**Interfaces:**
- Consumes: normalizeMediaUrl(value, { baseUrl }) from js/security.js.
- Produces: DOWNLOAD_QUALITY_OPTIONS, downloadFallbackLevels(level), resolveDownloadSong(options), downloadFilename(song, level), saveAudioBlob(options).

- [ ] **Step 1: Write the failing test**

Create tests/music-download.test.js:

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import {
      downloadFallbackLevels, downloadFilename, resolveDownloadSong, saveAudioBlob,
    } from '../js/music-download.js';

    test('starts fallback at the selected quality and only descends', () => {
      assert.deepEqual(downloadFallbackLevels('jymaster'), ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']);
      assert.deepEqual(downloadFallbackLevels('lossless'), ['lossless', 'exhigh', 'standard']);
    });

    test('resolves the first safe URL from the selected fallback chain', async () => {
      const seen = [];
      const song = await resolveDownloadSong({
        id: 7, level: 'lossless', baseUrl: 'https://player.example/',
        requestSong: async (_id, level) => {
          seen.push(level);
          return level === 'exhigh' ? { id: 7, name: 'A', artist: 'B', url: 'https://media.example/a.mp3' } : null;
        },
      });
      assert.deepEqual(seen, ['lossless', 'exhigh']);
      assert.equal(song.resolvedLevel, 'exhigh');
    });

    test('rejects unsafe URLs and keeps download filenames safe', async () => {
      await assert.rejects(() => resolveDownloadSong({
        id: 7, level: 'standard', baseUrl: 'https://player.example/',
        requestSong: async () => ({ url: 'javascript:alert(1)' }),
      }), /No downloadable audio/);
      assert.equal(downloadFilename({ name: 'A/B', artist: 'C:D', url: 'https://media.example/a.flac' }, 'lossless'), 'A B - C D - 无损.flac');
    });

    test('saves a fetched non-empty Blob through an object URL', async () => {
      const clicked = [];
      const revoked = [];
      const anchor = { click: () => clicked.push(true) };
      await saveAudioBlob({
        url: 'https://media.example/a.mp3', filename: 'a.mp3',
        fetchImpl: async () => ({ ok: true, blob: async () => new Blob(['music']) }),
        documentRef: { createElement: () => anchor, body: { append: () => {}, removeChild: () => {} } },
        urlApi: { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) },
      });
      assert.deepEqual(clicked, [true]);
      assert.deepEqual(revoked, ['blob:test']);
    });

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test tests/music-download.test.js

Expected: FAIL because js/music-download.js does not exist.

- [ ] **Step 3: Implement the minimal module**

Create js/music-download.js:

    import { normalizeMediaUrl } from './security.js';

    export const DOWNLOAD_QUALITY_OPTIONS = Object.freeze([
      { level: 'standard', label: '标准 128K' },
      { level: 'exhigh', label: '极高 320K' },
      { level: 'lossless', label: '无损' },
      { level: 'hires', label: 'Hi-Res' },
      { level: 'jymaster', label: '超清母带' },
    ]);

    const FALLBACKS = Object.freeze({
      standard: ['standard'],
      exhigh: ['exhigh', 'standard'],
      lossless: ['lossless', 'exhigh', 'standard'],
      hires: ['hires', 'lossless', 'exhigh', 'standard'],
      jymaster: ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'],
    });

    export function downloadFallbackLevels(level) {
      return [...(FALLBACKS[level] || FALLBACKS.jymaster)];
    }

    export async function resolveDownloadSong({ id, level, requestSong, baseUrl }) {
      for (const candidate of downloadFallbackLevels(level)) {
        const song = await requestSong(id, candidate);
        const url = normalizeMediaUrl(song?.url, { baseUrl });
        if (url) return { ...song, url, requestedLevel: level, resolvedLevel: candidate };
      }
      throw new Error('No downloadable audio available');
    }

    export function downloadFilename(song, level) {
      const clean = value => String(value || '未知').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim() || '未知';
      const label = DOWNLOAD_QUALITY_OPTIONS.find(option => option.level === level)?.label.replace(/\s+\d+K$/, '') || '标准';
      const extension = new URL(song.url).pathname.match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)?.[1] || 'mp3';
      return clean(song.name) + ' - ' + clean(song.artist) + ' - ' + label + '.' + extension;
    }

    export async function saveAudioBlob({ url, filename, fetchImpl = fetch, documentRef = document, urlApi = URL }) {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error('Download request failed: ' + response.status);
      const blob = await response.blob();
      if (!blob.size) throw new Error('Downloaded audio was empty');
      const objectUrl = urlApi.createObjectURL(blob);
      const anchor = documentRef.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.hidden = true;
      documentRef.body.append(anchor);
      anchor.click();
      documentRef.body.removeChild(anchor);
      urlApi.revokeObjectURL(objectUrl);
    }

- [ ] **Step 4: Run the new module test to verify it passes**

Run: node --test tests/music-download.test.js

Expected: 4 passing tests and 0 failures.

- [ ] **Step 5: Commit**

    git add js/music-download.js tests/music-download.test.js
    git commit -m "feat: add download quality resolver"

### Task 2: 添加桌面入口与无障碍下载对话框

**Files:**
- Modify: index.html
- Modify: css/app-shell.css
- Test: tests/test_desktop_shell_markup.py and tests/test_accessibility_markup.py

**Interfaces:**
- Consumes: #desktopDownloadBtn, #downloadDialog, #downloadDialogTitle, #downloadSongName, #downloadQuality, #downloadConfirm, #downloadCancel, #downloadStatus.
- Produces: 供 Task 3 使用的稳定 DOM 合约和不嵌套交互元素的新歌行操作区。

- [ ] **Step 1: Write failing static tests**

Add to tests/test_desktop_shell_markup.py:

    def test_desktop_download_controls_and_dialog_are_exposed(self):
        for element_id in (
            "desktopDownloadBtn", "downloadDialog", "downloadDialogTitle",
            "downloadSongName", "downloadQuality", "downloadConfirm", "downloadStatus",
        ):
            self.assertIn(element_id, self.markup.by_id)
        self.assertEqual(self.markup.by_id["desktopDownloadBtn"].get("aria-label"), "下载当前歌曲")
        self.assertEqual(self.markup.by_id["downloadDialog"]["tag"], "dialog")
        self.assertEqual(self.markup.by_id["downloadDialog"].get("aria-labelledby"), "downloadDialogTitle")
        self.assertEqual(self.markup.by_id["downloadStatus"].get("role"), "status")
        self.assertEqual(self.markup.by_id["downloadStatus"].get("aria-live"), "polite")

Add desktopDownloadBtn and downloadCancel to the appropriate button-name assertions in tests/test_accessibility_markup.py.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: python3 -m unittest tests.test_desktop_shell_markup tests.test_accessibility_markup -v

Expected: FAIL because the download DOM contract does not exist.

- [ ] **Step 3: Implement markup and CSS**

Place the disabled current-song button next to #desktopPlayerQueueBtn:

    <button id="desktopDownloadBtn" class="player-action-button" type="button" aria-label="下载当前歌曲" disabled>
      <i class="fas fa-download" aria-hidden="true"></i>
    </button>

Place this native dialog before the module script:

    <dialog id="downloadDialog" aria-labelledby="downloadDialogTitle">
      <form id="downloadDialogForm" method="dialog" class="download-dialog-card">
        <header class="download-dialog-header">
          <div><p class="download-dialog-kicker">DOWNLOAD</p><h2 id="downloadDialogTitle">下载歌曲</h2></div>
          <button id="downloadCancel" value="cancel" type="submit" aria-label="关闭下载窗口"><i class="fas fa-times" aria-hidden="true"></i></button>
        </header>
        <p id="downloadSongName" class="download-song-name"></p>
        <label for="downloadQuality">选择音质</label>
        <select id="downloadQuality" aria-label="下载音质"></select>
        <p id="downloadStatus" role="status" aria-live="polite" aria-atomic="true"></p>
        <button id="downloadConfirm" type="button"><i class="fas fa-download" aria-hidden="true"></i>下载</button>
      </form>
    </dialog>

Refactor createDiscoverySongRow from one outer button into article.discovery-song-row, with a button.discovery-song-play for the index/title/album cells and a sibling .discovery-song-actions with the existing play action plus a button.discovery-download. Do not nest a button in another button. The search-result div keeps its click-to-play callback; append a sibling button and call event.stopPropagation() before opening the dialog.

Append focused CSS:

    #desktopPlayerBar #desktopDownloadBtn:disabled { opacity: 0.45; cursor: not-allowed; }
    #desktopLibraryView .discovery-song-actions { display: inline-flex; justify-self: end; gap: 8px; }
    #desktopLibraryView .discovery-download { min-width: 36px; min-height: 36px; color: var(--shell-accent-strong); background: var(--shell-active); border: 0; border-radius: 10px; }
    #downloadDialog { width: min(420px, calc(100vw - 32px)); padding: 0; color: var(--shell-text); background: transparent; border: 0; }
    #downloadDialog::backdrop { background: rgba(30, 20, 45, 0.48); backdrop-filter: blur(4px); }
    #downloadDialog .download-dialog-card { display: grid; gap: 16px; padding: 24px; background: var(--shell-surface); border: 1px solid var(--shell-border); border-radius: 20px; box-shadow: var(--shell-shadow); }

- [ ] **Step 4: Run focused tests to verify they pass**

Run: python3 -m unittest tests.test_desktop_shell_markup tests.test_accessibility_markup -v

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

    git add index.html css/app-shell.css tests/test_desktop_shell_markup.py tests/test_accessibility_markup.py
    git commit -m "feat: add accessible download controls"

### Task 3: 连接音乐解析、对话框和三个下载入口

**Files:**
- Modify: index.html
- Test: tests/test_startup_behavior.py

**Interfaces:**
- Consumes: Task 1 exports and Task 2 DOM IDs.
- Produces: musicService.getSongAtLevel(id, level, { signal }), openDownloadDialog(song, opener), downloadSelectedSong(), and currentPlaybackSong.

- [ ] **Step 1: Write failing startup-behaviour assertions**

Add this test to tests/test_startup_behavior.py:

    def test_downloads_reuse_song_resolution_and_connect_all_desktop_entry_points(self):
        service = function_block(self.source, "class MusicService", "class LyricService")
        self.assertIn("async getSongAtLevel(id, level", service)
        self.assertIn("normalizeSongPayload(json, level)", service)
        self.assertIn("resolveDownloadSong({", self.source)
        self.assertIn("saveAudioBlob({", self.source)
        self.assertIn("openDownloadDialog(song,", self.source)
        self.assertIn("dom.desktopDownloadBtn", self.source)
        self.assertIn("downloadButton.addEventListener('click'", self.source)
        self.assertIn("currentPlaybackSong =", self.source)

- [ ] **Step 2: Run it to verify it fails**

Run: python3 -m unittest tests.test_startup_behavior.StartupBehaviorTests.test_downloads_reuse_song_resolution_and_connect_all_desktop_entry_points -v

Expected: FAIL because there is no download integration.

- [ ] **Step 3: Implement the minimal integration**

Add this import alongside the existing local modules:

    import {
      DOWNLOAD_QUALITY_OPTIONS, downloadFilename, resolveDownloadSong, saveAudioBlob,
    } from './js/music-download.js';

Split MusicService.getSong into an explicit per-level method and retain current playback fallback:

    async getSongAtLevel(id, level, { signal } = {}) {
      const url = this.baseUrl + '/163_music?id=' + id + '&level=' + level;
      const json = await requestJson(url, { signal });
      return normalizeSongPayload(json, level);
    }

    async getSong(id, { signal } = {}) {
      for (const level of SONG_QUALITY_FALLBACKS) {
        const song = await this.getSongAtLevel(id, level, { signal });
        if (song) return song;
      }
      throw new Error('ChKSz GetSong Failed');
    }

Add let currentPlaybackSong = null. After playbackData is calculated in loadAndPlaySong, assign it to currentPlaybackSong and set dom.desktopDownloadBtn.disabled = !currentPlaybackSong.id. Populate the select from DOWNLOAD_QUALITY_OPTIONS, use guarded localStorage calls for cp_download_quality, and add a downloadState object containing song and opener.

Implement and bind:

    function openDownloadDialog(song, opener) {
      if (!song?.id) return showToast('当前歌曲无法下载', true);
      downloadState = { song, opener };
      dom.downloadSongName.textContent = (song.name || '未知歌曲') + ' · ' + (song.artist || '未知艺术家');
      dom.downloadStatus.textContent = '';
      dom.downloadDialog.showModal();
    }

    async function downloadSelectedSong() {
      const song = downloadState.song;
      const level = dom.downloadQuality.value;
      dom.downloadConfirm.disabled = true;
      dom.downloadStatus.textContent = '正在解析下载地址...';
      try {
        const resolved = await resolveDownloadSong({
          id: song.id, level, baseUrl: window.location.href,
          requestSong: (id, candidate) => musicService.getSongAtLevel(id, candidate),
        });
        dom.downloadStatus.textContent = '正在准备文件...';
        await saveAudioBlob({ url: resolved.url, filename: downloadFilename({ ...song, url: resolved.url }, resolved.resolvedLevel) });
        dom.downloadDialog.close();
        showToast('已开始下载：' + resolved.resolvedLevel);
      } catch (error) {
        console.error('歌曲下载失败:', error);
        dom.downloadStatus.textContent = '下载失败：浏览器或网络阻止了音频文件读取';
      } finally {
        dom.downloadConfirm.disabled = false;
      }
    }

Bind #desktopDownloadBtn to openDownloadDialog(currentPlaybackSong, dom.desktopDownloadBtn). Search and discovery controls pass { id, name, artist, album, cover } to the same function and never insert into the queue. On dialog close, return focus to downloadState.opener when it is connected.

- [ ] **Step 4: Run focused behaviour test to verify it passes**

Run: python3 -m unittest tests.test_startup_behavior.StartupBehaviorTests.test_downloads_reuse_song_resolution_and_connect_all_desktop_entry_points -v

Expected: PASS.

- [ ] **Step 5: Commit**

    git add index.html tests/test_startup_behavior.py
    git commit -m "feat: connect music download workflow"

### Task 4: 保持 PWA 外壳与文档同步

**Files:**
- Modify: sw.js and README.md
- Test: tests/service-worker.test.js and tests/test_pwa_contract.py

**Interfaces:**
- Consumes: js/music-download.js.
- Produces: cplayer5-shell-v11, which precaches the module but no audio media files.

- [ ] **Step 1: Write failing PWA tests**

Add this Node test:

    test('precaches the music download runtime without precaching audio files', () => {
      const context = loadServiceWorker();
      const coreAssets = vm.runInContext('CORE_ASSETS', context);
      assert.ok(coreAssets.includes('./js/music-download.js'));
      assert.ok(!coreAssets.some(asset => asset.endsWith('.mp3') || asset.endsWith('.flac')));
    });

In tests/test_pwa_contract.py, expect: const SHELL_CACHE = 'cplayer5-shell-v11';.

- [ ] **Step 2: Run tests to verify they fail**

Run: node --test tests/service-worker.test.js && python3 -m unittest tests.test_pwa_contract -v

Expected: FAIL because the module is not precached and the cache is v10.

- [ ] **Step 3: Update cache and README**

Set SHELL_CACHE to cplayer5-shell-v11, include ./js/music-download.js in CORE_ASSETS, and update the cache retirement test. In README.md, state that search, new-song discovery and desktop player provide single-song downloads; five qualities are offered; unavailable qualities descend automatically; the browser must allow cross-origin audio retrieval.

- [ ] **Step 4: Run tests to verify they pass**

Run: node --test tests/service-worker.test.js && python3 -m unittest tests.test_pwa_contract -v

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

    git add sw.js tests/service-worker.test.js tests/test_pwa_contract.py README.md
    git commit -m "docs: describe music download support"

### Task 5: 完整回归与浏览器验收

**Files:**
- Verify only: local preview http://127.0.0.1:4185/.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: test and browser evidence for the complete feature.

- [ ] **Step 1: Run all checks**

    python3 -m unittest discover -s tests -v
    node --test tests/*.test.js
    python3 scripts/check_static_site.py
    git diff --check

Expected: every test passes, static-site checks succeed, and the final diff check has no output.

- [ ] **Step 2: Validate desktop browser interactions**

Reload the preview and verify:

1. A search result download button opens the dialog without adding the song to the queue.
2. A new-song row provides sibling “加入播放” and “下载” controls.
3. The player download button starts disabled, enables after a song loads, and leaves playback unchanged.
4. Choosing jymaster shows the selected preference; unavailable media reports the lower resolved quality or a precise failure.
5. Closing the dialog restores focus to the entry button.

- [ ] **Step 3: Commit only if browser verification requires a correction**

If no source changes are needed, do not create an empty commit. Otherwise use a focused fix commit.

## Plan Self-Review

- Spec coverage: Tasks 1 and 3 implement quality selection, descending resolution, safe Blob download and playback isolation; Task 2 provides the three UI paths and accessibility; Task 4 maintains PWA shell behaviour; Task 5 verifies automation and browser behaviour.
- Placeholder scan: no TODO, TBD, unresolved references, or deferred implementation markers.
- Type consistency: resolveDownloadSong consumes requestSong(id, level) from MusicService.getSongAtLevel, returns resolvedLevel consumed by downloadFilename and Toast text, and uses the Task 2 DOM IDs in Task 3.
