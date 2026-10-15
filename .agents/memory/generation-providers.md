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

Distinguish hiding provider routing from guaranteeing untraceable generated media. Do not promise complete provider anonymity based only on sanitized HTTP responses.

**Why:** A downloaded generation contained embedded AIGC provenance metadata with producer/propagator identifiers, despite clean public API responses and Xclip-only media URLs.

**How to apply:** Include media metadata in privacy audits, explain its limits, and preserve AI-origin/provenance markings rather than silently stripping them to conceal origin.

The user wants a public video-model category showing “Wan 3.0 Uncensored”; its intended internal provider is Flora AI, which must not be named to developer users. The requested generation configuration is Wan 3.0, 480p, 30 seconds.

**Why:** The user specified the public model label and provider privacy, then requested 480p and 30 seconds, correcting the model version to “wan3,0”. When told the documentation did not confirm the Uncensored variant, the user stated “sudah gw tes dan benar”.

**How to apply:** Use the requested public model name and category without provider branding, accepting the user's report that they tested and confirmed it. Do not describe that report as an independent agent test or official documentation confirmation. Verify the actual model identifier and parameter options before wiring the adapter; the user's confirmation does not supply an API contract or a moderation-toggle parameter.

Flora's prose guides and search snippets can lag its generated API reference.

**Why:** Documentation research found the generations guide claiming webhooks were unavailable, while the generated endpoint reference documented signed callbacks and read-only quotes.

**How to apply:** Prefer the current generated reference for endpoint contracts and the authenticated model catalog for actual account capabilities. Do not infer a missing capability solely from older prose or cached search snippets.

The user approved adding a separate public “Wan 3.0” model backed internally by Picsart, priced Rp6.500 per video, while retaining Wan 3.0 Uncensored at its existing price.

**Why:** After providing a successful Picsart browser capture, the user selected “Tambah Wan 3.0 terpisah” and entered Rp6.500.

**How to apply:** Do not replace or silently reroute the Uncensored model. Keep provider names internal and use the requested per-model prices. The supplied capture demonstrates 480p/30-second image-to-video, not an Uncensored capability or every possible duration; expand supported settings only with evidence.
