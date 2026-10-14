# Learnings — env-fallback

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

- **Robust config loading**: Always verify env file existence via `fs.existsSync` when supporting multiple environment configurations (`.env.twin1`, `.env.twin2`, etc.) with fallback to `.env`.
