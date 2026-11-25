# 音乐墙歌词加载修复（1.18.5）

适用反馈：Android APK 的音乐墙推荐歌曲偶发显示「暂无歌词」。本轮没有获得具体失败歌名，
因此通过代码追踪和可控网络响应复现空结果、超时与快速切歌，再检查公开接口。

## 发现与修改

音乐墙推荐数据来自网易云目录，常标记为 GD 渠道。此前主要歌词请求只访问音频对应的渠道，
Android 独立补充仅支持 QQ、酷狗；GD 空结果未必意味着原歌曲没有歌词。
音频换源后也需要保留原目录 ID，不能把另一平台的数字 ID 当作网易云 ID。

- 新增网易云原生精确 ID 请求，与音频解析独立运行。优先读取 `/api/song/lyric/v1`，
  空结果或失败后读取 `/api/song/lyric`，保留实际返回的 YRC、LRC、翻译和罗马音。
- 同源歌词使用当前歌曲、原音乐墙记录和已经严格匹配的同曲记录，按渠道去重。
  GD 空结果、占位歌词或失败后尝试同 ID 的网易云渠道；ChKSz 歌词仍走免费网易云渠道。
  最多 4 个候选，每个普通渠道最多 4 秒，总预算 12 秒；Bilibili 保留 10 秒的单独字幕等待。
- 平台歌词请求与音频准备并行，Android 原生补充可更早从已选歌曲元数据开始。
  切歌取消旧请求，并校验播放会话与媒体代次；旧歌词和旧错误不能覆盖新歌。
- 主请求、原生补充或社区查询仍在进行时，显示「正在获取歌词…」。全部结束仍为空时，
  显示「暂未找到歌词，可重试补全」，保留歌曲身份和补全按钮。
- LRCLIB 先按歌名、歌手、专辑查询，再用组合关键词查询。首次网络失败可继续下一个查询，
  429 不立即重复请求。候选仍按歌名、歌手、版本、时长或专辑校验。
- 已有缓存先显示；后台失败保留缓存。用户导入的歌词、校正和外观不会被异步响应覆盖。

## 与 myMusic 的对应关系

参考截至 2026-11-25 的提交
[`0e38f61`](https://github.com/mytv-android/myMusic/tree/0e38f61a80bbe5fb160dd8db2c79f4d2de24ae31)，
相关歌词流程与本地参考版本 `38a2635` 一致。依据公开接口和现有播放器架构独立实现。

| 逻辑 | myMusic | 本项目 1.18.5 |
| --- | --- | --- |
| 网易云 | `NetEaseProvider.lyrics` 按歌曲 ID 获取，优先真实 YRC，回退 LRC | APK 新增公开 HTTPS 精确 ID 通道，保留返回的歌词层 |
| QQ / 酷狗 | MID / ID 获取 QRC，hash 查询并下载 KRC | 继续使用已有原生 QRC / KRC 通道 |
| 酷我 | 平台专用歌词接口及备用接口 | 继续使用已有渠道，没有增加原生酷我适配 |
| 平台返回空歌词 | `MusicViewModel.loadLyrics` 调用 `CommunityMetadata` | 同平台候选回退后，LRCLIB 补全；Android 原生请求可并行 |
| 社区查询 | LRCLIB 结构化与组合查询，匹配同一录音 | 保留严格同曲检查，新增查询失败后的继续尝试 |
| 快速切歌 | 取消旧任务并校验当前歌曲 key | 取消请求并校验会话、媒体代次和歌词控制器代次 |

上游源码：
[MusicViewModel](https://github.com/mytv-android/myMusic/blob/0e38f61a80bbe5fb160dd8db2c79f4d2de24ae31/app/src/main/java/com/mytv/mymusic/ui/MusicViewModel.kt)、
[NetEaseProvider](https://github.com/mytv-android/myMusic/blob/0e38f61a80bbe5fb160dd8db2c79f4d2de24ae31/app/src/main/java/com/mytv/mymusic/data/native/NetEaseProvider.kt)、
[CommunityMetadata](https://github.com/mytv-android/myMusic/blob/0e38f61a80bbe5fb160dd8db2c79f4d2de24ae31/app/src/main/java/com/mytv/mymusic/data/metadata/CommunityMetadata.kt)。

## 验证

- 新增服务与播放测试：空结果、占位歌词、HTTP 失败、请求超时、总取消、站点限流、
  跨平台身份隔离、原曲 ID 保留、纯文本回退、音频准备期间取词和旧请求取消。
- Android MockWebServer：精确 ID、歌词层、Referer、空结果及 HTTP 503 回退、两路空结果报错。
- Playwright `scripts/verify_android_wall_lyrics.js`：从音乐墙展开封面并点击播放，验证推荐歌曲原生补全、
  同平台备用渠道、加载状态与快速切歌、当前歌曲重试、LRCLIB 首次查询失败及缓存恢复。
  使用原创歌词和本地 WAV，响应可控；并非手机实测或线上全部音乐渠道的可用性证明。
- 回归检查已有歌词缓存、手动导入与时间校正，以及 QQ QRC、酷狗 KRC 和播放器换源流程。

本轮结果：104 项 Python、593 项 JavaScript、25 项 Android JVM 测试通过；静态检查、
网站构建检查及 APK 构建通过，Android lint 为 0 错误、4 项既有警告。
音乐墙 6 个场景、缓存 7 个场景、在线逐字歌词 9 个场景、换源 10 个场景通过，
未捕获浏览器异常为 0。APK 中 127 个 JavaScript / CSS 文件与工作区逐字节一致。

安装包：`output/android/ZPlayer-android-preview-29.apk`，版本 `1.18.5-preview`，
沿用此前预览版包名与签名。SHA-256：
`45b5a03691dd1a09c234c811d4c178921cd97bf2e1189c69b8fb59c50f996d87`。

公开网易云接口样本在本机返回 HTTP 200 与 LRC / 翻译。本轮样本未返回 YRC，
YRC 保留逻辑通过固定样本验证；不保证每首歌都有逐字歌词。
未连接 Android 真机，手机网络、系统 WebView 与第三方接口的实际表现仍需安装 APK 验证。
此版本包含此前音乐墙拖动、60% 默认音量和自定义音源切换改进。
