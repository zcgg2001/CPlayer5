# SPlayer-Next 多源匹配与播放启动参考

> 本文保留当时的参考分析与验证记录。2026-11-26 的后续选源、ChKSz 优先级及日额度冷却策略已更新，见 [当前自动播放策略](auto-playback.md)。


研究日期：2026-11-17。参考 SPlayer 的后继项目 SPlayer-Next，固定提交 `6b26b685f67cfac9d3233747b399255620f45b87`。本次独立实现 CPlayer 的缓存和额度策略，没有引入或复制上游实现。

## 多源匹配实际上分为两条链路

### 歌词、封面等元数据

1. 独立插件来源保留插件身份和原始候选，直接交给所属插件；同平台使用已有歌曲 ID，跳过搜索。
2. 跨平台以歌名、艺人搜索，再做候选筛选。标准化歌名必须全等或满足子串比例；双方都有时长时，相差超过 20 秒淘汰；已知歌手时必须匹配至少一位。
3. 候选评分：歌名精确 +10、子串 +4；艺人精确 +5、包含 +2；专辑一致 +2；时长相差不超过 5 秒 +3，取最高分。
4. 歌词解析还会按用户格式偏好比较候选。格式标为逐字但没有真实字级时间时，按普通 LRC 处理。以已有歌词为基准复核内容/时间，符合条件才热替换；可以并行请求其他平台，但不会阻塞音频启动。

源码：[插件元数据](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/electron/main/plugins/metadata.ts)、[候选评分](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/electron/main/apis/common/lyric/utils.ts)、[歌词优选](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/src/services/lyric/resolve.ts)、[歌词复核](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/src/services/lyric/verify.ts)。

### 音频播放

独立插件的歌曲优先交给原插件；普通平台来源按可用插件优先级依次尝试。歌词的多平台评分不是把所有音频源同时竞速，也不保证每个来源能播放。官方插件文档仍规定解析超时（musicUrl 20 秒，其他动作 15 秒）。

CPlayer 保留自己的严格录音判定：共享平台 ID、ISRC，或歌名/歌手/版本/专辑/时长等证据满足条件。音频跨源替换继续使用约 3 秒时长限制，不照搬歌词候选 20 秒容差，避免换到现场版、伴奏或翻唱。

来源：[插件音频解析](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/src/services/audioSource.ts)、[官方插件接口](https://splayer-next.imsyy.top/plugins/source.html)。

## “零延迟”依赖提前完成工作

SPlayer-Next 会先找本地/下载/缓存音频，提前解析下一首、获取缓存，使用包含曲目、音质、来源环境的上下文标识防止复用错误资源。切歌时消费预载结果；本地或已缓存音频还可以进入原生备用槽位，提前解码为 PCM，供原生引擎交接。

这消除的是已提前完成的等待。陌生歌曲冷启动仍涉及搜索、鉴权、解析、网络首包、缓冲和解码。网页的 HTMLAudioElement 没有直接等价的原生 PCM 槽位交接，地址缓存不能保证无缝或绝对 0 毫秒。

来源：[预载和结果交接](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/src/services/nextTrackPreloader.ts)、[主进程预载](https://github.com/SPlayer-Dev/SPlayer-Next/blob/6b26b685f67cfac9d3233747b399255620f45b87/electron/main/services/playerPreload.ts)。

## 本次落地范围

- ChKSz 退出自动主力和兜底链路，只有用户明确为该歌曲选择它才播放；下一首预解析和默认探测不使用它，歌词走免费同平台渠道。
- 按源、ID、音质缓存已完成的解析结果；短有效期、过期提前失效、媒体失败清除、并发合并和独立取消。临时 URL 只留在内存中，不新增持久化存储。
- 临近结束时有限预解析下一首，正式切歌复用，不再“预加载后清空，再请求同一地址”。缓存命中仍遵守选源、禁用、冷却和音质要求。
- 只在真正播放成功后记住严格匹配的跨平台对应关系，减少之后重复搜索。歌词仍在音频启动后异步加载。

未把 SPlayer 的歌词评分、并行格式热替换或原生桌面歌词槽位迁入网页。本次优先解决额度与播放启动链路；后续歌词增强可以复用独立候选匹配层，并保留用户手动校正结果。

## 验证记录

- Node 26.12.0：104 项 Python、458 项 JavaScript、16 项 workerd 测试通过；构建、静态检查、服务冒烟和 Cloudflare 部署预检查通过。
- 新增回归覆盖自动链路零 ChKSz、手选来源优先、并发取消、过期/失败淘汰、预解析上限、严格匹配记忆、快速切歌与音质隔离。
- Tabbit 真实 HTMLAudioElement + WAV 受控测试：人为加入 600 毫秒解析延迟，首次启动约 993 毫秒，预解析后约 153 毫秒；下一首高音质解析仅 1 次，切换标准音质独立请求，ChKSz 请求为 0。脚本见 `tests/browser-playback-cache.js`。
- 上述时延是一次本地受控样本，说明缓存复用机制有效，不代表公网源的稳定性排名、十人并发或所有歌曲的启动速度。
- Tabbit 完整页面回归通过：游客入口、手机搜索/导入、加载占位、音质降级、断线恢复进度、自动播放受限后的手动恢复，以及桌面 OP QQ / 手机 OP 网易云选源优先；无页面脚本异常。

## 生产验证

代码提交 `b6c75f3` 已同步 GitHub main；该提交主分支和工作分支 CI 均通过。Worker 版本 `1b63131d-38d7-4b0c-8295-b73b6927679a`，Service Worker v87。线上五个相关脚本与本地文件 SHA-256 一致。

在 `https://music.505zc.tech` 使用独立内存偏好、静音 HTMLAudioElement 播放网易云 ID `259138`，未修改用户队列或账号数据。两轮均由 Meting 返回无损，真实播放时间推进；首次启动分别约 2547 / 1113 毫秒，缓存重播分别约 409 / 448 毫秒。第二轮通过页面 fetch 计数确认：两次播放合计 1 次 `/song` 解析、2 次免费 Meting `/lyric`，ChKSz 请求为 0。浏览器可能已有媒体缓存、服务器也可能命中缓存，因此这些数字只是单曲样本，不是普遍性能保证。
