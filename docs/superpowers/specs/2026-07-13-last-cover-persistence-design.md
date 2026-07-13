# Last Cover Persistence Design

## Goal

Keep the album artwork from the last successfully loaded song visible after refresh and when the player starts with an empty queue.

## Behavior

- Search result thumbnails continue to load as they do today.
- The main vinyl artwork changes only after the user selects a song and its playable data is loaded.
- A valid HTTP or HTTPS cover URL is saved in `localStorage` under `cp_lastCover`.
- On startup, the saved cover is restored to both desktop and mobile artwork elements before playlist initialization.
- Missing, malformed, executable, `blob:`, and unsupported cover URLs are ignored.
- A song without cover artwork does not erase the last valid saved cover.

## Error Handling

Storage access is wrapped so private browsing restrictions or malformed saved values cannot prevent the player from starting. Invalid saved values are removed when possible.

## Testing

- Verify a shared storage key and save/restore functions exist.
- Verify only persistent HTTP/HTTPS URLs are accepted.
- Verify startup restores both desktop and mobile cover elements.
- Verify successful song loading saves the normalized cover URL.
- Run all Python, Node.js, static-site, syntax, and HTTP preview checks.

