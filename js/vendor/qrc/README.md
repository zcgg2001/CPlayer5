# QRC interoperability decoder

The cipher core is adapted from **qrc-decoder 1.0.2** by apoint123 (MIT),
https://github.com/apoint123/qrc-decoder, npm SHA-1
`7d64a9af6c942a5c10948499d5b4cf3c8b2ef804`.
It credits **LyricDecoder** by SuJiKiNen (MIT),
https://github.com/SuJiKiNen/LyricDecoder.
Both copyright and permission notices are included here.

Changes: retained the constants and block cipher functions, replaced the public
API with a byte-only decrypt function, removed encoding/encryption/zlib wrappers
and the pako dependency. Input validation and bounded browser-native decompression
live in `js/lyrics/encoded.js`. The algorithm is unchanged.
This format-specific cipher is not a general-purpose security primitive.

No implementation was copied from myMusic.
