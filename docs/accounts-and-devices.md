# 账号、游客与多端

这次实现沿用现有原生 ES module 播放器、Node 服务和 Cloudflare Worker。认证使用 Better Auth 1.7.18 的用户名与密码方案，桌面使用 Electron 45.2.3。注册不需要邮箱、短信或 OAuth 服务。

## 使用入口

每次打开或刷新播放器先显示登录入口，选择 **登录**、**注册账号** 或 **游客试用** 后进入播放器。已有服务器会话也不会跳过这个入口。登录后可在设置 → **账号与多端** 管理资料：

- 游客：每个浏览器累计试听 50 首不同歌曲，成功开始播放才计数；同一音源、同一 ID 的重复播放不扣次数。额度用完后可以重播已试听歌曲，播放新歌曲需要登录。
- 注册与登录：用户名为 3–24 位英文字母、数字或下划线，不区分大小写；密码为 8–128 位，注册时确认两次。注册成功直接进入播放器，重复用户名和错误密码有明确提示。
- 同步：收藏、保存的歌单、播放队列、音源/音质/主题/歌词偏好；正在播放时每 30 秒保存进度，暂停或拖动进度时也保存。其他设备点击“继续播放”，不会被远程设备自动启动播放。
- “我的歌单”：将当前队列保存为命名歌单、载入队列、删除歌单。歌单和队列均最多 1000 首，所有云端资料合计最多约 2 MB（1,990,000 字节，为 D1 行元数据留出空间）。
- 导入：首次登录保留登录前的游客资料，只有点击“导入登录前的本地资料”并确认才上传。退出后恢复游客资料。
- 设备：查看会话、撤销其他会话；服务器每次验证会话，不依赖长期客户端 JWT。
- 数据：导出 JSON、确认文字注销账号。注销要求 5 分钟内的重新登录，会删除账号、云端资料、关联登录和会话。供应商投递记录、Cloudflare 恢复备份的保留策略需要运营者另行公布；这里不宣称完成所有地区的法律合规。

游客额度存储在 `cp_guest_trial_v1`，是产品级体验限制；清除浏览器数据或更换浏览器会重置。它不是防滥用、计费或 DRM 系统，音乐接口没有因这项功能增加付费鉴权。若要严格按人限额，需要强制身份验证及服务端计量，不能依赖匿名浏览器实现。

账号、会话和音乐资料保存在服务器 SQLite/D1 中。密码由 Better Auth 使用独立随机盐与 scrypt 哈希，服务器不保存明文密码；浏览器不把密码写入 localStorage，Web 会话使用 HttpOnly Cookie。注册每 IP 每分钟最多 5 次、用户名登录每分钟最多 10 次。内部不可投递邮箱仅用于库的数据模型，由服务器生成，不要求用户填写，也不显示为用户邮箱。

当前没有绑定密码找回渠道，请妥善保存密码。现有邮箱/手机/第三方适配器作为后端可选扩展保留，当前页面只显示用户名登录；旧账号数据迁移不会删除资料。认证实现参考官方 [Username](https://better-auth.com/docs/plugins/username)、[Email & Password](https://better-auth.com/docs/authentication/email-password) 与 [Security](https://better-auth.com/docs/reference/security)。

## 本地验证（无第三方服务也能跑通）

正常开发和测试使用 `.node-version` 的 Node 26.12.0：

```sh
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:8787`，点击“注册账号”，填写用户名、密码和确认密码即可。退出后使用同一用户名和密码登录；重启 Node 服务不会丢失账号。选择“游客试用”则恢复游客资料，不载入上一个账号的云端数据。

本地 loopback 服务自动在 `.local/accounts/` 创建数据库和随机 secret，文件已被 Git 和构建产物排除；账号保存在 `.local/accounts/accounts.sqlite`，不要删除此目录来更新版本。`ACCOUNTS_SQLITE` 可指定持久数据盘路径。Node 自动按顺序应用 `0001_accounts.sql`、`0002_username.sql` 并记录迁移，第二个迁移只给旧用户表增加用户名及唯一索引。后续升级应新增迁移，不要重写已应用文件；`npm run accounts:migration` 生成增量迁移。

Node 生产部署设置 HTTPS `AUTH_URL` 和稳定的 `AUTH_SECRET`，使用持久数据盘并备份数据库。默认用连接地址限流，忽略客户端提交的 IP 头；只有服务器完全位于可信反向代理后，且代理覆盖 `CF-Connecting-IP` 为真实访客地址时，才设置 `AUTH_TRUST_PROXY=1`。Cloudflare Worker 直接使用平台提供的访客 IP。`ACCOUNTS_DEV=1` 仅供旧邮箱适配器联调，验证码写入本机 `.local/accounts/last-email.json`，**生产绝不能启用**。用户名注册不依赖此开关。

修改端口时同时设置 `PORT` 与 `AUTH_URL`，例如：

```sh
PORT=8796 AUTH_URL=http://127.0.0.1:8796 node server.js
```

真实服务的本地环境从 `.env.example` 复制到 `.env`，然后使用 `node --env-file=.env server.js`。`.env` 不会被 `server.js` 隐式读取。不要在聊天、截图、Git 或前端代码里填写服务密钥。

## 线上配置

用户名注册只需要下表“核心”一行。其他渠道是可选后端扩展，不配置也能注册登录；如需恢复其前端入口，需额外接入相应交互并验收真实回调。

| 功能 | 推荐服务 | 服务端变量 |
|---|---|---|
| 核心 | Better Auth + Cloudflare D1 | `AUTH_URL`、`AUTH_SECRET`、`ACCOUNTS_DB` 绑定 |
| 邮箱验证码 | Resend | `RESEND_API_KEY`、`AUTH_EMAIL_FROM` |
| 手机验证码 | Twilio Verify | `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_VERIFY_SERVICE_SID` |
| GitHub | GitHub OAuth App | `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` |
| Google | Google Cloud OAuth Web client | `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` |
| 微信 | 微信开放平台网站应用 | `WECHAT_APP_ID`、`WECHAT_APP_SECRET` |

### 1. 数据库与 Worker

现有部署用 `cf`，不要再加入第二份 Wrangler 配置。正式账号库为 `cplayer5-accounts`（APAC），已应用两个迁移。重新部署本站复用此库；以下创建步骤仅供部署到新账号或独立环境时使用：

```sh
npx cf auth login
npx cf d1 create --name cplayer5-accounts --primary-location-hint apac --dry-run
npx cf d1 create --name cplayer5-accounts --primary-location-hint apac
export CPLAYER_ACCOUNTS_D1_ID='上一步返回的数据库 UUID'
npx cf d1 migrations apply "$CPLAYER_ACCOUNTS_D1_ID" --dir migrations --dry-run
npx cf d1 migrations apply "$CPLAYER_ACCOUNTS_D1_ID" --dir migrations
```

`cloudflare.config.ts` 默认保留本站的正式 D1 ID（公开资源标识，不是密钥），避免重新部署时漏绑数据库；也将该 ID 保存为 GitHub 仓库变量 `CPLAYER_ACCOUNTS_D1_ID`。独立环境可在构建时用同名变量覆盖，必须指向自己的数据库。`AUTH_URL` 默认绑定 `https://music.505zc.tech`。如果更换域名，需同时修改该值和所有 OAuth 回调；备用 workers.dev 域名可继续浏览音乐，但账号请求要求使用正式域名。v1.6.0 标签中的旧配置仍需显式传入该变量，main 分支已保留默认绑定。

在本机受限权限文件 `.local/account-secrets.json` 填写 `AUTH_SECRET`，使用 `openssl rand -base64 48` 生成并保持稳定；它用于会话签名与 OAuth 令牌加密。不要每次部署更换它。文件格式为名称到字符串的 JSON 对象，使用 `chmod 600 .local/account-secrets.json`。无需填写邮件或短信供应商密钥即可启用用户名注册。

```sh
npm run cf:build
npx cf deploy --prebuilt --mode production --secrets-file .local/account-secrets.json --dry-run
npx cf deploy --prebuilt --mode production --secrets-file .local/account-secrets.json
```

用户名登录只需数据库、正式地址和稳定的会话密钥，无需收费邮件或短信供应商。缺少库、正式地址或长度至少 32 字符的 secret 时，`/api/account/config` 返回 `enabled:false`，其余账号接口返回 503。独立预览环境应使用测试 D1，`AUTH_URL` 和 OAuth 回调需与预览域名完全一致。

### 2. 邮箱

在 Resend 验证自己的发件域名，按其控制台配置 DNS（SPF/DKIM 等），创建仅用于发信的 API key，配置发件地址。未完成域名验证时通常只能向供应商允许的测试收件人发送，不能当作已上线。

验证码 6 位、5 分钟有效、最多 5 次尝试；库对发送接口限流。上线还应按流量配置 Cloudflare 的发送接口速率规则及供应商发送预算，避免短信/邮件滥用费用。官方：[Email OTP](https://better-auth.com/docs/plugins/email-otp)、[Resend 发信 API](https://resend.com/docs/api-reference/emails/send-email)。

### 3. 手机

在 Twilio 创建 Verify Service 并启用 SMS，配置允许发送的国家/地区、预算和欺诈防护。接口使用 E.164 号码，例如 `+8613800000000`。代码把发送和验证码检查交给 Verify 服务；不使用本地 OTP 结果覆盖供应商的拒绝。

中国大陆和其他地区的短信投递资格、模板、号码范围与供应商账号权限有关；开通前需实际验证目标地区，不能仅凭按钮可点判断可投递。也可将 `sites/account-auth.js` 的发送/验证适配器换成具备目标地区资质的供应商。官方：[Phone Number 插件](https://better-auth.com/docs/plugins/phone-number)、[Twilio Verification Check](https://www.twilio.com/docs/verify/api/verification-check)。

### 4. GitHub、Google、微信

| 渠道 | 注册类型 | 正式回调 URL |
|---|---|---|
| GitHub | Developer settings → OAuth Apps | `https://music.505zc.tech/api/auth/callback/github` |
| Google | Google Cloud → OAuth consent screen + Web application client | `https://music.505zc.tech/api/auth/callback/google` |
| 微信 | 微信开放平台已审核的网站应用（扫码登录） | `https://music.505zc.tech/api/auth/callback/wechat` |

GitHub 的应用主页设为正式站点。Google 配置同源 JavaScript origin 和完整回调，先添加测试用户，完成同意屏幕、隐私政策和正式发布要求。微信设置授权回调域 `music.505zc.tech`，需要网站应用资质与审核；本实现是网站扫码登录，不是公众号内嵌网页授权或微信原生 SDK。微信没有已验证邮箱，因此使用不可投递的内部地址且禁止自动合并账号；前端不显示此内部地址。

OAuth state、回调验证和会话由 Better Auth 管理；微信仅适配非标准 token/userinfo 响应，固定官方 HTTPS 端点。实际第三方回调需要开通应用后逐个端到端验证，目前已验证本地 mock 适配与未配置状态。官方：[社会化登录](https://better-auth.com/docs/concepts/oauth)、[通用 OAuth](https://better-auth.com/docs/plugins/generic-oauth)、[微信网站应用登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)。

## 同步规则与存储

服务端 `cplayer_sync` 每个用户一个文档，更新通过 SQLite/D1 原子条件写入检查 revision。客户端使用三方合并（上次云端版本 / 本机版本 / 新云端版本）：不同收藏、歌单、设置或设备进度可以自动合并；同一项同时变化时显示“保留本机 / 使用云端”。同一歌单内部的并行修改按整个歌单处理，不做歌曲排序的隐式合并。

删除使用持久 tombstone，防止离线设备恢复已删除数据。离线 journal 按用户 ID 分区，失败和 409 不会丢弃未确认修改；账号切换用 generation 标记丢弃过期网络响应。两个标签页在切换账号时会重新加载，避免继续写入旧账号。

同步字段由 `js/account-data.js` 白名单限定，不同步接口 key、音频 URL、下载缓存、鉴权 cookie、第三方 access token、推荐缓存或本地图片。设置的不同 key 可分别合并。主题立即生效，音源和歌词设置下次打开播放器生效。云端队列更新不会停止正在播放的歌曲；登录或退出账号会停止旧账号播放，避免把进度记入新账号。

收藏、歌单和队列保留公开音乐元数据与音源 ID，跨设备仍需要对应音源可用。离线 shell 不等于离线音乐下载。

## Electron 与 PWA

```sh
npm run desktop:dev
npm run desktop:package
```

默认打开正式站点。本机联调：

```sh
CPLAYER_DESKTOP_DEV=1 CPLAYER_DESKTOP_URL=http://127.0.0.1:8787 npm run desktop:dev
```

桌面登录调用 Better Auth 的 Device Authorization：显示用户验证码、打开系统浏览器、用户登录后明确确认授权、桌面轮询完成。令牌仅由主进程保管，使用 Electron `safeStorage` 加密后持久化；系统安全存储不可用时只留内存。预加载桥只暴露登录/退出/完成通知。禁用 Node renderer，启用 sandbox/contextIsolation；Bearer 仅注入同源账号/同步 API，不发往音源、外部网页或通用 get-session 接口。官方：[Device Authorization](https://better-auth.com/docs/plugins/device-authorization)、[Electron 安全](https://www.electronjs.org/docs/latest/tutorial/security)。

`desktop:package` 独立使用固定 Node 22.23.4，因为当前 packager 的 ZIP 解包依赖在项目 Node 26 上会出现未完成 Promise；播放器开发仍使用 Node 26。产物在 `desktop/dist/`。本次在 macOS arm64 验证 `.app` 打包；Windows/Linux 应在对应系统构建并测试。发布给公众前还需开发者证书签名、公证/安装器和自动更新服务；这些不包含在当前无证书配置中。

PWA 延续现有 manifest、离线 shell 和 Media Session 媒体键，新增设置页安装入口和手机/平板适配。Chrome/Edge 支持时弹安装提示；iOS 显示 Safari 添加到主屏幕说明。API 一律绕过 Service Worker 缓存，私有资料不进入公共 Cache Storage。访问一次、等待 shell 缓存完成后，断网可打开播放器界面和本地资料；实时搜索、登录、同步及在线播放仍需网络。

## 验证

```sh
npm test
npm run cf:check
npm run test:worker
npm run check:build
npm run smoke:server
```

`tests/accounts.test.js` 覆盖用户名注册/登录、密码哈希、错误与重复注册、旧库无损迁移，以及真实随机 OTP 登录与重放、来源校验、跨用户隔离、CAS 冲突、删除级联、会话撤销、设备授权、Twilio/微信适配、离线 journal、游客额度和桌面令牌边界。`tests/cloudflare-runtime.js` 直接加载真实部署 bundle，在 workerd + D1 中验证无邮件配置的用户名注册/登录、OTP、同步和注销。第三方真实投递、正式 OAuth 应用和各桌面平台安装体验需配置后验收。

2026-11-10 自动化验证：104 项 Python、390 项 JavaScript、11 项 workerd 测试通过；Cloudflare 部署 dry-run 通过。浏览器验收覆盖用户名注册、密码确认、错误密码、重复注册、刷新后重新选择登录方式、服务器重启后恢复原账号和收藏、两份独立浏览器存储间收藏同步、游客隔离及用户名登录后的设备授权。375px 小屏可滚动完整表单，390px 手机和 820px 平板无横向溢出。此前还验证了离线修改后重连、命名歌单保存、JSON 导出、第 51 首拦截和 PWA 离线界面。Electron 启动确认预加载桥可用、renderer 中 `require` 不可用，并生成 macOS arm64 应用；未签名、公证或发布安装包。
