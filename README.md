<p align="center">
  <img src="img/icon.svg" alt="CPlayer 5 Logo" width="120" height="120">
</p>

<h1 align="center">CPlayer 5</h1>

<p align="center">
  <b>一款现代化的 Web 音乐播放器，支持超清母带音质、实时歌词、离线歌单导入与沉浸式动态背景。</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA">
</p>

<p align="center">
  <a href="https://music.505zc.tech">在线演示</a> ·
  <a href="https://cp.chksz.top/playlist-downloader">歌单下载工具</a> ·
  <a href="https://github.com/ChKSz/CPlayer">GitHub 仓库</a>
</p>

---

## 简介

项目文档：[项目梳理、重点与优势](docs/PROJECT_OVERVIEW.md) · [分阶段优化方案](docs/OPTIMIZATION_PLAN.md)

ZPlayer 5 是一个基于浏览器原生能力的单页音乐播放器，支持播放控制、歌词同步、音频可视化、PWA 离线缓存、移动端手势交互与本地歌单导入。在线内容通过同源服务端接口访问，不能仅靠静态文件服务运行。

当前版本除了基础播放体验，还加入了更完整的歌单加载链路：支持远程歌单 ID 拉取、`playlist.js` 本地离线歌单、JSON 文件导入、拖拽导入，以及 IndexedDB 歌单缓存与静默更新。

## 最新功能

- 设置提供 **20 种歌词效果**：覆盖 Folia 全部 17 种内置模式的视觉适配，保留普通、AMLL、跃音；包含心象、倾诉、群唱、町景、花火、时计等独立排版与场景，详见 [完整清单与适配说明](docs/lyric-effects.md)。
- 支持每首歌随机换一种、手动换一种、动态预览、12–60 px 字号和恢复默认；桌面与手机同步应用，偏好保存在当前浏览器。效果使用 LRC 按句同步，并尊重系统的减少动态效果设置。
- 移除 ORS 音源，新增 Bilibili 公开音乐视频热榜、分类、关键词搜索和 BV/完整视频链接点播，可与网易云内容共用队列
- Bilibili 使用公开 AAC 音轨，显示真实码率并提供原视频链接；允许下载的视频可保存为 M4A。可匿名读取的视频字幕自动作为同步歌词显示，优先中文，并标明自动生成字幕。需要登录、没有字幕或下载受限时会明确提示。本版不提供登录收藏夹，具体边界和参考研究见 [接入说明](docs/bilibili-preview.md)
- 支持通过歌单 ID 直接加载远程歌单，并自动写入本地缓存
- 支持导入 `playlist.js` 或 `.json` 歌单文件，适合离线或自定义场景
- 新增 `playlist-downloader.html`，可一键导出兼容 `playlist.js`
- 支持 IndexedDB 缓存歌单、歌词与封面，提升重复访问速度
- 搜索结果、新歌速递和桌面播放器均可下载单曲，提供标准、极高、无损、Hi-Res、超清母带五档音质；所选音质不可用时会自动降级。浏览器必须允许跨域读取音频文件，下载才能完成。
- 支持 Service Worker 缓存核心静态资源，具备基础 PWA 离线能力
- 支持移动端底部抽屉、拖拽关闭、左右滑动切换歌词/封面
- 支持 Media Session 与 Wake Lock，改善锁屏控制和移动端连续播放体验
- 支持动态渐变背景与 WebGL 流体背景，增强沉浸式视觉效果
- 恢复可拖动的像素小猫桌宠，以及位于页面右侧、可拖动或用键盘控制上下滚动的蜘蛛挂件

## 在线体验

- 在线演示：`https://music.505zc.tech`
- 歌单下载工具：`https://cp.chksz.top/playlist-downloader`
- 仓库地址：`https://github.com/ChKSz/CPlayer`

## 功能特性

### 播放与队列

- 播放 / 暂停 / 上一首 / 下一首
- 进度条拖拽跳转
- 音量调节与静音控制
- 顺序播放、随机播放、单曲循环
- 下一首预加载，减少切歌等待

### 音质支持

| level | 名称 | 说明 |
| --- | --- | --- |
| `standard` | 标准音质 | 128kbps MP3 |
| `exhigh` | 极高音质 | 320kbps MP3 |
| `lossless` | 无损音质 | FLAC |
| `hires` | Hi-Res | 高解析度 FLAC |
| `jyeffect` | 高清环绕声 | 空间音频效果 |
| `sky` | 沉浸环绕声 | Dolby Atmos 效果 |
| `jymaster` | 超清母带 | 默认优先音质 |

### 歌词体验

- LRC 实时同步显示
- 支持翻译歌词（TLRC）
- 兼容 YRC 扩展歌词链路
- 桌面端与移动端分别优化歌词滚动与遮罩表现
- 当前行高亮、缩放与透明度渐变

### 歌单与搜索

- 支持歌曲名 / 歌手名搜索
- 支持直接输入歌曲 ID 解析
- 支持歌单 ID 拉取播放列表
- 支持拖拽导入 `playlist.js` / `.json`
- 支持本地离线歌单优先启动
- 大列表虚拟化渲染，长歌单依然流畅

### 离线与缓存

- Service Worker 缓存核心资源
- IndexedDB 缓存歌单、歌词、封面缩略图
- 已缓存歌单支持优先读取，再后台静默刷新
- 可配合本地 `playlist.js` 实现离线歌单使用

### 视觉与交互

- 磨砂玻璃风格播放器界面
- 专辑封面主色提取与动态主题联动
- 动态渐变背景模式
- WebGL 流体背景渲染
- 全屏沉浸播放模式
- 移动端左右滑动切换内容、底部抽屉操作
- 像素小猫已拆为[独立桌宠模块](docs/desktop-pet.md)，恢复普通页面显示；设置可独立开关、选择行为与找回小猫，支持拖动、双击睡觉和减少动态效果；右侧蜘蛛同步显示并控制页面滚动进度
- 蜘蛛挂件已拆为[可独立使用的模块](docs/scroll-spider.md)：默认使用动漫蜘蛛少女 SVG，可从挂件旁或播放器设置中上传图片替换、恢复默认，形象保存在当前浏览器

### 系统集成

- Media Session API 系统媒体控制
- Android 锁屏控制
- Wake Lock 防止播放中息屏影响体验
- PWA 安装支持

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 核心 | HTML5 + CSS3 + Vanilla JavaScript (ES6+) |
| 样式 | Tailwind CSS Runtime、CSS Variables、Backdrop Filter |
| 音频 | HTMLAudioElement、Web Audio API |
| 图形 | Canvas API、WebGL |
| 存储 | IndexedDB、LocalStorage、Cache Storage |
| PWA | Service Worker、Web App Manifest |
| 图标 | Lucide |
| 字体 | Noto Sans SC |
| 工具库 | Color Thief |

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/ChKSz/CPlayer.git
cd CPlayer
```

### 2. 构建与启动服务

本地 Node 服务本身无需第三方依赖（需要支持 `AbortSignal.any` 和原生流）。Cloudflare 构建工具需要先运行 `npm ci`，统一使用 `.node-version` 中的 Node.js 26.12.0。ChKSz 功能需要在服务进程中配置 `CHKSZ_API_KEY`，GD 和 Bilibili 公开内容不需要此密钥。

```bash
npm run build
npm start
```

构建会先清理并重新生成 `dist/static` 与 `dist/server`，随后可运行发布产物检查和同源服务冒烟测试：

```bash
npm run check:build
npm run smoke:server
```

服务默认只监听 `127.0.0.1:8787`。使用 `PORT` 指定其他端口；`CHKSZ_API_KEY` 仅应保存在本地环境变量或部署平台的 Secret 中，不要放进前端文件。

本地也可打开「设置 → ChKSz API 密钥」，粘贴个人 `chksz_` 密钥并点击「保存密钥」。密钥只存于当前 Node 服务内存中，用于请求 ChKSz API；不会写入浏览器存储、项目文件或日志，刷新页面仍有效，重启服务后需重新填写（启动环境中的 `CHKSZ_API_KEY` 会重新读取）。支持替换与清除密钥，保存不会单独发起扣费验证请求，实际有效性以搜索或播放结果为准。此设置在当前服务的本地页面间共享；线上部署仍通过服务端 Secret 配置，不开放网页修改入口。

### 3. 打开浏览器

访问 `http://127.0.0.1:8787/`，或 `http://127.0.0.1:8787/?source=bilibili` 预览 Bilibili 音源。

### 4. 运行项目检查

项目使用 Python 和 Node.js 内置测试，不需要安装 npm 依赖：

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.js
python3 scripts/check_static_site.py
```

CI 还会对构建产物、字体 MIME 类型、页面路由以及缺少音乐服务密钥时的结构化错误响应进行验证。

GitHub Actions 会在每次推送和 Pull Request 时运行相同检查，并探测播放器、歌单下载器、离线页、Service Worker 和 PWA 清单。

### Cloudflare 部署

Cloudflare 站点：[music.505zc.tech](https://music.505zc.tech)，备用入口：[cplayer5.cz162111.workers.dev](https://cplayer5.cz162111.workers.dev)。使用 Workers 同时部署同源音乐 API 和静态资源，保留全部歌词效果和挂件模块。

```bash
npm ci
npm run cf:check
npm run test:worker
npx cf auth login --no-device
npm run cf:deploy
```

在 Worker 的 Settings → Variables and Secrets 中添加 Secret `CHKSZ_API_KEY`。网页设置只显示是否已配置，不开放线上密钥修改。详细配置、联调命令及音源限制见 [Cloudflare 部署说明](docs/cloudflare.md)。

## 项目结构

```text
CPlayer5/
├── index.html               # 主播放器页面与应用启动逻辑
├── playlist-downloader.html # 歌单导出工具页
├── offline.html             # 离线提示页
├── server.js                # 本地服务入口
├── sw.js                    # PWA 离线缓存
├── manifest.json            # PWA 清单
├── css/                     # 页面、播放器、Bilibili 与挂件样式
├── js/                      # 播放、下载、页面交互与挂件逻辑
├── img/                     # 图标、封面预览与像素挂件素材
├── sites/                   # 同源接口与 Sites 运行入口
├── scripts/                 # 构建与静态检查脚本
├── tests/                   # Python 与 Node.js 回归测试
└── docs/                    # 开发说明与功能接入文档
```

## 使用说明

### 远程歌单

在播放器内输入歌单 ID，即可拉取远程歌单并自动缓存。

### 本地离线歌单

将导出的 `playlist.js` 放到项目根目录，播放器启动时会优先读取 `window.LOCAL_PLAYLIST`。

### 自定义 JSON 导入

支持直接导入 JSON 文件，常见格式如下：

```json
[
  {
    "id": 123456,
    "name": "歌曲名称",
    "artists": "歌手名",
    "album": "专辑名",
    "picUrl": "https://example.com/cover.jpg"
  }
]
```

也支持包装格式：

```json
{
  "title": "My Playlist",
  "data": {
    "tracks": []
  }
}
```

## 兼容性

推荐使用最新版 Chrome、Edge、Firefox 或 Safari。项目依赖以下浏览器能力：

- ES6+
- Web Audio API
- IndexedDB
- Canvas / WebGL
- Service Worker
- Media Session API（部分平台）

## 无障碍与离线行为

- 支持浏览器页面缩放、键盘操作和对话框焦点恢复
- 图标按钮、表单输入、Toast 和错误信息提供屏幕阅读器语义
- 尊重系统的“减少动态效果”设置，并在页面进入后台时暂停连续 Canvas/WebGL 渲染
- Service Worker 缓存播放器外壳和最多 100 个封面请求，不缓存 API 与音频流
- 离线时可打开缓存页面和离线说明；搜索、歌单刷新和音乐播放仍需要网络

## 版权与合规声明

- 本项目仅提供播放器前端界面、歌单管理、歌词展示与浏览器侧缓存能力，不内置受版权保护的音频内容
- 项目本身不声明拥有任何第三方音乐、歌词、封面、商标或平台资源的权利，相关权利归其各自权利人所有
- 我们无意侵犯任何组织或个人的知识产权；如相关资源的权利人认为仓库内容存在问题，请通过仓库 Issues 或其他公开联系方式告知，我们会及时处理
- 使用者应自行确保其获取、调用、分享或播放的内容来源合法合规，并遵守所在地法律法规及相关平台协议
- 严禁将本项目用于传播盗版、绕过授权、批量抓取、非法牟利或任何违法违规用途

## 许可证

本项目采用 [MIT License](LICENSE) 开源发布，版权归 ChKSz 所有；使用、分发和二次开发时请保留原始许可证与版权声明。

## 致谢

- [Color Thief](https://lokeshdhakar.com/projects/color-thief/) - 专辑封面主色提取
- [Lucide](https://lucide.dev/) - 界面图标
- [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) - 开源中文字体
- [oneko.js](https://github.com/adryd325/oneko.js) - MIT 许可的像素猫精灵与追逐逻辑
- [LINUX DO社区](https://linux.do) - 佬友们的支持

### 音乐平台与渠道切换

在发现页、搜索页或设置中先选择音乐平台，再选择该平台的渠道；渠道较多时可横向滑动。当前选择会保存在浏览器，所有入口保持同步，键盘支持方向键和 Home / End；搜索页切换时保留关键词并自动重搜。ChKSz 继续使用设置中的个人密钥；GD 音乐台保持默认，无需密钥，支持网易云搜索、播放、歌词和封面。现有 Bilibili 音源也可继续选择。

发现页采用紧凑歌曲表格，支持时长、结果内筛选、排序、收藏、批量加入队列和加载更多。桌面播放器提供歌词、收藏和队列数量；手机浏览面板内提供迷你播放条。快捷键为 `空格` 播放/暂停、`←` / `→` 快进或后退 5 秒、`/` 打开搜索；编辑输入框时不拦截快捷键。验收记录与元数据说明见 [发现页优化说明](docs/discovery-redesign.md)。

新增网易云 Meting / 51ape / 煎饼、QQ 的 51ape / VKeys / 煎饼、酷狗煎饼、酷我煎饼 / 歌曲客，共 9 个渠道。新增渠道首页与播放独立于 ChKSz 额度，歌曲保留自己的渠道，音频通过本站 HTTPS 播放。详见 [渠道与接口说明](docs/music-channels.md)。

GD 与 ChKSz 共用网易云歌曲 ID。在这两个接口之间切换后，下一次加载网易云歌曲或切换音质使用所选接口；正在播放的音频不打断。GD 首页使用独立搜索和按需加载的主题入口，启动时不请求 ChKSz。实时榜单、歌手聚合、新歌、新碟和歌单详情是 ChKSz 的可选功能；GD 模式下榜单和歌手页只显示已保存内容或搜索入口，已保存歌单只从本地缓存恢复。ChKSz 额度耗尽时可从错误提示一键切换 GD，不影响界面和基础播放。搜索使用所选接口，歌词跟随歌曲实际使用的播放接口；Bilibili 视频发现保留原有来源。保存 ChKSz 密钥不会改变当前播放接口。

GD 请求经同源后端转发，固定访问 music-api.gdstudio.xyz，不携带 ChKSz 密钥。搜索每次显示 10 条，服务端串行请求并缓存成功结果；每个服务进程限制最多 50 次 / 5 分钟，429 遵守 Retry-After，不自动重试。分布式部署仍需遵守 GD 的总体限额。GD 音频地址为空时最多降档到 320K、128K；鉴权、限流等错误立即停止。GD 返回的实际音质决定播放器标识，最高对应 Hi-Res，不标为母带。

来源：[GD音乐台](https://music.gdstudio.xyz)，[接口说明](https://music-api.ucds.me/api)。仅供非商业学习使用，GD 模式仅提供在线播放。
