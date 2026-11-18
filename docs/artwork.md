# 封面获取与缺图回退

发现页、搜索、队列、收藏和播放界面共用 `js/artwork.js`。音频和歌词可以在取封面期间独立加载。

## 如何找到对应的封面

1. 先读取这首歌上次成功显示的封面，或使用音源给出的歌曲、专辑图片。网易云和 QQ 的公开 CDN 地址可以按显示尺寸取图，缩略图不可用时再尝试原地址。GD 和煎饼的封面接口保留各自的查询参数。
2. 网易云歌曲缺图时，按照原始歌曲 ID 读取歌曲资料。如有必要，再按该歌曲的专辑 ID 获取图片。
3. QQ 歌曲缺图时，使用歌曲 MID 查询单曲资料，核对返回的歌曲 MID，再用其中的专辑 MID 生成图片地址。网页版通过 `/api/v1/music/metadata` 的 `artwork=1` 模式查询。安卓版通过随包提供的 `/android-player/qq-artwork/<歌曲 MID>` 查询。
4. 跨平台取图需要匹配歌曲、歌手、专辑和版本。同一录音出现在不同合辑时，各自保留所选发行版本的封面。所有候选均不可用时，按专辑和歌手生成稳定的占位图。

## 列表和缓存

列表滚入视口时才加载封面，最多同时解析四行。同一首歌的并发资料查询会合并。切歌或复用列表行后，旧请求的结果不会覆盖当前歌曲。

每次解析最多尝试五个图片地址，总预算 12 秒，单张图片最多等待 3.5 秒。暂时性失败缓存 30 秒，资料接口确认缺图后缓存五分钟。设备最多保留 200 条已验证的公开封面地址，按平台和歌曲 ID 区分。收藏会保存已验证的地址，旧收藏缺图时也会按原歌曲重新补全。

`/api/cover` 只代理允许的 HTTPS 图片 CDN，每次重定向都重新校验目标。单张图片限制 2 MiB，最多跟随两次重定向。服务端缓存成功图片一天，404 和 410 缓存五分钟。网页版 Service Worker 最多保留 100 张同源封面。

## 安卓回归检查

用游客身份搜索 GD 的《素颜》（许嵩、何曼婷）和 OP Music · QQ 音乐的《晴天》（周杰伦），逐首加入队列，再从队列的心形按钮收藏。强制停止应用并重新进入游客模式，直接打开「我喜欢」和「当前播放」，检查两首歌的封面。发现页「继续播放」中的同一首歌也应显示相同封面。

《素颜》的 GD 图片 ID 为 `109951169829246225`。《晴天》的歌曲 MID 为 `0039MnYb0qxYhV`，对应《叶惠美》的专辑 MID 为 `000MkMni19ClKG`。这两个标识用于核对回归结果。

## 参考项目

- LX Music Mobile 从 QQ 单曲资料分别保留歌曲 MID 和专辑 MID。[QQ 单曲资料实现](https://github.com/lyswhut/lx-music-mobile/blob/0669d1b6d419967822ff52ec06e50b9613bfd136/src/utils/musicSdk/tx/musicInfo.js#L76-L88)
- Music Assistant 讨论了播放或查看详情时补全元数据的策略。[元数据按需获取](https://github.com/orgs/music-assistant/discussions/543)
- Navidrome 提供了封面来源优先级和缓存容量设置。[封面配置](https://github.com/navidrome/website/blob/master/content/en/docs/usage/configuration/options.md)
- Navidrome 的 Cover Art Archive 插件区分确认缺图和短暂错误。[封面缓存实现](https://github.com/navidrome/discord-rich-presence-plugin/blob/main/coverart.go)
