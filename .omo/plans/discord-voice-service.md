# Plan: Lightpanda & Discord Voice Integration (2 Accounts + Auto-Start + Debug Logging)

## Objective
Add Discord voice bot support for **2 accounts** (matching Twin 1 and Twin 2) via Lightpanda browser and Puppeteer, with full auto-start on VPS reboot and detailed debug logging integrated into systemd/journalctl.

## Scope
- Create `discord-voice.js`: lightweight Puppeteer script taking instance ID / account parameters (`BOT_ID=1` or `BOT_ID=2`) to connect to Lightpanda CDP (`http://127.0.0.1:9222`), log in via token, open voice channel URL, maintain connection, and log detailed lifecycle events (connection state, reconnect attempts, navigation events).
- Update `setup-systemd.sh` to:
  1. Automatically download Lightpanda binary if not present.
  2. Create systemd service `lightpanda` (CDP browser daemon).
  3. Create systemd services `twins-discord1` and `twins-discord2` for the two Discord accounts with journald logging enabled.
  4. Ensure `systemctl enable` is called for all services so they **automatically start on VPS reboot**.
  5. Configure `Restart=always` and robust restart policies on all services.

## Todos
- [x] 1. `discord-voice.js`: Create multi-instance script supporting `BOT_ID=1`/`2` environment variable, connecting to Lightpanda, joining voice channel, with structured debug logging (`[Discord Bot 1] ...`).
- [x] 2. `setup-systemd.sh`: Add Lightpanda download, lightpanda service, twins-discord1/2 services with journal logging, and ensure `systemctl enable` for all services (auto-start on reboot).
- [x] 3. Verification: Run `node --check discord-voice.js` and test setup script dry-run.

## Final verification wave
- [x] F1. Verify `discord-voice.js` syntax (`node --check discord-voice.js`).
- [x] F2. Verify `setup-systemd.sh` syntax (`bash -n setup-systemd.sh`).
