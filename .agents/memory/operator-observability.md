---
name: Operator observability
description: Interpret requests for Railway log visibility as operational progress and failure reporting.
---

The operator wants visible generation progress and failure causes in Railway application logs. Explaining a pasted PostgreSQL error or fixing its SQL alone does not satisfy a request that logs “ga gerak”.

**Why:** After receiving SQL-error explanations, the user clarified: “maksud gw ko di log railway nya ga gerak ya coba perbaiki jadi gw ga tau eror nya kalo gagal”.

**How to apply:** Check for swallowed background errors and silent lifecycle steps. Provide useful web-service progress/failure logs, clearly distinguish them from PostgreSQL service logs, and say whether code still needs deployment. Preserve provider privacy in public responses and never log credentials, raw request/response objects, or signed upstream URLs.

Developer customers also need their own generation outcome visibility, not access to operator logs.

**Why:** The user requested “tambahkan log generate agar si dev user yg pakai tau generate nya berhasil atau tidak”.

**How to apply:** Keep customer history scoped to the authenticated owner and use safe statuses/messages. Operator diagnostics remain internal; a history fetch failure or uncertain delivery must not be mislabeled as a failed generation.
