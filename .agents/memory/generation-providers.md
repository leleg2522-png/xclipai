---
name: Xclip generation provider intent
description: User-specified provider setup for the third-party Xclip API.
---

The user states that generation should use Picsart accounts and Flora AI keys stored in the database of the Railway-hosted project.

**Why:** The user explicitly identified these providers for Xclip generation.

**How to apply:** Preserve this intent when connecting the developer portal to the backend. This is user-provided context, not a verified database finding; verify configuration without reading or exposing credential values. Third-party callers should use Xclip API keys rather than receive provider credentials.
