# OpenCC matching support

`t2cn.js` is the unmodified ESM traditional-to-simplified bundle from the npm package `opencc-js@1.4.2` (<https://github.com/nk2028/opencc-js>). Only artwork metadata comparisons use it; it does not change displayed song names or lyrics. Converter initialization is lazy.

The code is MIT licensed (`LICENSE`); dictionary data is Apache-2.0 licensed (`THIRD_PARTY_LICENSES.md`). These files are included with the bundled Android UI and web assets.

To update, unpack a pinned `opencc-js` npm package and copy `dist/esm/t2cn.js`, `LICENSE`, and `THIRD_PARTY_LICENSES.md` together. Re-run the artwork matching and browser checks.

Bundled file SHA-256: `b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6`.
