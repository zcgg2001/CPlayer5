# 音乐渠道与横向切换

发现页、搜索页、手机搜索页和设置共用 `js/music-source-tabs.js`。横向标签支持点击、左右滚动、滚动箭头和方向键 / Home / End；选中项带下划线。选择保存在 `cp_source`，链接 `?source=` 优先，首次访问仍默认 GD。搜索页切换渠道时会用原关键词重搜，纯数字关键词不会因切源触发自动播放。

| 平台 | 渠道 | source / provider | 音质选择 |
| --- | --- | --- | --- |
| 网易云 | Meting | `netease` | 标准、极高、无损 |
| 网易云 | 51ape | `at38-netease` | 按实际返回音质 |
| 网易云 | 煎饼 | `jianbin-netease` | 按实际返回音质 |
| QQ 音乐 | 51ape | `at38-qq` | 按实际返回音质 |
| QQ 音乐 | VKeys | `qq` | 按实际返回音质 |
| QQ 音乐 | 煎饼 | `jianbin-qq` | 按实际返回音质 |
| 酷狗 | 煎饼 | `jianbin-kugou` | 按实际返回音质 |
| 酷我 | 煎饼 | `jianbin-kuwo` | 按实际返回音质 |
| 酷我 | 歌曲客 | `gequke` | 按实际返回音质 |

保留 GD、ChKSz 和 Bilibili。新增渠道无需 ChKSz 密钥，当前提供在线播放。它们的首页使用「华语」搜索与本地主题卡片，不访问 ChKSz 的榜单、歌手或歌单接口。上游失败仅影响对应内容区域，可以直接换源。

## 接口与实现

参考 [coco-downloader](https://github.com/markcxx/coco-downloader) 的 [渠道清单](https://github.com/markcxx/coco-downloader/blob/main/src/lib/music-channels.ts)、[适配器](https://github.com/markcxx/coco-downloader/tree/main/src/lib/providers) 与 [歌词实现](https://github.com/markcxx/coco-downloader/tree/main/src/lib/lyrics)，独立实现适合 Workers 的 fetch 适配层。参考版本：`5ceaa5fe8e8bc86f2e1e78d2859f7da63bf47bb9`。项目没有依赖额外部署的 coco-downloader 服务，也不执行上游 JavaScript。

对前端沿用 CPlayer 的 API：

- `GET /api/v1/music/search?source=netease&keyword=青花瓷&limit=20&offset=0`
- `GET /api/v1/music/song?source=netease&id=259138&level=lossless`
- `GET /api/v1/music/lyric?source=netease&id=259138`

返回格式保持 `{ code: 200, data: ... }`。播放地址指向本站 `/api/v1/music/audio`，以 HTTPS 流式传输，支持 Range / HEAD；VKeys 上游的 HTTP 地址不会交给浏览器。音质以返回文件格式和已知码率为准，未提供码率时不伪造 128 / 320 / 2000 kbps。QQ 官方搜索返回临时错误时，改用 51ape 的 QQ 曲库搜索，保持 QQ mid 和 VKeys 播放渠道不变。Meting 的 FLAC 请求也可能被上游降级，因此不会按请求等级强行标记无损。

`js/music-channels.js` 定义渠道元数据。前端队列 ID 为「渠道 + 编码后的原始 ID」，`sourceId` 保留上游标识；播放和歌词根据歌曲自己的渠道路由。煎饼的 ID 包含签名，过期后需要重新搜索；歌曲客的数字 ID 不会当作酷我官方 ID。

`sites/channel-http.js` 限制响应大小、超时、会话 Cookie 和允许访问的域名；`sites/channel-providers.js` 处理具体上游协议；`sites/music-channels.js` 提供接口与流式音频。会话隔离到单次请求，缓存仅保存已完成的公开数据，容量上限 8 MiB / 160 项；音频不缓冲进内存。只允许指定平台的音频域名和扩展名，逐跳校验重定向，不转发用户 Cookie 或任意目标地址。

HTML 使用 `cheerio/slim` 解析。网易云 eapi 使用 Node crypto，Workers 的兼容日期为 2026-11-07；真实 workerd 测试同时验证加密请求与解密响应。

## 验证

```bash
# 本地直连上游；不读取 ChKSz Secret
node scripts/probe_music_channels.js
# 从已部署的 Worker 验证；可在地址后指定渠道
node scripts/probe_music_channels.js https://music.505zc.tech netease at38-qq
```

每个渠道依次搜索「青花瓷」「晴天」「稻香」，解析首条结果并请求前 4 KiB 音频，读取首个响应数据块，输出状态、格式和文件头，不打印 Cookie 或签名直链。实际读取量取决于响应分块。这些采样不代表整个曲库或所有地区始终可用。浏览器验证还要检查播放时间实际推进。

2026-11-07 本地实测：9 个渠道 × 3 个关键词全部通过搜索、解析、音频读取（27 / 27）；Meting 的「青花瓷」「晴天」样本为 FLAC，「稻香」返回 MP3，其余渠道样本为 MP3。Cloudflare 与浏览器验证记录见 [线上联调记录](cloudflare-validation.md)。
