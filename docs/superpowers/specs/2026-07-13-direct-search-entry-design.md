# Direct Player Entry Design

## Goal

Remove the first-visit requirement to enter a NetEase Cloud Music playlist ID. Users should enter the player immediately and keep using the existing desktop and mobile search flows to add songs.

## Selected Approach

Keep playlist ID loading as an optional settings feature, but stop opening the welcome playlist dialog when no local or cached playlist is available.

This is preferred over deleting playlist ID support because returning users may still rely on saved playlists or manual loading. It is preferred over automatically opening the search panel because direct entry should not replace one blocking prompt with another interruption.

## Startup Behavior

1. Load `playlist.js` when it exists.
2. Otherwise, load the previously saved playlist ID when available.
3. If neither source produces a playlist, enter the player with an empty queue.
4. Render an empty-state message that directs the user to the existing search feature.
5. Do not open `welcomeModal` automatically.

## Preserved Behavior

- Desktop and mobile song search remain unchanged.
- Songs selected from search continue to be added to the queue and played.
- Saved playlist IDs, manual playlist ID loading, file import, and drag-and-drop import remain available.
- The welcome dialog markup and optional loading code may remain for compatibility, but startup must not invoke it.

## Error Handling

If a saved playlist ID fails to load, initialization falls back to the empty queue instead of showing the welcome dialog. Existing toast/error behavior for the failed request remains unchanged.

## Testing

- Add a regression test proving that the default startup path does not call `openWelcomeModal()`.
- Assert that the empty queue message points users to search rather than requesting a playlist ID.
- Run all Python, JavaScript, static-site, and local HTTP checks.

