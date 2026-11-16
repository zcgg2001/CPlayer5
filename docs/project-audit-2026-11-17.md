# 项目检查与 Android 预览版（2026-11-17）

CPlayer5 是网页音乐播放器，服务端代理音乐 API、账户和个人库数据，网页负责搜索、歌词与音源调度。本轮按约 10 人同时使用的小站规模检查高风险路径，并增加复用网页的 Android APK。没有用第三方音源做长时间并发压测，因此本报告不把小样本播放成功当作容量或长期可用率承诺。

## 已修复的问题

| 问题与具体触发 | 原因 | 本轮处理 |
| --- | --- | --- |
| 煎饼等来源使用编码 URL 作为歌曲 ID，收藏、歌单保存或同步报“歌曲 ID 无效” | 目录 ID 与个人库的字符/长度约束不一致，`%HH` 被拒绝 | 共享有界不透明 ID 校验；有效编码可以保存，控制字符、HTML 和无效转义仍被拒绝 |
| 搜索时选定 OP / 星海等音源，保存到个人歌单或跨设备同步后优先源丢失 | 同步投影遗漏 `preferredProvider` | 保存经过格式校验的选定来源，仍剔除临时播放 URL；浏览器和服务端使用同一规则 |
| 中国时区每月 1 日凌晨收听计入上月 | 统计使用 UTC 日历，界面预期本地日历 | 新数据按设备当地年月日统计；不对无法确定原时区的历史汇总做猜测迁移 |
| 替换公开 `window.playlist` 时抛出异常，随机队列未重建 | 对纯状态对象调用不存在的 `resetOrder` | 改为调用 `queueStore.resetOrder()`，以真实入口做回归测试 |
| Android 后台播放没有前台服务保护 | Activity 使用本地 binder，MediaSession 未自动注册到服务 | 显式 `addSession`，由 Media3 管理前台通知与音频焦点 |
| Android 收到播放错误后换源会从零恢复 | 原生错误消息不含时钟，桥接把缺失字段当成零 | 保留最后播放位置及长度，停住推算时钟后交回原换源流程 |
| Android 页面重载/渲染进程退出后，音频可能继续但网页失去控制 | 原生播放器生命周期比网页长 | 页面卸载停止音频，渲染器退出释放旧网页并重建；Activity 普通重建继续使用同一网页实例 |

前四项是现有网页中的问题；后三项是新增 Android 实现验证阶段发现并处理的问题。新增回归测试覆盖编码 ID、来源持久化、跨月统计、旧播放消息隔离、Blob 分流及错误恢复位置。

## 代码整理

- 主入口 `index.html` 从 9,225 行降到 1,685 行，结构、样式与逻辑分离到 `css/player-base.css` / `js/app.js`；不引入新的前端框架。
- 保留已有业务模块边界，增加独立 `js/native-audio.js` 平台适配层。Android 不复制网页的音乐匹配、免费额度或音质策略。
- 更新 Service Worker 缓存、构建静态检查和入口相关测试；HTML 解析测试继续只解析真正的 HTML。
- 更正 README 中指向上游的仓库/演示地址、运行依赖说明与开发分支流程；[代码地图](CODE_MAP.md)列出全部程序、配置和测试文件。
- `js/app.js` 仍有约 6,200 行，是下一步可维护性重点。优先按设置、移动抽屉、推荐交互等稳定行为分离状态；本轮没有为了文件数量而打散耦合状态。

## GitHub 项目研究

| 来源（固定研究版本） | 借鉴的机制 | 在本项目中的选择 |
| --- | --- | --- |
| [MusicFree 播放器](https://github.com/maotoumao/MusicFree/blob/d118b18b3d0c904400f7eea7bf99c0ceec6c1aee/src/core/trackPlayer/index.ts) | 音源与播放器分层、质量尝试、队列和当前曲目状态 | 继续复用现有 router/controller；Android 仅作为音频执行器，不另写一套音源规则 |
| [Gramophone 播放服务](https://github.com/FoedusProgramme/Gramophone/blob/28130867110a1f2474e45b266a9ceb5e341747c7/app/src/main/java/org/akanework/gramophone/logic/GramophonePlaybackService.kt) | Media3 服务生命周期、音频焦点、拔耳机暂停、资源释放 | 新增 MediaSessionService，保留服务与 Activity 的生命周期边界 |
| [Android 官方后台播放文档](https://developer.android.com/media/media3/session/background-playback) | Player 和 MediaSession 位于独立服务，系统通知和媒体控制 | 用官方 Media3 / WebKit 依赖；无需重做现有网页界面 |
| [此前 SPlayer-Next 研究](splayer-matching-and-playback.md) | 多源同录音匹配、歌词/播放解耦、预解析 | 保留既有严格版本匹配和有界预解析；不承诺网络环境下“零延时” |

MusicFree（AGPL-3.0）和 Gramophone（GPL-3.0）仅作结构研究；未复制其实现。Android 新代码为独立实现。

## 验证范围

- Python：104 项通过；Node：465 项通过；静态资源检查通过。
- Cloudflare：构建/部署检查通过；16 项实际 workerd 测试通过，覆盖 D1 权限、并发版本控制、音源状态和凭据隔离。
- 浏览器：12 组交互检查通过，包括游客入口、导入、推荐独立加载、播放缓冲、音质降级、断线换源保留进度、手动恢复、桌面/手机布局，以及搜索选定 OP 源优先；使用受控 API 与真实可解码 WAV，不消耗 ChKSz 额度。
- 生产依赖：官方 npm registry 的 `npm audit --omit=dev` 返回 0 个已知漏洞。这个结果不覆盖所有开发依赖或未知漏洞。
- Android：APK 编译、2 项 Java 策略测试及 lint 通过（0 错误，1 条固定 Gradle 版本可升级提示）。Android 15 / API 35 模拟器安装成功；使用生产站点与星海真实音源播放“有何不可”，后台及锁屏播放、系统暂停/继续、锁屏切到“玫瑰花的葬礼”均成功；屏幕处于 Asleep 时原生状态为 PLAYING 且前台通知存在；将第二首跳到结尾，锁屏状态下也成功自动续播第一首。返回界面后歌名、进度正常且无捕获到的 JS 错误。

深入检查了播放会话、换源/缓存、音源适配的 URL/凭据边界、个人库序列化、账户/协作权限、数据库版本控制、离线存储所有者切换、构建和新 Android 生命周期。未逐行审阅第三方压缩库、全部历史 UI 动画、所有机型兼容性；没有进行破坏性生产测试，也没有读取或修改真实用户的个人数据。

## 剩余事项

1. Android 作为预览版交付。需要真机验证各品牌后台省电、蓝牙/来电、长时间断网重连、文件导入及多账户同步；功能边界见 [Android 文档](android.md)。
2. 正式 Android 分发需固定 release 签名及版本升级策略。目前是可安装的调试包，不是商店发行包。
3. 第三方音源可用性随地区、曲目、授权与时间变化。ChKSz 继续仅在显式选择时使用；本轮没有消耗其额度做探测。
4. 大型入口模块的行为拆分和受控 10 人容量测试仍值得继续做。本轮通过不等于整个项目不存在其他 bug。
