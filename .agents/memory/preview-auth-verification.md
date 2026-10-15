---
name: Preview authentication verification
description: Keep server availability, embedded-browser connectivity, and actual authenticated sessions distinct.
---

Do not treat a healthy endpoint or a successful curl request as proof that authentication works in the user's embedded Preview browser.

**Why:** A user reported “Failed to fetch” in Preview while direct health and login requests worked. A workspace-parent origin rejection was reproducible separately, but the user's actual failing browser request was not captured. Cache control and embedded-browser state can also differ from a fresh screenshot browser.

**How to apply:** State precisely whether verification covered HTTP connectivity, the public login screen, or an authenticated session. Keep potential causes separate from confirmed browser observations, and never claim an admin login was tested without testing its session.

Payment simulations do not prove that the user's signed-in payment screen or live gateway is working.

**Why:** The user continued reporting a stuck QR-creation button after successful fixture-based payment tests. A passing happy-path simulation did not identify the exact state in their browser.

**How to apply:** Distinguish an actually pending request from a disabled button, inspect the visible readiness/error state, and state whether the real authenticated gateway flow was verified. Do not infer live payment success from simulated invoices or a public login screenshot.
