# Centered Lyrics Focus Design

## Goal

Implement the selected "cinema focus" lyrics treatment: the active lyric stays horizontally and vertically centered while surrounding lines recede through opacity and a small amount of blur.

## Selected Visual Behavior

- Center every desktop and mobile lyric line horizontally.
- Keep the active line vertically centered using the existing scroll target calculation.
- Render the active line at full opacity with no blur.
- Render the immediately previous and next lines at moderate opacity with minimal blur.
- Render all more distant lines at low opacity with a subtle blur.
- Remove active-line margins that can shift the measured center position.
- Preserve current desktop and mobile font sizes, translations, click-to-seek behavior, and smooth scrolling.

## State Model

`updateLyrics()` assigns one of three visual states whenever the active lyric changes:

- `active`: the current lyric.
- `near`: the lyric immediately before or after the current lyric.
- default: all remaining lyrics.

Before applying the new state, both `active` and `near` are removed from every line so stale focus styles cannot remain after scrolling.

## Desktop And Mobile Styling

Both renderers use the same focus hierarchy:

- Active: opacity `1`, blur `0`.
- Near: opacity `0.36`, blur `0.35px`.
- Distant: opacity `0.12`, blur `1px`.

Desktop and mobile retain their existing type sizes. Mobile keeps its larger active lyric size and glow, but text alignment and focus depth match desktop.

## Testing

- Verify desktop and mobile lyric blocks use centered text and centered transform origins.
- Verify active, near, and distant blur/opacity rules exist.
- Verify `updateLyrics()` clears stale states and marks adjacent lines as `near`.
- Verify the existing vertical center scroll calculation remains intact.
- Run the complete Python, Node.js, static-site, syntax, and local HTTP checks.

