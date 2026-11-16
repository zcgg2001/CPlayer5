# Android APK

首版复用 `https://music.505zc.tech/` 的网页界面，在线音频由 Android Media3 / ExoPlayer 播放。网站的搜索、歌词、账户、歌单、选定音源优先及失败降级策略共用一套代码。

## 安装与构建

- Android 8.0（API 26）及以上；需要可用的 Android System WebView / Chrome。
- 本地运行 `npm run android:build`，安装包输出为 `output/android/CPlayer5-android-preview.apk`。
- GitHub → Actions → **Android APK** → 成功运行的 Artifacts，可下载 `CPlayer5-android-preview`。
- 首次安装需允许安装来源；这是调试签名的预览包，包名为 `tech.zc505.cplayer.debug`，不代表已经上架应用商店。

构建要求：JDK 17、Android SDK Platform 36、Build Tools 36.0.0。安装 Android Studio 对应组件，配置 `JAVA_HOME` 和 `ANDROID_HOME`，或者在不提交的 `android/local.properties` 中设置 `sdk.dir=绝对路径`。Gradle Wrapper 8.13 与校验和已提交，Android Gradle Plugin 固定为 8.13.2。

```sh
npm run android:build
# 或者直接执行相同检查
./android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
adb install -r output/android/CPlayer5-android-preview.apk
```

构建脚本支持本仓库 `.local/android-tools` 下的隔离 JDK；这只是本机开发便利，不随源代码或 APK 分发。SDK、构建目录、本地配置及签名密钥均被 Git 忽略。

## 播放实现

| 文件 | 责任 |
| --- | --- |
| `MainActivity.java` | 页面容器、安全区、返回键、系统文件选择器 |
| `WebPlayerHost.java` | 由播放服务保留的 WebView；仅本站 HTTPS 主框架可调用消息桥 |
| `PlaybackService.java` | ExoPlayer、音频焦点、耳机断开暂停、通知及锁屏 MediaSession |
| `BridgePolicy.java` | 导航、桥接来源及音频地址检查 |
| `js/native-audio.js` | 把原有音频事件和时钟映射到原生播放，旧请求不能覆盖新歌曲 |

返回桌面保留播放，系统媒体控制可暂停、继续、切歌。播放服务保留同一个网页实例，Activity 重建不重复创建队列。网页重载或渲染器崩溃时停止原生播放，避免音乐继续但界面失去控制。用户从最近任务划掉应用时主动结束播放。

普通浏览器继续使用 HTMLAudioElement。APK 首次打开需要网络；网页更新后可获取新界面，修改原生服务则需要安装新版 APK。音源解析在同源服务端完成，ChKSz 仍只在用户明确选择时调用，不被自动探测或预加载消耗。

## 预览版边界

- 系统强制停止、清理进程或厂商省电策略仍可结束播放。没有承诺进程被杀后无缝恢复，也尚未完成各品牌真机长时间测试。
- 原生后台播放覆盖在线 HTTPS 音频。导入的本地 / Blob 音频继续走 WebView，后台连续性没有同等保证。
- 原生音频不接入网页 Web Audio 频谱分析，因此在线歌曲的音频喷泉不显示真实频谱；同步歌词仍使用原生播放时钟。
- HTTPS 下载交给外部浏览器；网页生成的 Blob 导出当前提示在浏览器完成。系统文件选择导入已接入。
- 预览版调试签名仅用于验证。同一签名才能覆盖安装；GitHub 临时 runner 与本机构建签名可能不同，切换构建来源需先导出/同步资料再卸载旧版。正式发布前应配置由维护者保管的固定 release 签名，不把密钥提交到仓库。

## 参考

采用 [Android 官方 MediaSessionService 后台播放模式](https://developer.android.com/media/media3/session/background-playback)。同时研究了 [MusicFree](https://github.com/maotoumao/MusicFree) 的播放器与音源分层，以及 [Gramophone](https://github.com/FoedusProgramme/Gramophone) 的 Media3 服务生命周期。实现独立编写，没有复制 GPL / AGPL 项目源码。

具体执行过的验证及未覆盖范围见 [项目检查记录](project-audit-2026-11-17.md)。
