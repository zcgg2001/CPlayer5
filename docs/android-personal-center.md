# Android 个人中心与设置

1.18.0 预览版将 Android 的个人库入口改为「我的」首页，并把长设置表单整理成分组入口和独立子页。浅色、深色均沿用 ZPlayer 的紫色 Material 颜色角色。

## 参考来源

参考 [mytv-android/myMusic](https://github.com/mytv-android/myMusic) 在提交 `38a263531e2828e3007789a127effb3bfd398910` 的实现与界面截图：

- [LibraryScreen.kt](https://github.com/mytv-android/myMusic/blob/38a263531e2828e3007789a127effb3bfd398910/app/src/main/java/com/mytv/mymusic/ui/library/LibraryScreen.kt)：大标题、收藏主卡、最近播放和本地入口、自建歌单。
- [SettingsScreen.kt](https://github.com/mytv-android/myMusic/blob/38a263531e2828e3007789a127effb3bfd398910/app/src/main/java/com/mytv/mymusic/ui/settings/SettingsScreen.kt)、[SettingsCommon.kt](https://github.com/mytv-android/myMusic/blob/38a263531e2828e3007789a127effb3bfd398910/app/src/main/java/com/mytv/mymusic/ui/settings/SettingsCommon.kt)：分组列表、当前设置摘要、手机子页与宽屏双栏。
- [个人库截图](https://github.com/mytv-android/myMusic/blob/38a263531e2828e3007789a127effb3bfd398910/docs/images/screens/ui-library.png)、[设置截图](https://github.com/mytv-android/myMusic/blob/38a263531e2828e3007789a127effb3bfd398910/docs/images/screens/ui-settings.png)。

本次借鉴信息布局，使用现有 WebView 控件和业务接口实现；没有迁入 Kotlin 源码或新增原项目的均衡器、会员、音乐平台登录能力。

## 页面与操作

「我的」首页展示真实的红心歌曲数、按本机日期去重的今日播放歌曲数、本地已保存音频数和自建歌单。离线数量异步读取，读取失败时显示原因状态，不阻塞页面跳转。账号区域区分游客、已登录、离线账号和登录失效。

收藏、最近播放、离线、听歌报告、导入备份和歌单均进入现有功能。首页最多预览四张自建歌单，提供新建与管理全部入口。账号与设置通过右上角按钮进入；从个人中心打开设置后关闭设置，会回到个人中心。

| 设置分类 | 内容 |
| --- | --- |
| 外观 | 浅色/深色主题、界面语言 |
| 播放页 | 封面形状、氛围光、缺封面自动匹配、手动选图 |
| 歌词与动画 | 现有歌词效果、字号、动态预览、导入与时间校正 |
| 音乐源 | 后续播放优先、搜索平台/渠道、自定义音源、API 密钥 |
| 账号与同步 | 登录与账号资料、同步、设备会话 |
| 歌单与导入 | 当前队列来源、在线歌单、JS/JSON 文件导入 |
| 本地与离线 | 打开个人库的离线音频与存储管理 |
| 导入与备份 | 打开歌单迁移与个人资料导出 |
| 关于与更新 | 从 APK 读取的版本号、构建号、应用更新 |

音乐源中的「后续播放优先」使用既有换源偏好，不更改搜索平台筛选。当前歌曲仍从播放器顶部换源；不可用时沿用原有回退流程。关于页在浏览器中显示预览界面，在 APK 中显示实际安装版本。

Android 返回键和 Escape 逐级返回设置首页或个人中心。编辑歌单时仍会提示未保存内容；歌单或存储信息读取缓慢时可以返回，过期结果不会覆盖新页面。手机显示全屏页面，840 CSS 像素及以上在选择设置分类后显示双栏；横屏、大字号、48px 主要触控区域、键盘焦点和减少动态效果均已适配。桌面版保留原有个人库导航和设置表单。

## 实现与验证

- `js/android-profile.js`：个人中心布局与真实资料摘要。
- `js/android-settings.js`：设置分类、控件归组、当前值摘要与子页返回。
- `css/android-personal.css`：仅作用于 Android 的布局、主题与响应式样式。
- `js/personal-library.js`、`js/app.js`：个人中心入口、弹窗衔接、未保存保护及系统返回。
- `tests/android-personal.test.js`：今日播放去重、账号状态与实际版本信息。

全量回归通过：104 项 Python、574 项 JavaScript、22 项 Android JVM 测试，以及静态站点检查、生产资源构建检查、Android Lint 与 APK 构建。

`scripts/verify_android_personal_center.js` 使用本机 8794 端口和受控样例数据验证真实计数、收藏/歌单跳转、未保存编辑保护、账号与设置衔接、主题/封面/字号保存、播放偏好与搜索筛选隔离、离线入口、慢存储读取时返回与结果隔离、返回层级及桌面回归；覆盖 320/375/390px 手机、844px 横屏、1024px 平板和 22px 根字号，未出现页面脚本错误。截图中的歌曲、封面与账号状态为验收样例。

已有的 `scripts/verify_android_artwork_recovery.js` 和 `scripts/verify_android_online_lyrics.js` 在新设置路径下通过：候选封面选择、重载后保留与恢复原图、自动补图开关、手动歌词导入、时间校正保留、在线逐字歌词与缓存回退均正常。两项脚本使用本机 8793 端口及受控响应；歌词样例按真实渠道格式生成内部歌曲 ID。

实装效果图位于 `output/playwright/android-personal-home-dark.png`、`android-personal-home-light.png`、`android-personal-settings-dark.png`、`android-personal-settings-light.png` 和 `android-personal-settings-tablet.png`。

安装包：`output/android/ZPlayer-android-preview-24.apk`，版本 `1.18.0-preview`，versionCode `24`。已核对新脚本、样式及页面入口进入 APK，沿用既有预览包名和签名。当前未连接 Android 设备，真机点按、听音与系统返回键仍待设备验收。

SHA-256：`c64f2445a4e623dcfafc4830c69865287acd7cf0ea566dcc73c2256155286525`。
