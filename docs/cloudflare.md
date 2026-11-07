# Cloudflare 部署与联调

线上地址：https://music.505zc.tech

备用入口：https://cplayer5.cz162111.workers.dev

本项目使用一个 Cloudflare Worker，入口是 `sites/worker.js`。`ASSETS` 绑定提供静态文件，`/api/*` 交给 Worker。首页由 Worker 注入当前域名，避免社交分享元数据残留占位符。歌词效果、图片挂件和离线资源保留原始路径。

首次访问默认使用 GD 音乐台搜索、播放和获取歌词，无需添加 `?source=gd`。选择优先级为链接中的 `source` 参数、浏览器已保存的音源、默认 GD；手动切换后仍会记住选择。GD 模式的首页独立运行：以「华语」搜索展示曲目，主题与场景卡片在点击后才搜索；不会自动请求 ChKSz。GD 不提供实时榜单或歌单详情，榜单和歌手页优先显示已保存的内容，无缓存时提供搜索入口。选择 ChKSz 后才加载其在线内容，额度错误可一键切回 GD。

## 自定义域名

`cloudflare.config.ts` 中的 `worker.domains` 声明 `music.505zc.tech`。部署时 Cloudflare 为这个主机名创建指向 `cplayer5` 的 Custom Domain，并管理 DNS 与 HTTPS 证书；以后重新部署会保留该声明。

域名所在的 `505zc.tech` 必须在同一账号中保持有效。部署前核对同名 DNS 记录，避免保留指向旧站点的冲突解析。CLI 需要 Zone Read 与 Workers 管理权限；核对现有 DNS 还需要 DNS Records Read。如果 Cloudflare 返回 `100117`，需先备份并删除该主机名的旧 A/CNAME 记录，再部署自定义域名；删除操作额外需要 DNS Records Edit（`dns_records:edit`）。原有 workers.dev 地址作为备用入口保留。

配置同时显式保留 `previewUrls: true`，与当前控制台的预览地址设置一致，避免 CLI 因配置冲突中止上传。

## 构建和发布

安装 `.node-version` 指定的 Node.js 26.12.0，然后运行：

```bash
npm ci
npm run cf:check
npm run test:worker
npx cf auth login --no-device --use-keyring
npx cf auth whoami
npm run cf:deploy
```

如果系统 Node 版本较旧，可以为单条命令使用固定版本，例如：

```bash
npm exec --yes --package=node@26.12.0 -- npm run cf:deploy
```

配置文件为 `cloudflare.config.ts` 和 `vite.config.js`，不要再添加 Wrangler 配置。`cf` 和 Vite 插件目前为 beta，版本已锁定到 `package-lock.json`；升级后应重新运行 Workers 运行时检查。

`cf:check` 先生成 `dist/static`，再打包到 `.cloudflare/output/v0` 并执行部署预检查，不上传内容。`cf:deploy` 使用相同 production 构建模式发布。首次发布前检查账号中是否已有同名 `cplayer5`，多账号环境可使用 `CLOUDFLARE_ACCOUNT_ID` 指定目标。

GitHub Actions 运行原有检查、Cloudflare 部署预检查和 workerd 回归测试，不会在每次推送时自动部署。

GD 启动时仅恢复已保存歌单的本地缓存，不自动读取在线歌单详情或后台更新。ChKSz 精选分批展示，后续请求失败不会清空已加载的部分。GD 发现列表保留一天内的成功结果，网络失败时显示缓存时间。

## ChKSz Secret

进入 Cloudflare 控制台 → Workers & Pages → cplayer5 → Settings → Variables and Secrets：

1. 新增变量，类型选择 **Secret**。
2. 名称填写 `CHKSZ_API_KEY`，值填写自己的 ChKSz 密钥。
3. 保存并部署，使新版本生效。

`GET /api/v1/settings/music-key` 只返回 `configured`、`editable: false` 和来源，不返回密钥。未配置时 ChKSz API 返回 JSON 503，不影响 GD 或 Bilibili 的独立接口。密钥无需写入 Git；CLI 重发代码时保留现有 Secrets。密钥修改只在 Cloudflare 服务端完成。

本地 Workers 调试可将密钥放入被忽略的 `.dev.vars`，运行 `npm run cf:dev`。构建预览运行 `npm run cf:build && npm run cf:preview`，默认地址 `http://127.0.0.1:8794/`。

## 验证音乐源

```bash
# 顺序检查三种音源；也可在地址后指定 gd、chksz 或 bilibili
npm run probe:music -- https://music.505zc.tech
```

脚本每个音源选取一首真实搜索结果，以标准音质检查解析地址、读取少量音频数据，并检查歌词响应。不会输出密钥或带签名的音频地址；遇到鉴权、额度或限流错误就停止该音源，不重试、不切换源。非零退出表示至少一项尚未通过。ChKSz 检查会消耗接口额度。

脚本所在网络若无法访问站点，应使用正常浏览器检查同一地址，区分访问站点失败和音乐服务失败。浏览器中还需确认实际播放时间推进，HTTP 200 本身不足以证明音频可播。

| 音源 | 检查范围与边界 |
| --- | --- |
| ChKSz | 搜索、播放、歌词、歌单和聚合内容需要有效 Secret 与可用额度。 |
| GD | 搜索、播放、歌词、封面无需密钥。首页、主题搜索与本地歌单恢复不依赖 ChKSz；实时榜单、歌单详情需要另选 ChKSz。 |
| Bilibili | 匿名公开搜索和 AAC 音轨；字幕可能缺失或要求登录，歌词响应会标注具体状态。上游风控可能限制 Cloudflare 出口并返回 429。 |

GD 会串行处理同一 isolate 内的上游请求、缓存成功数据，并限制 50 次 / 5 分钟；排队超过 15 秒返回 429。这个计数并非跨地区、跨实例的全局配额。Bilibili 也有实例内节流和限流冷却。公开访问量增加时需另行配置集中限额；任何单次测试都不能保证第三方音乐源长期可用。

## Workers 兼容性回归

`npm run test:worker` 使用 Miniflare/workerd 执行真正的部署 bundle，覆盖三源请求、并发调用、重定向拒绝和音频 Range 流。

- Workers 的 fetch 不支持 `redirect: 'error'`；改用 `manual` 并拒绝上游跳转，避免请求直接抛错和凭据跟随跳转。
- GD 排队由当前请求自己的计时器推进，避免跨请求 Promise 导致运行时取消请求。
- Bilibili 只共享已完成的 JSON 缓存，不共享进行中的 fetch Promise。
- 未知 `/api/*` 返回 JSON 404，不回退成首页。

已开启 Worker Logs 和少量请求追踪，并配置查询字符串脱敏。在线检查结果记录在 [联调记录](cloudflare-validation.md)。

参考：[cf 项目配置](https://developers.cloudflare.com/cf/projects/cloudflare-config/)、[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Workers Request](https://developers.cloudflare.com/workers/runtime-apis/request/)。
