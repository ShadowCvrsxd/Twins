# Twins Bot Architecture & AI Instructions

## Project Context
Framework for managing Minecraft accounts ("twins") via Telegram. Central Hub on VPS, remote clients on local machines.

## Architecture Guidelines (Strict)
1. **Decoupling**: Never use the central database for passing real-time bot commands. Use the WebSocket/HTTP API gateway (port 8089) for communication.
2. **Auth Protocol**: All remote requests require Bearer token authentication validated against the Hub's token registry.
3. **Concurrency**: Avoid race conditions. Do not use direct database writes for command queues; use the API interface.
4. **Efficiency**: Batch edits, minimize API interaction, perform local verification.

## Instructions for AI
- **Commit Strategy**: Every change must be an atomic, independent commit.
- **Push**: Always push changes to trigger VPS synchronization.
- **Verification**: Run local tests before finalizing changes.
- **Isolation**: Keep Minecraft credentials strictly on client machines; Hub credentials are for bridge authorization only.
