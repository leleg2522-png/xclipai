---
name: Production package portability
description: Replit-managed lockfiles may contain registry URLs unavailable to external build services.
---

Preserve the workspace lockfile's vetted versions and integrity hashes, but normalize Replit-internal tarball references in the external production build.

**Why:** The Railway failure investigation found locked tarballs pointing to a Replit-internal registry. A build outside Replit cannot rely on access to that host; retrying the unchanged source is insufficient.

**How to apply:** Validate exported production dependency resolution rather than changing versions or bypassing local package controls. Keep dependency-presence checks in production builds so an installer bug cannot silently produce an image without required modules.
