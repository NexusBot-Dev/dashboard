# Nexus Dashboard

Web dashboard for [Nexus](https://trynexus.de), the focused Discord bot for streamers and gaming communities.
Server admins log in with Discord and configure every module of the bot here: <https://dashboard.trynexus.de>

## Features

- Discord OAuth2 login with encrypted sessions
- Per-server settings for all modules: moderation, AutoMod & Shield, leveling, reaction roles, welcome & boost messages, tickets, giveaways, embeds and stream alerts
- Premium-aware limits and upgrade hints
- Available in German, English, Spanish and Portuguese
- End-to-end tests against a real MariaDB and simulated bot and Discord APIs

## Tech stack

- [Astro 7](https://astro.build) with server-side rendering (`@astrojs/node`, standalone)
- Tailwind CSS 4
- MariaDB (shared with the bot) via `mysql2`
- Playwright for end-to-end tests

The dashboard reads guild data directly from the database. Apart from its own login sessions, every change goes through the bot's internal API (`BOT_INTERNAL_URL`), so permissions and Discord-side effects are always checked by the bot.

## Configuration

All settings come from environment variables. Secrets can also be read from a file: set the `*_FILE` variable to the file path (e.g. a Docker secret) instead of the value.

| Variable | File variant | Purpose |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | – | MariaDB connection |
| `NEXUS_DASHBOARD_DB_PASSWORD` | `DB_PASSWORD_FILE` | Database password |
| `DISCORD_CLIENT_ID` | `DISCORD_CLIENT_ID_FILE` | Discord OAuth2 application ID |
| `DISCORD_CLIENT_SECRET` | `DISCORD_CLIENT_SECRET_FILE` | Discord OAuth2 client secret |
| `NEXUS_SESSION_ENCRYPTION_KEY` | `SESSION_ENCRYPTION_KEY_FILE` | Key for encrypting stored OAuth tokens |
| `NEXUS_DASHBOARD_SECRET` | `DASHBOARD_SECRET_FILE` | Token for the bot's internal API |
| `BOT_INTERNAL_URL` | – | Bot API address (default `http://nexus-bot:8080`) |
| `OWNER_DISCORD_ID` | – | Discord user ID of the bot owner |
| `HOST`, `PORT` | – | Address the server listens on |

## Development

Requires Node.js 22.12 or newer (production runs Node.js 24).

```bash
npm ci
npm run dev        # development server
npm run build      # production build
node dist/server/entry.mjs
npx astro check    # type check
```

## Tests

The end-to-end tests start the built dashboard together with fake bot and Discord servers and run against a real MariaDB. Point them at an empty test database:

```bash
E2E_DB_HOST=127.0.0.1 E2E_DB_PORT=3306 E2E_DB_USER=nexus_test E2E_DB_PASSWORD=test E2E_DB_NAME=nexus_test \
  npm run test:e2e
```

The schema is created automatically. CI runs the same checks (`astro check` and all E2E tests against MariaDB 12.3) on every push.

## Credits & Attribution

This project started from the [Zenix](https://github.com/farrosfr/zenix) template by [Farros FR](https://farrosfr.com).
Emoji graphics: [Twemoji](https://github.com/twitter/twemoji) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).

## License

This project is licensed under the [MIT License](LICENSE).
