# Twins Bot Architecture

## Overview
Twins is a distributed Minecraft multi-account management framework connecting a Telegram control center on a central VPS with remote client bots running on local machines.

## Key Components

1. **Hub & API Gateway (Port 8089)**
   - Implemented in `tg-hub.js`.
   - Exposes an HTTP API and WebSocket server on port `8089` (`0.0.0.0`).
   - Acts as the central message router and state coordinator between Telegram users/bots and remote Minecraft client bots.

2. **Telegram Interfaces**
   - `tg-hub.js`: Manages central control flows and gateway routing.
   - `tg-chat-bot.js`: Handles Telegram chat interactions, forwarding user commands to `http://localhost:8089/command`.

3. **Remote Client Bots**
   - `bot.js`, `bot-2.js`, `bot-main.js`: Mineflayer instances connecting to the Hub WebSocket bridge to execute actions in Minecraft.

4. **Authentication & Security**
   - Client connections and API endpoints authenticate via secure Bearer tokens validated against the Hub's registry.
   - Credentials are isolated to respective client environments.

5. **Decoupling Principles**
   - No file-queue mechanisms or direct database polling for real-time commands.
   - All real-time coordination flows through the port 8089 WebSocket/HTTP bridge.
