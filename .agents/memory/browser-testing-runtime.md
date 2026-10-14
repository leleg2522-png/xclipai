---
name: Browser testing runtime compatibility
description: Testing instructions may expose a subagent kind that this workspace runtime does not support.
---

Verify runtime support rather than assuming a testing skill guarantees that the testing subagent can be launched.

**Why:** On 2026-10-14 the callback rejected the documented testing kind with “Unknown config kind: testing”. System Chromium was available, so direct browser verification succeeded without installing dependencies or weakening application authentication.

**How to apply:** If the same capability error recurs, do not repeat the unsupported call. Check the installed browser and use an isolated browser context for verification. For payment UI checks, mock every API request in the test browser and clearly distinguish simulated UI checks from live gateway payments or real session verification. Never use production account creation or an auth bypass merely to obtain a screenshot. Runtime capabilities can change; this is an observed compatibility issue, not a permanent platform limitation.
