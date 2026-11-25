# Android APK

从 1.11.1 起，应用显示名称统一为 **ZPlayer**，包括手机桌面应用名、首页、设置、系统媒体信息和歌词卡片。应用包名、签名、本机存储标识与 GitHub 仓库地址沿用原值，支持覆盖安装和继续使用既有个人库。

进入 Android 预览版后先看到发现页，可从底部进入搜索或我的音乐，也可直接打开喜欢的歌曲、最近播放和歌单。浏览时点迷你栏的歌曲封面展开播放器，点中央封面查看同步歌词。系统返回键依次收起弹窗、歌词和播放器。

WebView 通过 `WebViewAssetLoader` 从应用内读取 `/android-player/` 下的界面文件。在线搜索、账号和音乐 API 继续访问 `https://music.505zc.tech`，沿用该来源的会话与本机资料。在线音频由 Android Media3 / ExoPlayer 播放。

## 安装与构建

- Android 8.0（API 26）及以上；需要可用的 Android System WebView / Chrome。
- 本地运行 `npm run android:build`，安装包输出为 `output/android/ZPlayer-android-preview.apk`。
- 新构建的发布附件名为 `ZPlayer-android-preview-<versionCode>.apk`。构建脚本同时生成内容相同的 `CPlayer5-android-preview-<versionCode>.apk` 兼容附件，以供旧版应用发现更新。[GitHub Releases](https://github.com/zcgg2001/CPlayer5/releases) 中已有版本仍使用旧文件名。在下载目录运行 `shasum -a 256 -c SHA256SUMS.txt` 可核对文件。
- 首次安装时按 Android 提示允许浏览器安装此 APK。预览版包名为 `tech.zc505.cplayer.debug`。从本机签发的上一版可以直接覆盖安装，保留本机资料。

构建需要 JDK 17、Python 3、Android SDK Platform 36 和 Build Tools 36.0.0。安装 Android Studio 对应组件，配置 `JAVA_HOME` 和 `ANDROID_HOME`，或者在不提交的 `android/local.properties` 中设置 `sdk.dir=绝对路径`。Gradle Wrapper 8.13 与校验和已提交，Android Gradle Plugin 固定为 8.13.2。

```sh
npm run android:build
# 或者直接执行相同检查
./android/gradlew -p android assemblePreview testPreviewUnitTest lintPreview
adb install -r output/android/ZPlayer-android-preview.apk
```

构建脚本支持本仓库 `.local/android-tools` 下的隔离 JDK；这只是本机开发便利，不随源代码或 APK 分发。SDK、构建目录、本地配置及签名密钥均被 Git 忽略。

## 应用内更新

1.13.0 预览版支持镜像检查和应用内下载。默认依次尝试 `gh-proxy.com`、`gh-proxy.org` 和 GitHub，也可以在「设置 → 应用更新」选择首选镜像或仅 GitHub 直连。显示下载进度、取消和重试；更新说明以纯文本显示。流量仅包含公开仓库的发布信息与 APK 地址，不携带本站登录 Cookie 或令牌。

安装包必须同时通过发布附件的 SHA-256、包名、递增版本号及当前安装证书校验。GitHub 未提供附件摘要时不启用应用内安装。下载完成后由用户点击「安装更新」，再交给 Android 系统安装器；尚未允许本应用安装 APK 时打开对应系统设置，返回后再次点击安装。不会静默安装。旧版 Android WebView 未提供消息桥时保留外部下载入口。

从 1.9.0 起，预览版启动和回到前台时会检查 GitHub Releases。应用持续打开时每 15 分钟检查一次。发现更大的 Android `versionCode` 后，发现页和播放页会显示下载入口。「设置 → 应用更新」提供手动检查、版本说明和下载链接。「忽略此版本」只收起当前版本的横幅，后续版本仍会提醒。离线时可继续播放本机音乐，恢复网络后会重试。

发布下一版时，在 `android/app/build.gradle` 递增 `versionCode` 并更新 `versionName`。使用同一预览签名构建，把生成的 ZPlayer 与 CPlayer5 两个带数字后缀的 APK 及校验文件附到相应标签的 GitHub Release，再点击 **Publish release**。预览版会识别公开的 Release 和 Pre-release。草稿、纯网页发布、版本号相同或更低的 APK 不会触发提醒。检查使用公开 GitHub API，无需用户登录 GitHub。

公开预览包沿用 1.1 本机预览包的签名。其证书 SHA-256 为 `ba29e9d6549a8a292478f3d31033ec6d4a4fb967f8489adb7fb3130004e2e085`。Release 附件应由持有该密钥的维护者签发。Actions 的临时签名用于 CI 验证，无法覆盖这个分发渠道的安装包。分发用的 `preview` 构建已关闭 Android 和 WebView 调试。

## Material Design 3 界面

1.13.0 预览版增加圆角、圆形、花瓣三种播放页封面，以及可关闭的封面氛围光。封面保持正立，继续与队列旋转木马联动，使用同一张已解析封面，不重复查询歌曲资料。

榜单改为封面目录，可横向切换，也可展开全部榜单网格。目录来自公开榜单 API，最多保留 100 个入口；实际数量随上游更新。榜单元数据与曲目有 5 分钟有效期，命中时直接显示，过期后保留当前内容并后台刷新；刷新失败仍可浏览上次保存的数据。最多保存 24 份目录/榜单记录，其中目录不因浏览更多榜单而被淘汰。仅预加载相邻两个榜单，串行执行并在选择变化时停止继续预取；省流模式跳过预加载。封面按需加载并复用现有缓存。专辑、歌单和发现目录也保存最近 18 份公开资料，重开时优先使用缓存。

这里的“秒开”指已有本地缓存时，不必等待网络返回即可显示目录和曲目；首次联网请求、尚未缓存的封面以及实际音频解析仍受上游和网络影响。没有用占位内容伪造加载成功。

1.11.6 预览版修复设置页控件：歌词模式保持横排并区分选中状态，音乐平台和音源使用明确的选中样式；歌词表单按可用宽度分栏，滑块与开关标签可点击，长文字不会挤压勾选框；折叠项提供展开标记，字号输入整合为一组控件，在线歌单输入补充标签并在窄屏换行，无效输入会在框下直接显示原因；底部关于说明提高字号和对比度。

1.11.5 预览版缩小设置页语言选择器的视觉比例：使用 14px 文字、16px 箭头和 36px 高的边框，原生下拉选择的点击高度仍为 48px。

1.11.4 预览版统一安卓设置页的图标尺寸：标题和关闭图标 24px，主题、字号加减、歌单来源、导入及加载图标 20px，折叠箭头 16px。图标使用固定方形区域防止被文字挤压，图标按钮保留 48px 点击区域，字号加减改用同一套 SVG 图标。

1.11.0 预览版采用 Material Design 3 的颜色角色、色调表面、圆角和组件层级。浅色与深色使用同一套紫色基准色，设置中可直接切换并保存。状态栏和导航栏随主题变化；当前未接入 Android 壁纸取色。

发现页、排行榜、歌手、视频、搜索、队列、我的音乐、播放器、歌词和设置共用配色与按钮样式。首页提供搜索栏、每日推荐、快捷入口和私人电台；歌手使用圆形头像卡片。播放器突出封面、进度和主要播放按钮；歌词保留补全、选句和分享入口。

手机使用底部导航，宽度达到 840 CSS 像素时切换为侧边导航；内容区按宽度切换分栏。窄屏设置使用全屏布局，较大屏幕使用圆角弹窗。低高度横屏将歌词信息与正文分栏，保留播放控制。主要触控区域至少 48 CSS 像素，并提供按下反馈、键盘焦点和减少动态效果样式。界面继续通过 WebView 实现。

## 播放实现

1.12.2 预览版为 Android 播放页加入与队列联动的专辑封面旋转木马：中央突出当前歌曲，两侧缩小显示前后曲目；在封面上左右拖动或点击侧面封面切歌，点击中央封面进入歌词。专辑名及当前播放顺序显示在歌名上方。封面预览遵循顺序或随机队列；单曲循环仍会在自动结束时重播，但手动切歌可进入前后曲目。空队列、单首歌曲和私人电台不展示不可播放的相邻封面。跨平台同 ID 与重复歌曲保留所选队列位置，音源回退沿用原歌曲的封面身份。

该交互参考 [RetroMusicPlayer 的封面变换](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/41af88df479c9571592327d0ccc53901f6a67b6e/app/src/main/java/code/name/monkey/retromusic/transform/CarousalPagerTransformer.kt)与播放器封面分页的设计思路，使用现有 WebView、共享封面加载器和队列独立实现。仅保留当前与相邻封面，动画结束后移除退出项；支持键盘方向键、触屏手势、深浅色、减少动态效果，以及窄屏、横屏和平板布局。在封面以外的区域向左滑动仍可进入歌词。

1.11.3 预览版移除播放页底部重复的歌词跳转按钮及其占位，竖屏与横屏同步收紧控制区。点击封面或向左滑动可打开歌词页，向右滑动返回封面。

1.11.2 预览版为顺序播放、随机播放、单曲循环增加切换提示，同时更新手机和桌面按钮的当前模式说明。顺序模式按队列顺序循环，随机模式打乱当前队列，单曲模式重复当前歌曲。

每首在线歌曲及下一首预加载优先请求无损音质，无损不可用时依次尝试极高、标准音质或其他可用音源。手动切换只作用于当前歌曲，下一首仍优先无损，旧版保存的音质选择不会覆盖此默认规则。音质标识显示实际返回结果；不提供音质选项的渠道、Bilibili AAC 和已保存的本地音频按实际资源播放。

1.10.0 预览版增加歌词补全与歌词卡片。在播放页点击封面或向左滑动进入歌词页，可直接补全或分享。原音源没有可用歌词（或仅有纯文本）时，应用查询 LRCLIB，核对歌名、歌手、版本和时长；匹配成功后保存在本机最近 12 首歌曲的歌词缓存中。已有逐字歌词、手动导入与时间校正会保留。找不到匹配项时可重试，或在设置的「歌词与时间校正」中导入文件；不会为纯文本生成假时间轴。补全会把歌曲名称和歌手发送至 LRCLIB 的公开服务，不携带本站账号 Cookie。

点选已知歌曲时，先恢复本机保存的歌词、来源选择和时间校正，再等待音频解析与在线歌词。后台结果按现有歌词完整度规则更新；网络失败继续显示已有内容。请求期间导入歌词、切换来源或调整外观/校正，返回的在线结果会保留这些操作，包括本机存储写入失败时。切歌后旧请求不能替换新歌曲的歌词。没有缓存时显示获取状态，原渠道返回后再按需查询 LRCLIB。

1.15.0 Android 预览版增加 QQ QRC、酷狗 KRC 在线逐字补充，按已知歌曲 ID 独立于原渠道加载，保留真实逐字时间、翻译和罗马音。完整逐行歌词不会被短小的逐字片段替换；手动导入和校正仍优先，失败保留原歌词。最近 12 首缓存也保存补全结果，具体匹配、回退及验证范围见 [在线逐字歌词说明](android-online-lyrics.md)。

「分享」可选最多 6 句、500 字，支持封面色、唱片黑、暖纸笺三种配色，以及 1080×1080 / 1080×1920 PNG。封面不可用时使用唱片插画，长句自动换行缩放，文字过多时提示减少选句。点「保存图片」选择系统保存位置，或点「分享卡片」打开 Android 分享面板。保存图片不需要整个存储目录的访问权限。歌词页和卡片编辑适配窄屏、平板、横屏与系统字号；安卓歌词区域隐藏桌面宠物与滚动挂件，减少遮挡。

| 文件 | 责任 |
| --- | --- |
| `MainActivity.java` | 页面容器、安全区、返回键、系统文件选择器 |
| `WebPlayerHost.java` | 由播放服务保留的 WebView；仅本站 HTTPS 主框架可调用消息桥 |
| `PlaybackService.java` | ExoPlayer、音频焦点、耳机断开暂停、通知及锁屏 MediaSession |
| `CoverImageCache.java` / `CoverDataSource.java` | WebView 与系统媒体封面共用公开图片磁盘缓存、合并正在进行的同图请求 |
| `BridgePolicy.java` | 导航、桥接来源及音频地址检查 |
| `js/native-audio.js` | 把原有音频事件和时钟映射到原生播放，旧请求不能覆盖新歌曲 |
| `js/android-updates.js` | 从公开 Releases 识别本预览渠道的新版 APK，管理前台检查和应用内提醒 |
| `UpdateBridge.java` / `UpdatePolicy.java` / `js/update-transport.js` | 镜像回退、下载进度与取消、摘要及安装身份校验、系统安装器 |
| `js/chart-cache.js` / `js/charts-page.js` | 持久榜单缓存、封面目录、后台刷新和有限预取 |
| `LyricShareBridge.java` / `LyricCardImage.java` | 独立的本站主框架图片桥、大小限制、系统文档保存与 FileProvider 分享 |
| `js/lyrics/lookup.js` / `card.js` / `share.js` | LRCLIB 匹配、卡片排版、选句与预览 |
| `OnlineLyricsHandler.java` / `js/lyrics/native-lookup.js` / `encoded.js` | Android 精确歌曲 QRC / KRC 获取、格式解码、逐字歌词后台补充 |

返回桌面保留播放，系统媒体控制可暂停、继续、切歌。播放服务保留同一个网页实例，Activity 重建不重复创建队列。网页重载或渲染器崩溃时停止原生播放，避免音乐继续但界面失去控制。用户从最近任务划掉应用时主动结束播放。

普通浏览器使用 HTMLAudioElement。APK 的界面随安装包更新，登录、在线推荐与在线音乐需要网络。开发时可在本地网站打开 `/?app=android` 预览 Android 布局。音源解析在同源服务端完成，ChKSz 只在用户明确选择时调用。

歌手页按热歌、新歌、飙升和原创公开榜单整理歌手及作品，切换播放渠道后仍可浏览。首次进入歌手页会更新数据，也可手动刷新。网络不可用时显示上次保存的内容。

在线播放向系统 MediaSession 同步歌曲标识、歌名、歌手、专辑、封面、时长和播放进度。通知栏及锁屏可暂停、继续、切歌，封面异步更新时会核对当前歌曲。对于允许的公开 CDN 封面，WebView 和 Media3 位图加载器共用同一个 64 MiB 磁盘缓存，并合并正在进行的同图请求。缓存有效期为 7 天，单图最多 2 MiB；已有缓存过期且网络请求失败时继续读取旧图。磁盘缓存可跨应用重启复用，但系统清理应用缓存后需要重新下载。系统封面解码输出仍限制为 512 像素。

带签名参数的图片和平台封面跳转接口继续使用原有同源代理。公开 CDN 无法访问且本机无可用图片时，也回退到同源代理；不会把这些情况缓存为永久缺图。相关自动验证及真机验证边界见 [歌词与封面缓存验收](android-cache-validation.md)。

当前播放歌曲的原图、尺寸回退和原平台精确查询都没有找到可用封面时，Android 会尝试 iTunes 香港区公开目录。只有歌名、歌手、版本、专辑一致且候选唯一时才自动采用；已有双方时长时还要求相差不超过 3 秒。简繁体仅在匹配时统一，显示名称保持原样。封面查询不阻塞音频和歌词，也不由列表滚动自动触发。

在「设置 → 播放页封面 → 更换当前歌曲封面」可查询候选、手动选择或恢复原图。选择按原歌曲及专辑发行记在本机，音源回退后仍适用；恢复原图会停止该歌曲的自动补图。「缺封面时自动匹配」开关可关闭后续自动查询。查询会把歌名和歌手发送给 iTunes，不携带本站登录凭据。补全图继续共用页面和通知的磁盘缓存。实现、复跑方式及已验证范围见 [缺封面补全验收](android-artwork-recovery.md)。

通用媒体接口覆盖应用支持的 Android 8.0 及以上版本。手机顶部的系统音乐胶囊由厂商系统决定，是否出现取决于系统版本、支持范围和通知设置。各品牌胶囊需要分别在对应真机验证。

## 预览版边界

- 系统强制停止、清理进程或厂商省电策略仍可结束播放。没有承诺进程被杀后无缝恢复，也尚未完成各品牌真机长时间测试。
- 原生后台播放覆盖在线 HTTPS 音频。导入的本地 / Blob 音频继续走 WebView，后台连续性没有同等保证。
- 原生音频不接入网页 Web Audio 频谱分析，因此在线歌曲的音频喷泉不显示真实频谱；同步歌词仍使用原生播放时钟。
- 普通 HTTPS 文件下载交给外部浏览器；应用更新使用单独的原生校验下载流程，歌词卡片支持应用内保存和分享。其他网页 Blob 导出仍提示在浏览器完成。系统文件选择导入已接入。

## 参考

1.13.0 的封面形状、封面氛围、榜单浏览和镜像更新参考 [myMusic](https://github.com/mytv-android/myMusic/tree/74754412fada128b04f6e264898213e1371f1110)。该项目的 `ChartsScreen.kt` 采用横向封面轮播与惰性列表；`MusicViewModel.kt` 按来源保存约 10 分钟的浏览缓存，首页只展示少量榜单预览曲目；`UpdateRepository.kt` 与 `GithubMirrorRoutes.kt` 提供镜像回退和包校验思路。ZPlayer 结合现有 WebView、共享封面加载器和 Media3 独立实现，未复制该 AGPL 项目的 Kotlin 源码。

整体视觉和组件规范参考 Google [Material Design 3](https://m3.material.io/)、[颜色系统](https://m3.material.io/styles/color/system/overview)与[导航栏](https://m3.material.io/components/navigation-bar/overview)。通过独立的 Android 样式层实现，未引入 Compose 或宣称符合全部原生 Material 组件行为。

歌词补全、选句卡片和自适应歌词页的产品思路参考 [Rush](https://github.com/shub39/Rush)；采用 [LRCLIB](https://lrclib.net) 公开歌词服务。相关代码独立实现，未复制 Rush 的 GPL 源码。

内容分组及播放器信息排布也参考了 [Retro Music](https://github.com/RetroMusicPlayer/RetroMusicPlayer#-screenshots)、[Auxio](https://github.com/OxygenCobalt/Auxio#screenshots) 和 [Gramophone](https://github.com/FoedusProgramme/Gramophone#screenshots)。

采用 [Android 官方 MediaSessionService 后台播放模式](https://developer.android.com/media/media3/session/background-playback)。同时研究了 [MusicFree](https://github.com/maotoumao/MusicFree) 的播放器与音源分层，以及 [Gramophone](https://github.com/FoedusProgramme/Gramophone) 的 Media3 服务生命周期。实现独立编写，没有复制 GPL / AGPL 项目源码。

具体执行过的验证及未覆盖范围见 [项目检查记录](project-audit-2026-11-17.md)。
