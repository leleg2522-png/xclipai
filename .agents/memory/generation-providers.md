---
name: Xclip generation provider intent
description: User-specified provider setup for the third-party Xclip API.
---

The user states that generation should use Picsart accounts and Flora AI keys stored in the database of the Railway-hosted project.

**Why:** The user explicitly identified these providers for Xclip generation.

**How to apply:** Preserve this intent when connecting the developer portal to the backend. Verify configuration without reading or exposing credential values. Third-party callers should use Xclip API keys rather than receive provider credentials.

Configuration existing in Railway is not proof that the imported source can use it.

**Why:** Read-only schema inspection confirmed provider storage, while the imported source lacked the corresponding adapters. Database and source can be from different stages of the product.

**How to apply:** Check both database configuration and adapter code before calling a provider ready. Do not silently substitute another provider or invent a provider contract; obtain the current source or documented integration contract when the adapter is missing.
