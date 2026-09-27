# Bilibili Preview

## Scope

This preview replaces the retired ORS provider with anonymous Bilibili music discovery,
keyword search, direct BV/video-link lookup, and audio playback in the existing queue.
NetEase playback remains available through the server-side `CHKSZ_API_KEY` environment
variable. No key or Bilibili login cookie is stored in the repository.

## Reference Research

Research date: 2026-09-08. Local constraints: vanilla JavaScript, a Web-standard Worker,
a Node development server, and the existing playback cancellation model.

| Reference | Stars / Forks | Runtime / License | Activity / Preview | Adaptation |
| --- | --- | --- | --- | --- |
| [WEP-56/BiliTune](https://github.com/WEP-56/BiliTune) | 28 / 2 | Dart / Flutter; no declared license | Commit `dc4c424`, 2026-07-03; [static UI preview](https://wep-56.github.io/BiliTune/) returned HTTP 200 | Study its BV-to-CID-to-audio flow, category browsing and request caching. No source code or artwork copied. |

The investigation covered its README, UI screenshots, API service, music repository,
network layer and issues. [The API service](https://github.com/WEP-56/BiliTune/blob/dc4c424/lib/data/services/bili_api_service.dart)
shows the video metadata and playback steps. [The music repository](https://github.com/WEP-56/BiliTune/blob/dc4c424/lib/data/repositories/bili_music_repository.dart)
provides the category and public audio-track model. Its only open issue at review time
concerned downloadable lyrics/artwork, not a playback fix.

The native client's authenticated favorites, writes, external lyric matching,
and UI implementation are not transplanted into this browser preview.
Its WBI-signed API implementation is also not copied; this preview uses the corresponding
unsigned public web endpoints verified below. Anonymous availability is not guaranteed.

## API Boundaries

- `GET /api/v1/music/discover?source=bilibili&category=all`: music ranking (`rid=1003`).
- Other categories: `original`, `cover`, `live`, `instrumental`, backed by music searches.
- `GET /api/v1/music/search?source=bilibili&keyword=...`: keyword, BV identifier or full `bilibili.com/video/BV.../?p=N` link.
- `GET /api/v1/music/song?source=bilibili&id=bili:BV...:N`: video metadata, part validation and public AAC stream resolution.
- `GET/HEAD /api/v1/bilibili/audio?id=bili:BV...:N`: same-origin audio stream with Range support.
- `GET/HEAD /api/v1/bilibili/download?id=bili:BV...:N`: the same stream as an M4A attachment, only when `rights.download` explicitly allows downloads.
- `GET /api/v1/music/lyric?source=bilibili&id=bili:BV...:N`: anonymously available video subtitles converted to LRC.

The upstreams are `api.bilibili.com/x/web-interface/ranking/v2`,
`/x/web-interface/search/type`, `/x/web-interface/view` and `/x/player/playurl`.
These are public web-client endpoints, not an official Open Platform authorization.
Public anonymous behavior was verified with real requests; it may change or be rate limited.

Only publicly returned AAC tracks are selected. Paid, preview-only or no-background
content is rejected. Missing audio is not replaced with another song. The original video
link remains available. This version does not provide account login, private favorites,
external lyric matching or `b23.tv` short-link resolution.

Download permission is checked server-side, independently from playback permission.
The browser saves the actual AAC track in an M4A container, without pretending to convert
it to lossless audio. Closing the Bilibili download dialog cancels the pending fetch.

Subtitle retrieval follows the BV/CID -> `/x/player/v2` -> `subtitle.subtitles[]` workflow
also used in [BiliTune's subtitle reader](https://github.com/WEP-56/BiliTune/blob/dc4c424/lib/data/repositories/bili_music_repository.dart).
It prefers human Chinese, then Chinese automatic subtitles, then other available languages.
The UI labels the language and automatic generation; subtitles are not asserted to be song lyrics.
The `need_login_subtitle` response is honored without trying other endpoints to bypass it.
No subtitle URL supplied by the browser is fetched. Files must come from a validated
HTTPS `hdslb.com/bfs/subtitle/*.json` URL supplied by the API. Redirects are disabled,
files are limited to 2 MiB and 10,000 cues, and parsed text is cached in a bounded cache.
Invalid, missing, restricted and login-required subtitles have distinct responses.

The relay does not accept arbitrary remote URLs. It resolves an ID server-side and only
uses standard-port HTTPS `bilivideo.com`/`bilivideo.cn` URLs returned by the provider,
including validated backups. Redirects, arbitrary hosts and forwarded user credentials
are disallowed. Browser disconnects cancel the streamed body.

## Reliability

API requests are spaced at least 350 ms apart per Worker instance. Shared requests are
coalesced, caches are bounded to 80 entries, and provider rate limiting causes a 30-second
backoff instead of immediate retries. There is no IP rotation, login bypass or anti-bot
challenge handling. This per-instance limit is not a deployment-wide rate limiter.

The discovery view retains a last-successful snapshot for up to 24 hours and identifies
its update time when a live refresh fails. A new browser with no snapshot may show a
rate-limit error; direct video lookup remains a separate operation.

## Verification

Run `npm test`, `npm run build` and `npm start`. Browser validation should cover both
sources, BV/full-link search, playback progress and seeking, rapid selection, original-video
links, desktop/mobile layouts, real cover loading and provider failure states.

Regression tests cover ID/URL validation, category routing, unsigned guest resolution,
paid/preview rejection, safe backup selection, credentials isolation, Range/HEAD responses,
request caching/backoff, streaming cancellation and the retired provider's rejection.

Real request checks observed music rankings/search returning success and AAC audio ranges
returning HTTP 206. Anonymous ranking access also returned a rate-limit response during
testing; it must not be presented as unconditionally available in a deployment.

Subtitle checks on 2026-09-08 tested `BV1C9b76cEks`, `BV1Jt411P77c`, and `BV1MU411S7iJ`
without cookies. All returned zero subtitle tracks; `BV1Jt411P77c` explicitly returned
`need_login_subtitle=true`. These samples all exposed `rights.download=1`.
Public subtitle success is covered with controlled response fixtures, not falsely reported
as a live anonymous success. Tests also cover denied downloads, safe attachment headers,
malformed/oversized subtitles, request cancellation and stale playback sessions.

Browser download verification saved an actual 5,896,341-byte M4A file from `BV1C9b76cEks`.
`ffprobe` identified AAC, 48 kHz stereo, and a 198.549333-second duration. Desktop/mobile
controlled subtitle fixtures verified timed highlighting, language/automatic attribution,
download cancellation/reopening and explicit permission-denied feedback. The test fixture
browser disables Service Workers so mocks do not get bypassed by the offline cache;
production code contains no fixture subtitles or alternate credentials.
