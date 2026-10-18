---
name: Seedance final-resolution contract
description: Why Seedance source resolution differs from its developer-facing final output, and how to treat old jobs.
---

The user requested both Seedance 2.0 and 2.5 be documented as final 1080p, with mandatory ByteDance upscale through their existing Renderful AI pool before developers receive results. This is enhanced output, not native 1080p generation.

**Why:** The user explicitly requested upscale before returning video; merely changing docs would misrepresent the delivered file.

**How to apply:** Preserve each model's existing price/duration and 480p source contract. Gate completion/media on verified 1080p, expose generic progress, never fall back to 480p as success, and keep provider identities internal. Do not retrospectively bill extra upscale jobs for requests purchased under the old 480p contract.

Renderful's model page FAQ uses legacy predictions terminology, while its generated OpenAPI and developer quickstart use the generations endpoint.

**Why:** Research for this integration found the two public documentation surfaces conflicting, despite authenticated catalog/account reads succeeding.

**How to apply:** Use the current generated OpenAPI for field names and endpoint paths; model-page native UI parameter names are not proof of the public REST schema. Quote/account reads and local fixtures do not prove a paid end-to-end upscale succeeded.

Renderful developer and agent credentials have different endpoint scopes. A rejection from an agent-only quote endpoint does not by itself prove a developer key is invalid.

**Why:** An account key authenticated successfully against developer balance and model health, while the agent quote endpoint returned 401.

**How to apply:** Check developer authentication with the developer account endpoint and distinguish unsupported endpoint scope from invalid credentials. Never treat a successful balance check as proof that a paid upscale completed.
