# 代码地图

本轮整理日期：2026-11-17。此清单覆盖 Git 中的程序、样式、测试与配置文件；不包含生成产物、字体、图片、历史设计稿或本地配置。第三方压缩脚本与样式保留原文件，不混入业务代码修改。

## 阅读顺序

1. `index.html` 只放主页面结构，`css/player-base.css` 放基础样式，`js/app.js` 负责启动与页面编排。
2. `js/music-service.js` 统一请求；`playback-router.js` 决定候选音源、匹配、音质降级和缓存；`playback-controller.js` 管理播放会话、超时和断线恢复。
3. `sites/worker.js` 接收同源 API；音源协议留在 `sites/*` 的独立适配器，客户端不持有服务密钥。`server.js` 复用这些模块做本地服务。
4. `js/lyrics/` 拆分歌词解析、时钟、渲染和背景；`js/personal-library*` 与 `account-*` 管理个人数据，服务端对应 `sites/accounts.js`、`sites/personal-library.js`。
5. `android/` 和 `desktop/` 是平台容器。Android 仅替换音频执行器，复用网页音源策略，见 [Android 说明](android.md)。

## 修改规则

- 改页面元素：同时检查 DOM / 无障碍测试；不要把业务模块移回 HTML。
- 改音源：适配器、来源注册、匹配及错误策略一并检查；保留 ChKSz 显式选择限制。
- 改同步数据：浏览器和服务端共用 `library-data.js` / `account-data.js` 投影规则；音频临时链接不可进入云数据。
- 新增浏览器模块：检查 `sw.js` 核心缓存列表；构建脚本会拷贝整个 `js/` 与 `css/`。
- 改 Android：运行构建、单元测试及 lint；网页测试不能替代模拟器/真机后台验证。
- `js/app.js` 仍是较大的页面编排文件。后续按设置面板、移动抽屉等独立行为逐步提取，避免仅按行数切割状态相关代码。

## 网页入口、构建与部署配置（12 个）

- [admin.html](../admin.html) — 24 行
- [cloudflare.config.ts](../cloudflare.config.ts) — 37 行
- [index.html](../index.html) — 1685 行
- [local-accounts.js](../local-accounts.js) — 49 行
- [local-music-key.js](../local-music-key.js) — 90 行
- [manifest.json](../manifest.json) — 26 行
- [offline.html](../offline.html) — 82 行
- [package.json](../package.json) — 36 行
- [playlist-downloader.html](../playlist-downloader.html) — 290 行
- [server.js](../server.js) — 217 行
- [sw.js](../sw.js) — 251 行
- [vite.config.js](../vite.config.js) — 29 行

## 前端业务模块（74 个）

- [js/account-data.js](../js/account-data.js) — 46 行
- [js/account-entry.js](../js/account-entry.js) — 71 行
- [js/account-library.js](../js/account-library.js) — 56 行
- [js/account-panel.js](../js/account-panel.js) — 153 行
- [js/account-sync.js](../js/account-sync.js) — 66 行
- [js/anime-progress-thumb.js](../js/anime-progress-thumb.js) — 167 行
- [js/app-shell.js](../js/app-shell.js) — 182 行
- [js/app.js](../js/app.js) — 6204 行
- [js/artwork.js](../js/artwork.js) — 206 行
- [js/cache-store.js](../js/cache-store.js) — 116 行
- [js/catalog-browser.js](../js/catalog-browser.js) — 192 行
- [js/catalog-service.js](../js/catalog-service.js) — 108 行
- [js/charts-page.js](../js/charts-page.js) — 552 行
- [js/color-thief.umd.js](../js/color-thief.umd.js) — 1 行
- [js/desktop-pet/index.js](../js/desktop-pet/index.js) — 576 行
- [js/desktop-pet/model.js](../js/desktop-pet/model.js) — 198 行
- [js/desktop-pet/settings.js](../js/desktop-pet/settings.js) — 38 行
- [js/discovery-home.js](../js/discovery-home.js) — 295 行
- [js/discovery-table.js](../js/discovery-table.js) — 161 行
- [js/download-session.js](../js/download-session.js) — 43 行
- [js/http.js](../js/http.js) — 139 行
- [js/i18n.js](../js/i18n.js) — 59 行
- [js/library-data.js](../js/library-data.js) — 70 行
- [js/library-transfer.js](../js/library-transfer.js) — 70 行
- [js/listening-room.js](../js/listening-room.js) — 185 行
- [js/lucide-bridge.js](../js/lucide-bridge.js) — 210 行
- [js/lucide.min.js](../js/lucide.min.js) — 12 行
- [js/lyric-catalog.js](../js/lyric-catalog.js) — 35 行
- [js/lyric-composition.js](../js/lyric-composition.js) — 163 行
- [js/lyric-effects.js](../js/lyric-effects.js) — 59 行
- [js/lyric-scenes.js](../js/lyric-scenes.js) — 154 行
- [js/lyrics/backgrounds/canvas.js](../js/lyrics/backgrounds/canvas.js) — 79 行
- [js/lyrics/backgrounds/fountain.js](../js/lyrics/backgrounds/fountain.js) — 50 行
- [js/lyrics/backgrounds/index.js](../js/lyrics/backgrounds/index.js) — 60 行
- [js/lyrics/clock.js](../js/lyrics/clock.js) — 25 行
- [js/lyrics/controller.js](../js/lyrics/controller.js) — 213 行
- [js/lyrics/document.js](../js/lyrics/document.js) — 225 行
- [js/lyrics/registry.js](../js/lyrics/registry.js) — 36 行
- [js/lyrics/renderers/stage.js](../js/lyrics/renderers/stage.js) — 97 行
- [js/lyrics/renderers/words.js](../js/lyrics/renderers/words.js) — 39 行
- [js/lyrics/runtime.js](../js/lyrics/runtime.js) — 121 行
- [js/lyrics/settings.js](../js/lyrics/settings.js) — 23 行
- [js/lyrics/sources.js](../js/lyrics/sources.js) — 39 行
- [js/music-catalog.js](../js/music-catalog.js) — 177 行
- [js/music-channels.js](../js/music-channels.js) — 28 行
- [js/music-data.js](../js/music-data.js) — 168 行
- [js/music-download.js](../js/music-download.js) — 59 行
- [js/music-explore.js](../js/music-explore.js) — 963 行
- [js/music-key-settings.js](../js/music-key-settings.js) — 120 行
- [js/music-service.js](../js/music-service.js) — 268 行
- [js/music-source-tabs.js](../js/music-source-tabs.js) — 105 行
- [js/native-audio.js](../js/native-audio.js) — 278 行
- [js/offline-audio.js](../js/offline-audio.js) — 60 行
- [js/oneko-butterfly.js](../js/oneko-butterfly.js) — 76 行
- [js/operations-panel.js](../js/operations-panel.js) — 95 行
- [js/page-scroll-spider.js](../js/page-scroll-spider.js) — 47 行
- [js/personal-library-store.js](../js/personal-library-store.js) — 67 行
- [js/personal-library.js](../js/personal-library.js) — 166 行
- [js/playback-cache.js](../js/playback-cache.js) — 57 行
- [js/playback-controller.js](../js/playback-controller.js) — 337 行
- [js/playback-router.js](../js/playback-router.js) — 184 行
- [js/playback-session.js](../js/playback-session.js) — 25 行
- [js/player-experience.js](../js/player-experience.js) — 90 行
- [js/queue-store.js](../js/queue-store.js) — 90 行
- [js/recommendation-model.js](../js/recommendation-model.js) — 148 行
- [js/recommendation-service.js](../js/recommendation-service.js) — 174 行
- [js/request-budget.js](../js/request-budget.js) — 18 行
- [js/runtime-policy.js](../js/runtime-policy.js) — 35 行
- [js/scroll-spider/appearance.js](../js/scroll-spider/appearance.js) — 119 行
- [js/scroll-spider/editor.js](../js/scroll-spider/editor.js) — 79 行
- [js/scroll-spider/index.js](../js/scroll-spider/index.js) — 423 行
- [js/security.js](../js/security.js) — 28 行
- [js/tailwindcss.js](../js/tailwindcss.js) — 83 行

## 页面与组件样式（26 个）

- [css/account.css](../css/account.css) — 56 行
- [css/all.min.css](../css/all.min.css) — 9 行
- [css/anime-progress-thumb.css](../css/anime-progress-thumb.css) — 171 行
- [css/app-shell.css](../css/app-shell.css) — 3154 行
- [css/art-direction.css](../css/art-direction.css) — 1360 行
- [css/artwork.css](../css/artwork.css) — 5 行
- [css/bilibili.css](../css/bilibili.css) — 358 行
- [css/charts.css](../css/charts.css) — 661 行
- [css/desktop-pet-settings.css](../css/desktop-pet-settings.css) — 32 行
- [css/discovery-home.css](../css/discovery-home.css) — 94 行
- [css/discovery.css](../css/discovery.css) — 204 行
- [css/listening-room.css](../css/listening-room.css) — 158 行
- [css/lyric-effects.css](../css/lyric-effects.css) — 121 行
- [css/lyric-scenes.css](../css/lyric-scenes.css) — 160 行
- [css/lyrics/runtime.css](../css/lyrics/runtime.css) — 96 行
- [css/music-catalog.css](../css/music-catalog.css) — 65 行
- [css/music-explore.css](../css/music-explore.css) — 915 行
- [css/music-source-tabs.css](../css/music-source-tabs.css) — 35 行
- [css/noto-sans-sc.css](../css/noto-sans-sc.css) — 32 行
- [css/oneko-butterfly.css](../css/oneko-butterfly.css) — 186 行
- [css/operations.css](../css/operations.css) — 7 行
- [css/page-scroll-spider.css](../css/page-scroll-spider.css) — 216 行
- [css/personal-library.css](../css/personal-library.css) — 5 行
- [css/player-base.css](../css/player-base.css) — 1340 行
- [css/player-experience.css](../css/player-experience.css) — 25 行
- [css/studio.css](../css/studio.css) — 618 行

## 同源服务端与音源适配（23 个）

- [sites/account-auth.js](../sites/account-auth.js) — 73 行
- [sites/accounts.js](../sites/accounts.js) — 110 行
- [sites/admin-bootstrap.js](../sites/admin-bootstrap.js) — 26 行
- [sites/bilibili.js](../sites/bilibili.js) — 369 行
- [sites/channel-http.js](../sites/channel-http.js) — 123 行
- [sites/channel-providers.js](../sites/channel-providers.js) — 196 行
- [sites/chksz.js](../sites/chksz.js) — 90 行
- [sites/cover-cache.js](../sites/cover-cache.js) — 47 行
- [sites/discovery-content.js](../sites/discovery-content.js) — 69 行
- [sites/gd.js](../sites/gd.js) — 165 行
- [sites/music-channels.js](../sites/music-channels.js) — 136 行
- [sites/music-content.js](../sites/music-content.js) — 672 行
- [sites/music-metadata.js](../sites/music-metadata.js) — 59 行
- [sites/op-music.js](../sites/op-music.js) — 160 行
- [sites/operations-api.js](../sites/operations-api.js) — 50 行
- [sites/operations-store.js](../sites/operations-store.js) — 68 行
- [sites/personal-library.js](../sites/personal-library.js) — 87 行
- [sites/playlist-import.js](../sites/playlist-import.js) — 31 行
- [sites/public-pages.js](../sites/public-pages.js) — 33 行
- [sites/reliability.js](../sites/reliability.js) — 129 行
- [sites/response-cache.js](../sites/response-cache.js) — 23 行
- [sites/worker.js](../sites/worker.js) — 268 行
- [sites/xinghai-music.js](../sites/xinghai-music.js) — 108 行

## 桌面壳（4 个）

- [desktop/main.cjs](../desktop/main.cjs) — 72 行
- [desktop/package.json](../desktop/package.json) — 9 行
- [desktop/policy.cjs](../desktop/policy.cjs) — 14 行
- [desktop/preload.cjs](../desktop/preload.cjs) — 6 行

## Android 壳与播放服务（13 个）

- [android/app/build.gradle](../android/app/build.gradle) — 27 行
- [android/app/src/main/AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml) — 23 行
- [android/app/src/main/java/tech/zc505/cplayer/BridgePolicy.java](../android/app/src/main/java/tech/zc505/cplayer/BridgePolicy.java) — 35 行
- [android/app/src/main/java/tech/zc505/cplayer/MainActivity.java](../android/app/src/main/java/tech/zc505/cplayer/MainActivity.java) — 163 行
- [android/app/src/main/java/tech/zc505/cplayer/PlaybackService.java](../android/app/src/main/java/tech/zc505/cplayer/PlaybackService.java) — 289 行
- [android/app/src/main/java/tech/zc505/cplayer/WebPlayerHost.java](../android/app/src/main/java/tech/zc505/cplayer/WebPlayerHost.java) — 162 行
- [android/app/src/main/res/drawable/ic_launcher.xml](../android/app/src/main/res/drawable/ic_launcher.xml) — 5 行
- [android/app/src/main/res/xml/data_extraction_rules.xml](../android/app/src/main/res/xml/data_extraction_rules.xml) — 4 行
- [android/app/src/test/java/tech/zc505/cplayer/BridgePolicyTest.java](../android/app/src/test/java/tech/zc505/cplayer/BridgePolicyTest.java) — 35 行
- [android/build.gradle](../android/build.gradle) — 1 行
- [android/gradle.properties](../android/gradle.properties) — 3 行
- [android/gradle/wrapper/gradle-wrapper.properties](../android/gradle/wrapper/gradle-wrapper.properties) — 8 行
- [android/settings.gradle](../android/settings.gradle) — 7 行

## 数据库迁移（5 个）

- [migrations/0001_accounts.sql](../migrations/0001_accounts.sql) — 23 行
- [migrations/0002_username.sql](../migrations/0002_username.sql) — 3 行
- [migrations/0003_operations.sql](../migrations/0003_operations.sql) — 27 行
- [migrations/0004_admin_bootstrap.sql](../migrations/0004_admin_bootstrap.sql) — 6 行
- [migrations/0005_personal_library.sql](../migrations/0005_personal_library.sql) — 18 行

## 构建与验证脚本（13 个）

- [scripts/build_android.sh](../scripts/build_android.sh) — 12 行
- [scripts/build_sites.sh](../scripts/build_sites.sh) — 55 行
- [scripts/check_build_output.py](../scripts/check_build_output.py) — 60 行
- [scripts/check_static_site.py](../scripts/check_static_site.py) — 109 行
- [scripts/generate_account_migration.js](../scripts/generate_account_migration.js) — 17 行
- [scripts/package_desktop.js](../scripts/package_desktop.js) — 7 行
- [scripts/prepare_admin.js](../scripts/prepare_admin.js) — 17 行
- [scripts/probe_music_channels.js](../scripts/probe_music_channels.js) — 35 行
- [scripts/probe_music_sources.js](../scripts/probe_music_sources.js) — 95 行
- [scripts/smoke_server.sh](../scripts/smoke_server.sh) — 45 行
- [scripts/verify_lyrics_browser.js](../scripts/verify_lyrics_browser.js) — 88 行
- [scripts/verify_lyrics_fountain.js](../scripts/verify_lyrics_fountain.js) — 51 行
- [scripts/verify_lyrics_layout.js](../scripts/verify_lyrics_layout.js) — 30 行

## 自动化测试（65 个）

- [tests/accounts.test.js](../tests/accounts.test.js) — 211 行
- [tests/admin-bootstrap.test.js](../tests/admin-bootstrap.test.js) — 60 行
- [tests/app-shell.test.js](../tests/app-shell.test.js) — 538 行
- [tests/artwork.test.js](../tests/artwork.test.js) — 108 行
- [tests/bilibili.test.js](../tests/bilibili.test.js) — 345 行
- [tests/browser-experience.js](../tests/browser-experience.js) — 168 行
- [tests/browser-playback-cache.js](../tests/browser-playback-cache.js) — 53 行
- [tests/cache-store.test.js](../tests/cache-store.test.js) — 49 行
- [tests/charts-page.test.js](../tests/charts-page.test.js) — 67 行
- [tests/chksz.test.js](../tests/chksz.test.js) — 62 行
- [tests/cloudflare-runtime.js](../tests/cloudflare-runtime.js) — 327 行
- [tests/desktop-pet.test.js](../tests/desktop-pet.test.js) — 189 行
- [tests/discovery-content.test.js](../tests/discovery-content.test.js) — 28 行
- [tests/discovery-table.test.js](../tests/discovery-table.test.js) — 26 行
- [tests/download-session.test.js](../tests/download-session.test.js) — 25 行
- [tests/gd.test.js](../tests/gd.test.js) — 131 行
- [tests/http.test.js](../tests/http.test.js) — 113 行
- [tests/index-script-syntax.test.js](../tests/index-script-syntax.test.js) — 23 行
- [tests/library-regressions.test.js](../tests/library-regressions.test.js) — 64 行
- [tests/listening-room.test.js](../tests/listening-room.test.js) — 88 行
- [tests/lyric-catalog.test.js](../tests/lyric-catalog.test.js) — 48 行
- [tests/lyric-composition.test.js](../tests/lyric-composition.test.js) — 44 行
- [tests/lyric-effects.test.js](../tests/lyric-effects.test.js) — 29 行
- [tests/lyrics-clock.test.js](../tests/lyrics-clock.test.js) — 34 行
- [tests/lyrics-document.test.js](../tests/lyrics-document.test.js) — 63 行
- [tests/lyrics-settings.test.js](../tests/lyrics-settings.test.js) — 43 行
- [tests/music-catalog.test.js](../tests/music-catalog.test.js) — 115 行
- [tests/music-channels.test.js](../tests/music-channels.test.js) — 131 行
- [tests/music-content.test.js](../tests/music-content.test.js) — 263 行
- [tests/music-data.test.js](../tests/music-data.test.js) — 193 行
- [tests/music-download.test.js](../tests/music-download.test.js) — 70 行
- [tests/music-explore.test.js](../tests/music-explore.test.js) — 163 行
- [tests/music-key-settings.test.js](../tests/music-key-settings.test.js) — 116 行
- [tests/music-metadata.test.js](../tests/music-metadata.test.js) — 52 行
- [tests/music-service.test.js](../tests/music-service.test.js) — 129 行
- [tests/native-audio.test.js](../tests/native-audio.test.js) — 114 行
- [tests/oneko-butterfly.test.js](../tests/oneko-butterfly.test.js) — 183 行
- [tests/op-music.test.js](../tests/op-music.test.js) — 162 行
- [tests/operations.test.js](../tests/operations.test.js) — 199 行
- [tests/page-scroll-spider-assets.test.js](../tests/page-scroll-spider-assets.test.js) — 35 行
- [tests/page-scroll-spider.test.js](../tests/page-scroll-spider.test.js) — 30 行
- [tests/personal-library.test.js](../tests/personal-library.test.js) — 114 行
- [tests/playback-cache.test.js](../tests/playback-cache.test.js) — 42 行
- [tests/playback-controller.test.js](../tests/playback-controller.test.js) — 44 行
- [tests/playback-router.test.js](../tests/playback-router.test.js) — 294 行
- [tests/playback-session.test.js](../tests/playback-session.test.js) — 30 行
- [tests/player-runtime.test.js](../tests/player-runtime.test.js) — 733 行
- [tests/queue-store.test.js](../tests/queue-store.test.js) — 35 行
- [tests/recommendations.test.js](../tests/recommendations.test.js) — 158 行
- [tests/scroll-spider-appearance.test.js](../tests/scroll-spider-appearance.test.js) — 81 行
- [tests/security.test.js](../tests/security.test.js) — 68 行
- [tests/server-stream.test.js](../tests/server-stream.test.js) — 49 行
- [tests/service-worker.test.js](../tests/service-worker.test.js) — 171 行
- [tests/sites-worker.test.js](../tests/sites-worker.test.js) — 297 行
- [tests/studio.test.js](../tests/studio.test.js) — 98 行
- [tests/test_accessibility_markup.py](../tests/test_accessibility_markup.py) — 214 行
- [tests/test_build_output.py](../tests/test_build_output.py) — 29 行
- [tests/test_check_static_site.py](../tests/test_check_static_site.py) — 103 行
- [tests/test_cover_persistence.py](../tests/test_cover_persistence.py) — 62 行
- [tests/test_desktop_shell_markup.py](../tests/test_desktop_shell_markup.py) — 499 行
- [tests/test_dom_contract.py](../tests/test_dom_contract.py) — 253 行
- [tests/test_lyrics_focus.py](../tests/test_lyrics_focus.py) — 54 行
- [tests/test_pwa_contract.py](../tests/test_pwa_contract.py) — 125 行
- [tests/test_startup_behavior.py](../tests/test_startup_behavior.py) — 537 行
- [tests/xinghai-music.test.js](../tests/xinghai-music.test.js) — 126 行

## 持续集成与托管（3 个）

- [.github/workflows/android.yml](../.github/workflows/android.yml) — 27 行
- [.github/workflows/static-site-checks.yml](../.github/workflows/static-site-checks.yml) — 58 行
- [.openai/hosting.json](../.openai/hosting.json) — 3 行
