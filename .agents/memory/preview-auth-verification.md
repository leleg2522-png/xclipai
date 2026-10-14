---
name: Preview authentication verification
description: Keep server availability, embedded-browser connectivity, and actual authenticated sessions distinct.
---

Do not treat a healthy endpoint or a successful curl request as proof that authentication works in the user's embedded Preview browser.

**Why:** A user reported “Failed to fetch” in Preview while direct health and login requests worked. A workspace-parent origin rejection was reproducible separately, but the user's actual failing browser request was not captured. Cache control and embedded-browser state can also differ from a fresh screenshot browser.

**How to apply:** State precisely whether verification covered HTTP connectivity, the public login screen, or an authenticated session. Keep potential causes separate from confirmed browser observations, and never claim an admin login was tested without testing its session.
