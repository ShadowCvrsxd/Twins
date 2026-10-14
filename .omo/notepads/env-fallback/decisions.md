# Decisions — env-fallback

Architectural choices and rationales discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

- **Smart .env fallback**: Implemented `fs.existsSync(envPath) ? envPath : '.env'` in `startBot()` to avoid Windows falling back to system `USERNAME` environment variable when `.env.twin1` or `.env.twin2` is missing.
