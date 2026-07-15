# CPlayer5 Desktop App Shell Design

## Goal

Reorganize the existing web player into a content-first desktop music application shell inspired by SPlayer and HE-Music while preserving CPlayer5's MIT license, Vanilla JavaScript architecture, playback engine, mobile UI, lyrics, caching, PWA behavior, and dark immersive identity.

## Confirmed Product Decisions

- Keep the current MIT + Vanilla JavaScript + no-build architecture.
- Treat SPlayer as an information-architecture and interaction reference only; do not copy AGPL source code, branding, icons, or assets.
- Deliver the smallest useful desktop-first iteration before adding discovery, ranking, artist, video, radio, login, or multi-platform features.
- Use the new desktop shell at widths of `1024px` and above.
- Keep the existing mobile/tablet experience below `1024px`.
- Use a content-first default screen.
- Show only real, currently working capabilities in navigation.
- Use a layered visual system: a calm light browsing shell plus the existing dark purple dynamic immersive player.
- Open the preserved full-screen player when the user activates the mini-player cover or song information.

## Scope

### Included

- A desktop application root containing a sidebar, top bar, library content area, mini-player, preserved immersive player, and existing queue/search drawer.
- Sidebar entries for Music Library, Now Playing, Play Queue, Local Import, Playlist Tool, and Settings.
- A real Music Library landing screen with search, current playlist summary, and working shortcuts to existing capabilities.
- A fixed `1024px` desktop-shell breakpoint shared by CSS and JavaScript.
- A mini-player that controls the existing single audio engine through an injected adapter.
- An accessible immersive-player open/close flow with Escape support and focus restoration.
- Scoped light-shell design tokens and a dark bottom player.
- WebGL/continuous visual rendering paused while the light browsing surface is active on desktop.
- PWA precaching for the new shell CSS and JavaScript.
- Automated markup, state, adapter, static-site, and service-worker tests.

### Excluded

- Vue, React, TypeScript, Pinia, Vue Router, or a build tool.
- New music APIs, platform switching, rankings, artists, video, radio, login, comments, or social features.
- A second `Audio` instance, duplicate playlist state, duplicate search implementation, or a new store/event bus.
- Redesigning the existing mobile DOM.
- Replacing the existing virtual playlist renderer.
- Copying SPlayer or HE-Music implementation code or protected visual assets.

## Architecture

### Desktop Application Surfaces

At `min-width: 1024px`, `#desktopApp` becomes the only desktop application root:

```text
#desktopApp
├── #desktopShell
│   ├── aside.app-sidebar          240px
│   ├── .app-topbar                70px
│   ├── main#desktopLibraryView    primary scrolling region
│   └── footer#desktopPlayerBar    80px minimum
├── section#desktopLayout          preserved immersive player surface
├── aside#floatingPlaylistPanel    preserved queue/search drawer
└── #floatingSearchPanel           hidden compatibility node
```

The existing `#desktopLayout` is no longer the default desktop page. It remains the only immersive player implementation and retains the current cover, lyrics, visualizer, metadata, progress, playback controls, and their existing IDs.

The immersive layer closes with `opacity`, `visibility`, `pointer-events`, and `inert`; it is not removed from layout with `display:none`, so the lyric scroller keeps measurable dimensions and can remain centered.

Below `1024px`, `#desktopApp` is hidden and the existing `#mobileLayout` remains active without a DOM rewrite.

### Single Playback Kernel

`js/app-shell.js` must not create an `Audio` object, fetch music data, own playlist state, inspect internal globals, poll DOM state, or use `MutationObserver` to guess playback state.

The existing unique desktop metadata, progress, mode, previous, play/pause, next, and volume controls move into `#desktopPlayerBar` without changing their IDs. The bottom player therefore remains the real controller for the existing single `audio` instance; no duplicate playback adapter or synchronization loop is required.

Only the cover is duplicated for presentation as `#desktopMiniCover`. `index.html` updates it explicitly wherever it already restores or assigns `#albumArt`.

The shell module receives only presentation callbacks for existing actions such as opening the queue/search drawer, focusing local import, and opening settings.

### Shell State

The shell owns only presentation state:

```js
{
  activeView: 'library',
  immersiveOpen: false,
  drawerOpen: false,
  drawerTab: 'playlist'
}
```

Allowed view/history transitions are finite and local. No URL router or application store is introduced.

## Information Architecture

### Sidebar

- **音乐库** — focuses the default library screen.
- **正在播放** — opens the preserved immersive player.
- **播放队列** — opens the existing playlist drawer on the playlist tab.
- **本地导入** — focuses the existing real file-import control in the library.
- **歌单工具** — links to `playlist-downloader.html`.
- **设置** — opens the existing settings modal.

No disabled or placeholder discovery/ranking/artist entries are shown.

### Top Bar

- Back and forward buttons operate on the finite shell history.
- The existing desktop search input is surfaced in the library content area rather than duplicated.
- Settings and browser fullscreen actions retain their existing IDs and behavior.

### Music Library

The default desktop screen contains:

- a page title and concise description;
- the existing `searchInput`, `searchButton`, and `searchResults` implementation;
- a current-playlist summary using the existing `playlistCount`;
- working shortcuts for queue, local import, and playlist tools;
- a helpful empty state when no playlist is loaded.

The first iteration does not create a second playlist renderer or fake album/playlist data.

### Mini-Player

The dark bottom player contains:

- a new presentation-only cover image;
- current song and artist text from the injected snapshot;
- the existing previous, play/pause, and next controls, moved intact with their original IDs;
- the existing progress structure, moved intact so current click-to-seek behavior and the oneko sleep anchor continue to work;
- elapsed and total time;
- a queue action;
- a metadata button that opens the immersive player.

`#desktopLayout` becomes a cover-and-lyrics immersive surface while the global bottom player remains visible. There is still only one set of desktop playback controls and one `Audio` instance.

## Responsive Behavior

- `0–1023px`: existing mobile/tablet layout and mobile UI manager.
- `1024px+`: new desktop shell with a `240px` sidebar, `70px` top bar, and at least `80px` bottom player.
- Primary desktop QA sizes: `1024×600`, `1366×768`, `1440×900`, and `1920×1080`.
- The content region is the only main vertical scrolling surface.
- The queue drawer occupies the space between the top bar and bottom player.
- The bottom player includes `env(safe-area-inset-bottom)` without using fixed positioning.

All JavaScript layout checks use one exported media query constant: `(min-width: 1024px)`.

## Visual System

`css/app-shell.css` owns scoped `--shell-*` tokens and never modifies global player theme tokens.

- Browsing background: neutral light surface.
- Sidebar/top bar: opaque or near-opaque light surfaces with restrained borders.
- Active navigation: subtle tinted background plus a clear current indicator.
- Bottom player: dark purple surface derived from the existing `#28183B` identity.
- Immersive layer: existing cover-driven/dynamic background and centered lyrics.
- One consistent icon family: the already bundled Font Awesome assets.
- Interaction transitions: `150–250ms`, with complete `prefers-reduced-motion` overrides.

## Existing DOM Contracts

The implementation must preserve every existing ID and prevent duplicates. In particular:

- `#progressBar` remains nested under `.progress-bar-container > .progress-track`.
- `#albumArt` remains inside `#albumArtWrapper` with `#desktopLoaderOverlay`.
- `#lyricsScroller` and the hidden `.lyrics-container` remain present.
- `#playlistContainer` remains scrollable and contains `#playlistContent` and `#playlistLoader`.
- `#playlistFile` remains inside the first `.upload-container`.
- `#floatingPlaylistPanel` continues to use `translate-x-full` as its closed state.
- `#fullscreenBtn` keeps a descendant Font Awesome expand/compress icon.
- Runtime-replaced button contents (`playPauseBtn`, `volumeBtn`, `playModeBtn`) do not contain persistent labels.

A characterization fixture records the existing ID set so future layout edits may add IDs but cannot accidentally remove legacy contracts.

## Accessibility

- Add a skip link to the library main region.
- Use a `nav` landmark and `aria-current="page"` for the active sidebar item.
- All new icon buttons have accessible names and a minimum `44×44px` hit target.
- The mini-player metadata opener uses `aria-controls="desktopLayout"` and `aria-expanded`.
- Opening immersive mode makes the browsing shell inert, focuses the close button, and announces the surface as a dialog-like application view.
- Escape closes immersive mode and restores focus to the opener.
- View changes focus the destination heading without introducing custom tab order.
- The preserved progress track gains slider semantics, keyboard seeking, and updated `aria-valuenow` without changing the ancestor structure required by playback and oneko.
- Hidden layouts and views are not focusable by screen readers.
- Light shell, dark player, focus rings, and secondary text meet WCAG AA contrast.

## Performance

- The new shell adds no dependency or network font.
- The existing virtual playlist remains the only long-list renderer.
- Desktop browsing pauses FluidBackground and other continuous immersive animation; opening the immersive surface resumes it.
- Mini-player progress follows the existing `timeupdate` cadence, not a new animation loop.
- New cover surfaces reserve their dimensions to avoid layout shift.
- Avoid layered full-screen backdrop filters in the light shell.

## PWA And Offline Behavior

- Add `css/app-shell.css` and `js/app-shell.js` to `CORE_ASSETS`.
- Bump the shell cache from `cplayer5-shell-v7` to `cplayer5-shell-v8`.
- Treat v7 as obsolete in cache deletion tests.
- The new shell loads offline with cached playlists and settings.
- Search and uncached playback continue to show the existing network error messages.

## Error Handling

- Shell initialization validates required elements and logs one clear error if the shell cannot initialize.
- A shell initialization failure must not create a second player or corrupt the mobile experience.
- Adapter actions are guarded so missing optional UI elements do not stop core playback initialization.
- Search, playlist import, media URL validation, and playback errors continue through existing logic.
- Browser history buttons expose disabled states when no local history action exists.

## Testing And Verification

### Automated

- Characterize existing DOM IDs and PWA contracts.
- Test the `1024px` breakpoint and mobile preservation.
- Test shell markup, real navigation targets, ARIA semantics, and DOM ancestry contracts.
- Test finite view history and immersive open/close state.
- Test adapter-driven mini-player snapshot and progress calculations without creating Audio.
- Test duplicate-ID and missing shell-target validation in `check_static_site.py`.
- Test PWA precaching and v7 cache retirement.
- Run all existing Python and Node tests.

### Browser

- Verify `1023px ↔ 1024px` transitions do not reload the song or lose queue/progress.
- Verify keyboard-only navigation, search, queue, play/pause, seek, immersive open/close, and Escape.
- Verify empty playlist, cached playlist, search results, file import, settings, fullscreen, queue drawer, and immersive lyrics.
- Verify light browsing mode pauses continuous background animation.
- Verify console output has no new errors.

## Delivery Boundary

This iteration ends when the desktop shell is functional and verified. Discovery, rankings, artists, video, radio, account/login, and true multi-page routing remain future projects.
