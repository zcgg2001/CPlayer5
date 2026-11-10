# 工程与稳定性

本次实现保留现有播放器与 Cloudflare Worker 架构，Node 与 Worker 共用同一套运营 API。管理入口 `/admin`，公开资料目录 `/library`。部署前必须应用 `0003_operations.sql` 与 `0004_admin_bootstrap.sql` 并配置管理员，不能只上传静态网页。

## 已实现的链路

| 能力 | 行为 |
| --- | --- |
| 音源健康 | 按搜索、播放解析/代理、资料三个操作统计请求、失败、平均/最大耗时；仪表盘展示近 24 个小时桶的数据。未采样显示“暂无样本”。 |
| 自动摘除 | 同一音源/操作连续 3 次服务故障后熔断，初始冷却 2 分钟，重复失败延长至最多 15 分钟；到期仅一个共享 SQL 租约放行真实恢复探测。 |
| 自动换源 | 复用既有同版本匹配与断点恢复；服务端已停用/冷却的源会跳过。真正开始播放后显示“已为你切换音源”，浏览器自动播放拦截不会误报。 |
| 缓存 | 搜索 30 秒、歌单/榜单 5 分钟、资料 10 分钟、歌词 1 小时；Worker Cache API 与 Node 有界 LRU。变更运营配置/服务端密钥后使用新缓存键。 |
| 封面 | `/api/cover` 仅允许固定音乐 CDN 域名的 HTTPS 图片，不跟随跳转，拒绝 SVG，最多 2 MB，缓存一天。播放封面与推荐卡片接入。 |
| 预取 | 下一首低成本音源预取媒体元数据，最多 8 秒；换歌取消；省流量/2G 下关闭，跳过 OP 任务型音源及视频。不会扣游客试听次数，不持久保存整首音频。 |
| 限流 | Cloudflare 边缘限流先挡突发，再由 SQL 按 IP 的分钟哈希及操作分组计数；Node 使用 socket IP，可信反代需显式启用。客户端限制突发并遵守 Retry-After。 |
| 监控 | 固定词汇的匿名播放开始/失败/换源、JS 错误和未处理拒绝事件；服务端 JSON 日志、请求 ID、熔断事件和可选 HTTPS webhook。 |
| 后台 | 已有账号登录 + 服务端用户 ID 白名单；音源开关/优先级、榜单排序、首页模块选择/排序、敏感词、公开页草稿/发布/驳回。CAS 防止覆盖，SQL 事务记录变更。 |
| SEO | 已审核的 `/artist/:id`、`/album/:id`、`/playlist/:id` 返回完整 HTML、canonical、hreflang 和 JSON-LD；robots/sitemap/目录可抓取。来源为网易云公开资料，失败返回 404/503，不伪造内容。 |
| i18n | `zh-CN`/`en` 字典、持久语言选择和 Intl；后台与公开页双语，登录/注册/游客、主导航及播放提示覆盖。歌曲内容不翻译；部分旧设置面板/歌词效果说明仍保留中文，后续可逐步迁移显式字典键。 |

## 初始管理员

正式站点管理员用户名为 `admin`。初始凭据只用于首次登录；进入 `/admin` 后，必须设置 12–128 位新密码才能读取仪表盘或修改运营配置。密码保存为独立盐值的 scrypt 哈希，修改时在同一事务内撤销所有旧会话和设备授权，随后需要重新登录。普通注册仍要求 8–128 位密码，不能注册保留用户名 `admin`。

新部署可显式运行 `node scripts/prepare_admin.js .local/admin-bootstrap.json` 生成一次性 SQL 批次，再通过 D1 批处理应用，并将输出的用户 ID 配入 `OPS_ADMIN_USER_IDS`。此脚本不会在启动或更新时自动执行；已存在同名用户时唯一约束使整个批次失败，绝不覆盖现有密码。`.local/` 不提交到 GitHub 或构建包。

## 启用管理后台

1. 使用正常注册流程创建管理者自己的账号。通过该账号的 `/api/account/me` 响应或服务端 SQL 按用户名查询用户的 `id`。不要将密码、Cookie 或令牌填进运营配置。
2. 将一个或多个不可变用户 ID 以逗号分隔放进服务端 `OPS_ADMIN_USER_IDS`。默认空白表示没有管理员；注册顺序或用户名都不会自动授予权限。
3. Node 使用环境变量启动，例如 `OPS_ADMIN_USER_IDS='用户ID' npm start`。Node 自动应用增量迁移，现有账号资料保持不变；显式加载 `.env` 可使用 Node 26 的 `node --env-file=.env server.js`。
4. Cloudflare：先按 [账号部署文档](accounts-and-devices.md) 执行迁移，将 `OPS_ADMIN_USER_IDS` 加入已有的受限权限 `.local/account-secrets.json`（保留 `AUTH_SECRET`，不要重新生成），重新构建并部署。

```sh
npx cf d1 migrations apply "$CPLAYER_ACCOUNTS_D1_ID" --dir migrations --dry-run
npx cf d1 migrations apply "$CPLAYER_ACCOUNTS_D1_ID" --dir migrations
npm run cf:build
npx cf deploy --prebuilt --mode production --secrets-file .local/account-secrets.json --dry-run
npx cf deploy --prebuilt --mode production --secrets-file .local/account-secrets.json
```

主仓库的 D1 ID 已在配置保留；若使用上面的命令，请先把 `CPLAYER_ACCOUNTS_D1_ID` 设为目标数据库 ID。正式域名仍使用 `AUTH_URL`，备用域名不能进行管理写入。上线后直接访问 `/admin`，使用独立登录表单进入后台；也可复用播放器的登录会话。页面没有管理权限时返回明确提示，管理 API 返回 401/403。

配置冲突时保留未保存编辑；可点击“放弃修改并刷新”获取最新版本，再重新编辑。配置里没有任意上游地址或密钥输入框，增加新音源仍需编写并审查服务器适配器。

## 指标、告警和数据边界

健康数据反映服务端 API 观测，不声称等于整首音频可听率。404、输入错误、用户取消、单曲缺少地址/音质不会触发摘除；ChKSz 的凭证/额度拒绝算服务故障。公开客户端上报只进入事件计数，不能操纵全站熔断。无流量时不会定时请求所有音乐平台，冷却到期后的下一次真实请求负责恢复探测；播放器本机仍处理 CDN/解码失败。

Cloudflare 每 15 分钟清理数据；Node 在请求时最多每 15 分钟执行一次清理。指标和事件保留 7 天，配置审计保留 90 天，限流计数约 2 分钟过期。SQL 查询按时间索引清理。后台每 30 秒更新，标签页不可见时暂停自动刷新；草稿不被自动刷新覆盖。

可选 `OPS_ALERT_WEBHOOK` 是服务器私有的 HTTPS 接收地址，熔断状态变化时 POST：

```json
{"event":"source_circuit_open","source":"gd","operation":"playback","at":"ISO 时间"}
```

只有配置地址后才发送外部通知；未配置时后台和 Workers Logs 仍保留告警。通知有 5 秒超时，不跟随跳转，失败记录 `delivery_failed`，目前没有外部队列重试。这是轻量自建错误聚合，不等同于完整 Sentry 的堆栈、source map、工单和告警升级体系。需要这些能力时可在服务器侧接入现有监控平台，不应直接发送浏览器任意堆栈。

事件不保存搜索词、歌曲名、URL、原始错误文本、密码、Cookie 或账号标识；每浏览器每分钟最多上报 10 个固定词汇事件。`cp_diagnostics=off` 本地设置可关闭浏览器上报。管理员审计只在服务器保存操作者 ID，公共接口不返回敏感词、审核草稿、审计或用户信息。

边缘限流为每 IP 每分钟最多 360 次；SQL 分组为普通 API 180、播放 90、封面 240、后台 30、事件 30 次/分钟，认证接口还保留 Better Auth 自身更严格的规则。共享出口的用户可能共用 IP 配额，真实流量增大后应观察 429 再调整。未配置 SQL 的独立开发环境退化为进程内限流，不提供跨实例保证。

只有公开元数据可以缓存：账号、同步、管理、播放解析中的签名 URL、媒体 Range 和错误响应不进入公共缓存。CDN Cache API 是数据中心本地缓存；Node 缓存最多 64 项、总计 16 MB。不要用私人同步记录生成 SSR 页面。公开页发布决定是否可抓取，实际搜索引擎收录时间由搜索引擎决定。

## 验证

运行 `npm test`、`npm run cf:check`、`npm run test:worker`、`npm run check:build`、`npm run smoke:server`。新增用例覆盖熔断与并发半开探测、真实 D1 计数、取消/404 排除、站点限流不污染音源评分、管理员/CSRF/CAS/审计、缓存凭证轮换、音源名称规范化与停用防绕过、封面 SSRF/跳转/SVG/体积限制、遥测注入边界和 SSR 转义/审核。初始管理员另有 Node 与 workerd/D1 用例验证登录、改密前权限拦截、原密码核验、并发改密只允许一次成功，以及事务内撤销旧会话。

浏览器使用隔离的内存数据库验证登录、语言切换、后台配置保存及手机布局。预览中的账号和统计为本地验收数据，不是线上用户或线上服务质量。

参考：[Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)、[Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[D1 事务批处理](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。
