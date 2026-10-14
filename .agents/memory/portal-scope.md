---
name: Xclip portal redesign scope
description: User-selected scope and visual direction for the developer portal.
---

The user selected a simpler API portal, then changed the scope to removing the old generator UI.

**Why:** After initially retaining the generator, the user explicitly said “generator lama hapus saja”.

**How to apply:** Remove the legacy generator interface without interpreting this as permission to delete Railway data or the generation backend used by the API. Account, API, and payment operations are separate concerns from retiring the old generator UI.

The API portal should be the default homepage; retaining the old generator at `/generator` is no longer the desired product scope.

**Why:** The user chose the API portal as homepage, then superseded the generator-retention choice with “generator lama hapus saja”.

**How to apply:** Treat the portal as the main entry point and do not reintroduce public generator navigation.

The user approved removing the entire old UI, including its admin panel, rather than extracting and preserving that panel.

**Why:** The user selected “Hapus seluruh UI lama, termasuk panel admin” after being told that its payment-approval interface would no longer be available.

**How to apply:** Do not preserve or restore the legacy admin frontend. A new administration interface is separate work, not part of the old-UI removal. Backend APIs and stored data are not included in this deletion.

New developers must register first, then log in before accessing the developer portal menus. Existing registered users can log in directly.

**Why:** The user explicitly said “harus login dulu sebelum mulai ke menu” and “jadi dev harus daftar dulu”.

**How to apply:** Make registration the initial flow for new developers and gate portal menus behind authentication. Local prototype transitions do not constitute real account registration or backend access control.

Include a Top up menu in the developer portal.

**Why:** The user explicitly requested “tambahkan juga menu top up”.

**How to apply:** Keep top up accessible after login. The user has not yet specified payment methods, amounts, or a separate API balance; do not treat prototype copy as a confirmed billing policy.
