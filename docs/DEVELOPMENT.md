# CPlayer5 Development Workflow

Use Node.js 26.12.0 (`.node-version`) and `npm ci`. `index.html` owns markup,
`css/player-base.css` owns the extracted base styles, and `js/app.js` owns
application startup and UI orchestration. Keep playback policy in
`playback-router.js` / `playback-controller.js`, not in Android or view code.
See [the full code map](CODE_MAP.md) and [Android build instructions](android.md).

`npm run android:build` builds an installable debug APK and runs Android unit
tests and lint. The Android CI job uses the same Gradle tasks.


## Player experience browser regression

`tests/browser-experience.js` is a program for the Tabbit browser-owned runtime
(which supplies `page`, `expect`, `assert`, and `Buffer`), rather than a Node test
module. It uses controlled API responses and a generated silent WAV to check the
mobile welcome, search/import entry points, independent recommendation loading,
playback buffering, automatic source switching, quality downgrade, recovery with
preserved position, autoplay refusal, manual resume, and desktop/mobile
overflow. It does not query real providers for the scenarios under test.

On macOS with Tabbit installed, start a dedicated test server from the project root:

```bash
npm run build
PORT=8808 npm start
```

In another terminal, run the browser program and release its browser task:

```bash
"$HOME/.local/bin/tabbit-cli" nodejs --task cplayer-experience --request-id experience-check < tests/browser-experience.js
"$HOME/.local/bin/tabbit-cli" finish --task cplayer-experience
```

Use a new request ID when rerunning. Reserve port 8808 for this test: the program
clears that origin's local storage and unregisters its service worker to isolate
the scenarios. These checks do not replace the separate PWA/cache tests. Close
the test tab after reviewing it, and stop the dedicated server when finished.

Use `origin` for this fork. An optional read-only upstream remote can be added for comparison:

- `origin`: `zcgg2001/CPlayer5`, the writable fork.
- `upstream`: `ChKSz/CPlayer`, the original project; configure it only if needed.

## Branches

- `main` is the stable, integrated branch.
- `codex/<name>` is the default working branch for this repository.

Create each change from an up-to-date `main` branch:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/<name>
```

## Commit And Push

Keep each commit focused and use one of these prefixes:

- `feat:` new functionality
- `fix:` bug fix
- `refactor:` behavior-preserving code restructuring
- `style:` visual or CSS changes
- `docs:` documentation
- `chore:` repository maintenance

Verify the change locally, then push the branch to the fork:

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.js
python3 scripts/check_static_site.py
git status
git add <files>
git commit -m "feat: describe the change"
git push -u origin codex/<name>
```

Merge the branch into `main` through a GitHub pull request after review.

## Sync With Upstream

Fetch and integrate the original project's latest changes regularly:

```bash
git remote add upstream https://github.com/ChKSz/CPlayer.git # first time only
git remote set-url --push upstream DISABLED
git fetch upstream
git switch main
git pull --ff-only origin main
git merge upstream/main
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8787`, verify the player and playlist downloader, then push:

```bash
git push origin main
```

Do not replace the working tree with downloaded files, reset `main` to
`upstream/main`, or force-push the shared `main` branch.

## Resolve Conflicts

When Git reports a conflict:

```bash
git status
git diff
```

Edit each conflicted file so the final version preserves the intended behavior
from both sides. Then verify the application and finish the merge:

```bash
git add <resolved-files>
git commit
git push origin main
```

Textual conflicts are not the only risk. An automatic merge can still introduce
behavioral incompatibilities, so browser verification is required after every
upstream sync.

## Foundation Checks

- Python tests validate local assets and required accessibility markup.
- Node tests validate media URL safety, request error handling, API data normalization, and Service Worker request policies.
- The Service Worker keeps API and audio requests network-only, limits the cover cache to 100 entries, and removes obsolete cache versions during activation.
- Test desktop, tablet, and mobile layouts after changing dialog, touch, animation, or viewport behavior.
