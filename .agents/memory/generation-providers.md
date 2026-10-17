---
name: Xclip generation provider intent
description: User-specified provider setup for the third-party Xclip API.
---

For the Alriz migration, the user's “Kling MC P5” means the existing Kling Motion Control backend, not the Picsart `p500` pool. Replace that motion-control integration with Alriz Kling MC 2.6 Pro without changing Wan or Seedance.

**Why:** The user explicitly corrected the mistaken interpretation of “P5” as the shared Picsart pool.

**How to apply:** Scope this migration to motion-control requests and their status/results. Do not remove or reroute the Wan and Seedance models as part of it.

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

The user has retired “Wan 3.0 Uncensored”: do not offer it in the catalog/docs or accept new public generation requests. Preserve historical jobs, media access, and billing settlement.

**Why:** The user explicitly said “dan juga hilangkan model wan uncecored”, superseding the earlier request to offer this model.

**How to apply:** Keep the normal Wan 3.0 and both Seedance models available as configured. Retaining an internal historical adapter/price is not permission to restore Uncensored as a public model.

Flora's prose guides and search snippets can lag its generated API reference.

**Why:** Documentation research found the generations guide claiming webhooks were unavailable, while the generated endpoint reference documented signed callbacks and read-only quotes.

**How to apply:** Prefer the current generated reference for endpoint contracts and the authenticated model catalog for actual account capabilities. Do not infer a missing capability solely from older prose or cached search snippets.

The user approved a separate public “Wan 3.0” model backed internally by Picsart, priced Rp6.500 per video. They subsequently requested its backend resolution be changed to 1080p; duration remains 30 seconds.

**Why:** After providing a successful Picsart browser capture, the user selected “Tambah Wan 3.0 terpisah” and entered Rp6.500.

**How to apply:** Keep provider names internal and preserve the requested per-model price. New normal Wan requests use 1080p and 30 seconds, subject to a successful upstream quote; do not claim live 1080p generation was verified from the original 480p capture. Uncensored is retired separately as described above.

The user requested Seedance 2.5 as an additional model and confirmed Rp11.000 per video for 480p/30 seconds.

**Why:** The user supplied a successful Seedance capture and entered Rp11.000 when asked for the 480p/30-second developer tariff.

**How to apply:** Preserve the existing Wan models/prices and keep provider identity internal. Do not infer successful 1080p generation from the capture's quotes; its completed Seedance generation used 480p/30 seconds.

The user requested Seedance 2.0 as another separate model and confirmed Rp5.000 per video for 480p/15 seconds.

**Why:** Their new HAR demonstrates a completed Seedance 2.0 generation at 480p/15 seconds, and they entered Rp5.000 when asked for that tariff.

**How to apply:** Preserve the existing models and prices. Do not carry Seedance 2.5's 30-second default into Seedance 2.0; keep its examples, validation and billing consistent with the 15-second product. The capture's completed usage is not proof of a live options quote; unsupported configurations must fail preflight before charging.
