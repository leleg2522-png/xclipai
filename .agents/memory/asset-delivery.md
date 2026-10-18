---
name: Asset delivery size limit
description: Delivering large generated videos through Library asset cards without changing the original result.
---

The asset presentation callback enforces a 104,857,600-byte (100 MiB) upload limit.

**Why:** A successfully downloaded generation was rejected with `TOO_LARGE` when presented through an asset card, despite the local file being valid.

**How to apply:** Check file size before presenting large videos. Keep the original generation untouched, encode a smaller delivery copy if needed, and verify the copy's dimensions, duration, and audio before presenting it. Tell the user that the chat copy is compressed. Compression is not another generation and must not trigger another paid submission.
