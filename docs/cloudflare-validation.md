# Cloudflare 联调记录

日期：2026-11-07（Asia/Shanghai）。

站点：https://cplayer5.cz162111.workers.dev

首次部署版本：`614696cf-70bd-4506-a946-f87b47065dfd`。

| 检查项 | 结果 |
| --- | --- |
| 部署 | Cloudflare API 确认发布成功，68 个静态文件上传完成。 |
| 页面 | 真实浏览器加载成功，分享图片地址使用线上域名。 |
| 路由 | 首页、index.html、离线页、歌单工具和 Service Worker 返回 200；未知 API 返回 JSON 404。 |
| 歌词与挂件 | 线上加载歌词选择器（20 种效果及随机选项）和独立蜘蛛模块。 |
| GD 搜索 | 200；样本 ID `2668397359`，`晴天 (原唱 周杰伦)`，RyaVocal。 |
| GD 解析与播放 | 标准音质 128 kbps；浏览器音频 readyState 4，静音播放时间从 0 推进到 1.96 秒，时长约 270.74 秒。 |
| GD 歌词 | 200，返回 1470 字符 LRC。 |
| 播放器交互 | GD 搜索列表正常展示；页面播放器显示《江南》944 kbps FLAC，进度推进到 0:21 / 4:27，暂停操作有效。 |
| Bilibili 搜索 | 首测及 ChKSz 配置后复查均返回 429 / `provider_rate_limited`；上游风控尚未恢复，停止后续播放和字幕请求，尚未通过。 |
| ChKSz 配置与搜索 | Cloudflare 确认 `CHKSZ_API_KEY` 为 Secret，线上配置状态为 true 且不可网页编辑。搜索返回 200、3 首歌曲；样本 ID `2668397359`。 |
| ChKSz 标准播放 | 128 kbps，浏览器 readyState 4，静音播放推进到 1.96 秒，时长约 270.74 秒。 |
| ChKSz 默认无损播放 | 返回 lossless / 646443 bps；使用与播放器一致的 `crossOrigin: anonymous`，成功解码并播放到 1.96 秒，readyState 4。 |
| ChKSz 歌词与榜单 | 歌词返回 200、1470 字符 LRC；热歌榜返回 200、50 首曲目。 |

本次终端网络访问 workers.dev 失败，但同机真实浏览器能访问站点。在线证据以浏览器结果为准；终端失败不记为音乐源失败。外部音源结果仅代表此次样本和网络出口，不能据此声明所有歌曲、全部音质或长期可用性。

本地验证：104 项 Python 测试、230 项 JavaScript 测试及 5 项 workerd 运行时回归通过；静态资源、构建产物、Node 服务冒烟和 Cloudflare 部署预检查通过。
