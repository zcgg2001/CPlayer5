# CPlayer5 Development Workflow

This fork uses two Git remotes:

- `origin`: `zcgg2001/CPlayer5`, the writable fork.
- `upstream`: `ChKSz/CPlayer`, the original project. Pushes are disabled locally.

## Branches

- `main` is the stable, integrated branch.
- `feature/<name>` is for new features.
- `fix/<name>` is for bug fixes.
- `chore/<name>` is for maintenance and tooling.

Create each change from an up-to-date `main` branch:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/<name>
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
git status
git add <files>
git commit -m "feat: describe the change"
git push -u origin feature/<name>
```

Merge the branch into `main` through a GitHub pull request after review.

## Sync With Upstream

Fetch and integrate the original project's latest changes regularly:

```bash
git fetch upstream
git switch main
git pull --ff-only origin main
git merge upstream/main
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080`, verify the player and playlist downloader, then push:

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
