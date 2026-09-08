# Twins Bot Framework

## Overview
Distributed Minecraft bot management system built on `mineflayer` and `telegraf`. The system enables remote management of multiple Minecraft accounts ("twins") via Telegram, with automated HotMC voting via unique VPN IPs.

## Architecture
- **Hub-and-Spoke:** `tg-hub.js` serves as the control plane (Telegram interaction). Each twin is a separate Node.js process running a variant of `bot-base.js`.
- **IPC (Inter-Process Communication):** Communication is handled by `db.js` (SQLite via `better-sqlite3`, with automatic fallback to `twins_store.json` for environments where native bindings fail). Replaced all standalone JSON state files.
- **AFK Main:** A dedicated bot (`bot-main.js`) handles main account presence and AFK tasks independently.
- **Auto-Voting Pipeline:** `auto_vote.js` handles HotMC voting (Cloudflare `bp_chl` bypass via VM-sandboxed JS execution + Gemini captcha solving). `vote_vpn.js` orchestrates OpenVPN profile rotation for unique IPs per vote.

## Key Components
1. **Control Plane (`tg-hub.js`):** Orchestrates bot lifecycle, server switching, command forwarding. Manages `/vote` command to trigger auto-voting.
2. **Data Plane (`bot-base.js`):** Core bot library implementing Mineflayer logic (respect, spam, traffic monitoring, meow trigger, chat streaming).
3. **Streamer (`tg-chat-bot.js`):** Relays Minecraft chat logs to Telegram.
4. **Voting System (`auto_vote.js`):** Fetches HotMC vote page, solves Cloudflare `bp_chl` JS challenge, extracts captcha image, sends to Gemini API for OCR, submits vote form with correct Yii field names (`PlayerCollector[nickname]`, `CaptchaCollector[captcha]`).
5. **VPN Orchestrator (`vote_vpn.js`):** Rotates OpenVPN profiles to provide unique IPs for each voting attempt.
6. **Database (`db.js`):** Unified state management with `better-sqlite3` primary and JSON file fallback.
7. **Orchestration:** Managed by `systemd` units (`twins-bot1.service`, `twins-bot2.service`, `twins-main.service`, `twins-tghub.service`, `twins-tgchat.service`).

## Data Flow
1. **Command Input:** User executes command in Telegram (`tg-hub`).
2. **Task Queue:** Hub writes a task object via `db.js`.
3. **Execution:** Bot processes poll the database, execute logic (Mineflayer), update state, and respond/log.
4. **Auto-Vote Flow:** `/vote` → `auto_vote.js` fetches page → solves `bp_chl` → downloads captcha → Gemini OCR → POSTs vote with correct parameters and full cookie jar.

## Configuration & Deployment
- **Configs:** Per-bot `.env` files (e.g., `.env.twin1`, `.env.main`). `GEMINI_API_KEY` required for captcha solving. `OPENVPN_DIR` points to VPN profile directory.
- **Deployment:** CI/CD via GitHub Actions (SSH `git pull` + `npm install` + `systemctl restart`).
- **Provisioning:** `setup-systemd.sh` installs and enables all systemd services.
- **VPN:** OpenVPN profiles stored in `vpn/` directory. `vote_vpn.js` activates a random profile before each vote attempt.

## Operational Rules
- **State Files:** `db.js` uses `twins_store.json` as fallback. JSON state files are ignored by Git. Never persist state to repo.
- **Reliability:** Bots use `watchdog.sh` (as backup) or `systemd` (primary) for `Restart=always` with exponential backoff if necessary.
- **Communication:** Chat relay and command response use internal `botInstance.chat` methods and Telegram API.
- **Voting:** Each vote requires a fresh VPN IP. `vote_vpn.sh` must connect to a unique OpenVPN profile before running `auto_vote.js`.
- **Cloudflare Bypass:** `auto_vote.js` executes `bp_chl.js` in a Node.js VM sandbox to obtain the protection cookie. All subsequent requests must include this cookie in the Cookie jar.
