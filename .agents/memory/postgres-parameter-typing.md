---
name: PostgreSQL parameter typing
description: Avoid ambiguous parameter inference in updates combining varchar assignment and CASE comparisons.
---

When a PostgreSQL parameter is reused to assign a varchar status and in CASE/IN text comparisons, cast every occurrence consistently (for example, $1::text).

**Why:** A real generation finished upstream, but its public status returned 503 because PostgreSQL rejected its task update with 42P08, text versus character varying. Fake database tests had accepted the SQL and missed this.

**How to apply:** For financial/task transition SQL, use explicit parameter types and verify the prepared statement against the actual schema with EXPLAIN without ANALYZE inside BEGIN READ ONLY. Do not execute production updates merely to validate SQL. Confirm results through the normal authenticated task flow; never start another paid generation just to recover a completed task.
