# Twins Client — Windows

## Which download do I need?

- `twins-windows-portable.zip` — **Node.js included.** Unzip and run. No install step.
- `twins-windows-node.zip` — **smaller download.** Requires Node.js 22.5+ already installed on the machine.

If unsure, take the portable build.

## Setup

1. Unzip the archive to a folder (do not run it from inside the zip).
2. Copy `.env.client` to `.env` and fill it in:
   - one bot on this machine → `.env`
   - two bots on this machine → copy to `.env.twin1` and `.env.twin2` instead
3. For the Node-required build, run `install.bat` once to install dependencies.
   **Portable build:** do not run `install.bat`, dependencies and `node.exe` are already included.
4. Run `run_bot1.bat` and/or `run_bot2.bat`.

## Environment example

```
USERNAME=YourMinecraftUsernameOrEmail
PASSWORD=YourMinecraftPassword
MINECRAFT_HOST=5.83.140.251
MINECRAFT_PORT=25809
HUB_HOST=65.108.132.166
HUB_PORT=40316
BOT_TOKEN=your_secret_bot_token_here
MAIN_ACCOUNT=AlexZTI_
TWINKS=AlexZTI_Twin,AlexZTI_Twin1
```

`BOT_TOKEN` is a secret. Never share the filled `.env` file. There is no `BOT_NAME` setting.

## Troubleshooting

- `node --version` fails or prints below 22.5 → install Node.js 22.5+ or use the portable build.
- Bot starts but cannot connect → make sure the file is named `.env` (or `.env.twin1`/`.env.twin2` for two bots), not `.env.client` or `.env.txt`.
- Connection refused on the hub → open port `40316` (or the `HUB_PORT` you configured) in your firewall.
