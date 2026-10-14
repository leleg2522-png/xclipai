---
name: Xclip portal redesign scope
description: User-selected scope and visual direction for the developer portal.
---

The user selected “Portal API saja” and requested a simpler appearance. Preserve the existing generator application when integrating or iterating on this redesign.

**Why:** The user explicitly chose portal-only rather than redesigning the entire Xclip application.

**How to apply:** Keep API-portal changes separate from generator functionality. A canvas prototype is not yet a live, Railway-connected portal; integrating it requires preserving the existing account and API behavior.

New developers must register first, then log in before accessing the developer portal menus. Existing registered users can log in directly.

**Why:** The user explicitly said “harus login dulu sebelum mulai ke menu” and “jadi dev harus daftar dulu”.

**How to apply:** Make registration the initial flow for new developers and gate portal menus behind authentication. Local prototype transitions do not constitute real account registration or backend access control.
