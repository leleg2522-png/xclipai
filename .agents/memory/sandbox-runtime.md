---
name: Mockup sandbox runtime compatibility
description: Native dependency installation when an imported app uses an older Node runtime.
---

When creating a mockup sandbox in a Node 18 project, check the scaffold's runtime requirements before starting it. Vite 7 needs a newer Node runtime; installing its dependencies under Node 18 can also omit Tailwind's native optional bindings.

**Why:** The sandbox failed first with missing Vite and then with a missing Oxide native binding. Installing Node 20 and reinstalling optional dependencies inside the sandbox resolved startup.

**How to apply:** Install dependencies from the sandbox directory, not the app root. After upgrading the runtime, reinstall with optional dependencies included before retrying a native-binding failure.
