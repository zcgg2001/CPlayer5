# Android 歌词与封面缓存验收

2026-11-25，本地开发分支 `codex/android-lyrics-cover-cache`。这是第一阶段的验收记录，独立实现缓存优先显示与共用图片缓存。后续的缺封面搜索与手动更换见 [第二阶段记录](android-artwork-recovery.md)。

## 行为

- 点选已有稳定身份的歌曲即可恢复最近 12 首缓存中的歌词，无需等待音频地址或歌词接口。解析后的歌曲资料继续核对稳定身份。
- 后台在线结果按现有完整度规则更新；保留手动来源、文件导入、单曲偏移和显示设置。临时网络失败保留已显示歌词。
- WebView 与 Media3 使用同一公开封面字节缓存。缓存上限、CDN 白名单、MIME 与大小限制沿用原策略；新增同图请求合并。平台跳转与签名图片继续走原有代理。

## 自动验证

- 使用 `.node-version` 指定的 Node.js 26.12.0 运行 `npm test`：104 项 Python、521 项 JavaScript 测试及静态检查通过。
- Android 构建流程执行 `assemblePreview testPreviewUnitTest lintPreview`：15 项 JVM 测试通过，Lint 无错误（4 项提示），APK 生成成功。新增 `CoverImageCacheTest` 覆盖磁盘重新打开后复用、过期后网络失败回退、拒绝 HTML/超大图片/未信任路径/签名图片。
- `npm run build`、`npm run check:build` 与 `git diff --check` 通过。
- Playwright Chromium 以 390×844 视口打开实际 `/?app=android` 页面，使用受控延迟和失败响应、45 秒静音音频及原创歌词。隔离上下文禁用 Service Worker，测试不会请求真实音乐服务。

页面检查包括：歌曲解析尚未返回时缓存已出现；歌词接口延迟时缓存仍可用；在线结果更新且保留保存的偏移；请求期间导入歌词、修改偏移与显示模式且存储写入失败时保留当前选择；快速切歌防止旧响应覆盖；无缓存歌曲正常加载；503 时保留先前保存的歌词；原歌词返回前没有重复发起 LRCLIB 补全；暂停时打开歌词并调整进度后，淡入结束能高亮正确的句子。

## 复跑页面验收

在仓库根目录启动本地静态服务：

```sh
python3 -m http.server 8793 --bind 127.0.0.1
```

另一个终端运行：

```sh
mkdir -p output/playwright
playwright-cli -s=android-cache open http://127.0.0.1:8793/offline.html
playwright-cli -s=android-cache run-code --filename scripts/verify_android_lyric_cache.js
playwright-cli -s=android-cache close
```

也可用本机 Playwright skill 的 CLI wrapper 执行。回调创建并关闭独立上下文，成功截图保存在忽略目录 `output/playwright/android-lyric-cache.png`。

## 验证边界

浏览器检查覆盖 Android 网页布局和真实前端事件；JVM 测试覆盖图片磁盘缓存。尚未在 Android 真机验证通知/锁屏封面的断网重启显示、厂商后台策略及长时间播放。Java 的 Media3 接入已通过编译与 Lint，不据此宣称所有系统媒体界面都已验证。
