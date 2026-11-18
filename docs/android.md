# Android APK

进入 Android 预览版后先看到发现页，可从底部进入搜索或我的音乐，也可直接打开喜欢的歌曲、最近播放和歌单。浏览时点迷你栏的歌曲封面展开播放器，点「歌词」切换同步歌词。系统返回键依次收起弹窗、歌词和播放器。

WebView 通过 `WebViewAssetLoader` 从应用内读取 `/android-player/` 下的界面文件。在线搜索、账号和音乐 API 继续访问 `https://music.505zc.tech`，沿用该来源的会话与本机资料。在线音频由 Android Media3 / ExoPlayer 播放。

## 安装与构建

- Android 8.0（API 26）及以上；需要可用的 Android System WebView / Chrome。
- 本地运行 `npm run android:build`，安装包输出为 `output/android/CPlayer5-android-preview.apk`。
- [GitHub Releases](https://github.com/zcgg2001/CPlayer5/releases) 的附件里可下载 `CPlayer5-android-preview-<versionCode>.apk` 和 `SHA256SUMS.txt`。在下载目录运行 `shasum -a 256 -c SHA256SUMS.txt` 可核对文件。
- 首次安装时按 Android 提示允许浏览器安装此 APK。预览版包名为 `tech.zc505.cplayer.debug`。从本机签发的上一版可以直接覆盖安装，保留本机资料。

构建需要 JDK 17、Python 3、Android SDK Platform 36 和 Build Tools 36.0.0。安装 Android Studio 对应组件，配置 `JAVA_HOME` 和 `ANDROID_HOME`，或者在不提交的 `android/local.properties` 中设置 `sdk.dir=绝对路径`。Gradle Wrapper 8.13 与校验和已提交，Android Gradle Plugin 固定为 8.13.2。

```sh
npm run android:build
# 或者直接执行相同检查
./android/gradlew -p android assemblePreview testPreviewUnitTest lintPreview
adb install -r output/android/CPlayer5-android-preview.apk
```

构建脚本支持本仓库 `.local/android-tools` 下的隔离 JDK；这只是本机开发便利，不随源代码或 APK 分发。SDK、构建目录、本地配置及签名密钥均被 Git 忽略。

## 应用内更新

从 1.9.0 起，预览版启动和回到前台时会检查 GitHub Releases。应用持续打开时每 15 分钟检查一次。发现更大的 Android `versionCode` 后，发现页和播放页会显示下载入口。「设置 → 应用更新」提供手动检查、版本说明和下载链接。「忽略此版本」只收起当前版本的横幅，后续版本仍会提醒。离线时可继续播放本机音乐，恢复网络后会重试。

发布下一版时，在 `android/app/build.gradle` 递增 `versionCode` 并更新 `versionName`。使用同一预览签名构建，把生成的带数字后缀的 APK 与校验文件附到相应标签的 GitHub Release，再点击 **Publish release**。预览版会识别公开的 Release 和 Pre-release。草稿、纯网页发布、版本号相同或更低的 APK 不会触发提醒。检查使用公开 GitHub API，无需用户登录 GitHub。

公开预览包沿用 1.1 本机预览包的签名。其证书 SHA-256 为 `ba29e9d6549a8a292478f3d31033ec6d4a4fb967f8489adb7fb3130004e2e085`。Release 附件应由持有该密钥的维护者签发。Actions 的临时签名用于 CI 验证，无法覆盖这个分发渠道的安装包。分发用的 `preview` 构建已关闭 Android 和 WebView 调试。

## 播放实现

| 文件 | 责任 |
| --- | --- |
| `MainActivity.java` | 页面容器、安全区、返回键、系统文件选择器 |
| `WebPlayerHost.java` | 由播放服务保留的 WebView；仅本站 HTTPS 主框架可调用消息桥 |
| `PlaybackService.java` | ExoPlayer、音频焦点、耳机断开暂停、通知及锁屏 MediaSession |
| `BridgePolicy.java` | 导航、桥接来源及音频地址检查 |
| `js/native-audio.js` | 把原有音频事件和时钟映射到原生播放，旧请求不能覆盖新歌曲 |
| `js/android-updates.js` | 从公开 Releases 识别本预览渠道的新版 APK，管理前台检查和应用内提醒 |

返回桌面保留播放，系统媒体控制可暂停、继续、切歌。播放服务保留同一个网页实例，Activity 重建不重复创建队列。网页重载或渲染器崩溃时停止原生播放，避免音乐继续但界面失去控制。用户从最近任务划掉应用时主动结束播放。

普通浏览器使用 HTMLAudioElement。APK 的界面随安装包更新，登录、在线推荐与在线音乐需要网络。开发时可在本地网站打开 `/?app=android` 预览 Android 布局。音源解析在同源服务端完成，ChKSz 只在用户明确选择时调用。

## 预览版边界

- 系统强制停止、清理进程或厂商省电策略仍可结束播放。没有承诺进程被杀后无缝恢复，也尚未完成各品牌真机长时间测试。
- 原生后台播放覆盖在线 HTTPS 音频。导入的本地 / Blob 音频继续走 WebView，后台连续性没有同等保证。
- 原生音频不接入网页 Web Audio 频谱分析，因此在线歌曲的音频喷泉不显示真实频谱；同步歌词仍使用原生播放时钟。
- HTTPS 下载交给外部浏览器；网页生成的 Blob 导出当前提示在浏览器完成。系统文件选择导入已接入。

## 参考

发现页借鉴了 Retro Music 的首页内容分组，展开的播放器借鉴了 Auxio 的封面与曲目信息排布，主题和触控导航参考了 Gramophone 的 Material 界面。[Retro Music 首页](https://github.com/RetroMusicPlayer/RetroMusicPlayer#-screenshots) · [Auxio 界面](https://github.com/OxygenCobalt/Auxio#screenshots) · [Gramophone 界面](https://github.com/FoedusProgramme/Gramophone#screenshots)

采用 [Android 官方 MediaSessionService 后台播放模式](https://developer.android.com/media/media3/session/background-playback)。同时研究了 [MusicFree](https://github.com/maotoumao/MusicFree) 的播放器与音源分层，以及 [Gramophone](https://github.com/FoedusProgramme/Gramophone) 的 Media3 服务生命周期。实现独立编写，没有复制 GPL / AGPL 项目源码。

具体执行过的验证及未覆盖范围见 [项目检查记录](project-audit-2026-11-17.md)。
