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

Provider identity must remain internal: developer users should see Xclip, not Picsart or Flora AI, in portal content or API metadata.

**Why:** The user explicitly said “backend nya seperti picsart dan flora ai ga ketauan user”.

**How to apply:** Keep names, pool/configuration details, upstream error payloads, and provider media domains out of the public interface. Merely hiding credential values is insufficient; preserve this boundary when adding adapters and diagnostic views.

The user wants a public video-model category showing “Wan 3.0 Uncensored”; its intended internal provider is Flora AI, which must not be named to developer users. The requested generation configuration is Wan 3.0, 480p, 30 seconds.

**Why:** The user specified the public model label and provider privacy, then requested 480p and 30 seconds, correcting the model version to “wan3,0”.

**How to apply:** Use the requested public model name and category without provider branding. Verify the provider's actual model identifier and parameter options through its authenticated catalog before making it callable. The requested “Uncensored” label is not proof of an officially supported unmoderated variant.
