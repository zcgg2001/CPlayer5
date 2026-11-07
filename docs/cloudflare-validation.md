# Cloudflare 联调记录

日期：2026-11-07（Asia/Shanghai）。

站点：https://music.505zc.tech

备用入口及首次部署检查地址：https://cplayer5.cz162111.workers.dev

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

## 自定义域名验收

2026-11-07 14:22（Asia/Shanghai）绑定 `music.505zc.tech` 到 `cplayer5`，部署版本：`0ef9cd30-096c-4c14-8bc6-59e3fc86da2a`。

旧 A 记录已在本机备份并删除；Cloudflare 已创建受管理的代理 DNS 记录。Worker API 确认域名归属为 `cplayer5`，权威 DNS 返回 Cloudflare 边缘地址。域名声明及线上已启用的预览地址设置已写入 `cloudflare.config.ts`，部署预检查通过。

| 检查项 | 新域名检查结果 |
| --- | --- |
| HTTPS | 浏览器正常验证证书，使用 TLS 1.3，`isSecureContext: true`。 |
| 首页 | HTTP 200，标题 `CPlayer 5`，分享图片使用 `https://music.505zc.tech`。 |
| 静态路由 | index.html、离线页、歌单工具、Service Worker、音乐数据模块全部返回 200。 |
| API 路由 | 密钥状态返回 200、`configured: true`、`editable: false`；未知 API 返回 JSON 404。 |
| GD | 搜索返回 3 首；样本 `2668397359` 标准音质 128 kbps，跨域音频实际播放到 1.53 秒，readyState 4，歌词 1470 字符。 |
| ChKSz | 同一样本搜索、解析及播放通过；标准音质 128 kbps，实际播放到 1.54 秒，readyState 4，歌词 1470 字符。 |
| Bilibili | 本次域名切换未重复请求；此前上游 429 的限制仍按未通过记录，不宣称恢复。 |

本轮变更仅涉及域名及部署配置，重新执行了构建和部署预检查，并在新域名完成上述在线验证。

## ChKSz 额度耗尽时的 GD 独立运行

2026-11-07 部署版本：`c398e390-a5f0-47dc-ac2c-5fb2815f387d`。

- 本地浏览器将所有 ChKSz 请求模拟为 HTTP 402，GD 使用固定测试数据：GD 首页、主题搜索、桌面播放和手机搜索通过，无未处理页面异常。首页仅请求 GD 搜索，保存的歌单 ID 不再触发在线详情请求。
- GD 模式的榜单与歌手页在无缓存时显示搜索入口；有缓存时正常展示并标明已保存内容，均不请求 ChKSz。手动选择 ChKSz 后出现额度错误，可通过页面按钮切回 GD。
- 线上 `music.505zc.tech/?source=gd` 返回 200，发现区显示 10 首曲目、12 个主题入口，启动请求仅包含 GD 搜索和封面。
- 真实音频样本《不死鸟》（`1492053266`）经 GD 解析为标准音质 128 kbps；跨域音频播放推进到 1.52 秒、readyState 4，歌词返回 1304 字符。
- 104 项 Python 测试、233 项 JavaScript 测试、静态资源检查及 Cloudflare 构建/部署预检查通过。

GD 发现区明确标注为关键词搜索结果，不替代实时榜单。GD 不提供的在线榜单和歌单详情仍属于 ChKSz 的可选功能。
