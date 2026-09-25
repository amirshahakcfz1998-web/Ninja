# Ninja Fruit — Telegram HTML5 Game

A standalone Telegram HTML5 game designed for group chats. Players launch it from a Telegram Game message, slice fruit with touch/mouse swipes, avoid bombs, and submit their score to Telegram.

## Stack

- HTML5 Canvas + vanilla JavaScript
- Cloudflare Worker + static assets
- Telegram Bot API HTML5 Games
- GitHub for source control/deployment

## 1. Create the Telegram game

1. Open **@BotFather** in Telegram.
2. `/newbot` if you do not already have a bot.
3. `/newgame`
4. Select your bot.
5. Choose a short name, for example `ninjafruit`.
6. Set the game title to `Ninja Fruit`.
7. Upload a square game icon if BotFather asks for one.
8. Later, set the game URL to your Cloudflare Worker URL, e.g.:
   `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/`

Keep the game short name exactly as BotFather gives it.

## 2. Configure the Worker

Copy `.dev.vars.example` to `.dev.vars` for local development:

```text
BOT_TOKEN=123456:ABC...
GAME_SHORT_NAME=ninjafruit
```

For Cloudflare production secrets, use:

```bash
npx wrangler secret put BOT_TOKEN
```

Then enter the bot token.

The game short name can be stored as a Wrangler variable in `wrangler.toml`.

## 3. Deploy

Install Wrangler:

```bash
npm install
```

Login:

```bash
npx wrangler login
```

Deploy:

```bash
npm run deploy
```

The deployment output gives the Worker URL.

## 4. Set the Telegram game URL

Go back to @BotFather and edit the game URL so it points to the deployed Worker URL.

For local testing, you can use:

```bash
npm run dev
```

Wrangler will provide a local URL. Telegram itself needs a publicly reachable HTTPS URL, so local testing from Telegram normally requires a temporary tunnel.

## 5. Set the webhook

After deployment:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/set-webhook?secret=YOUR_BOT_TOKEN
```

Or call the Bot API manually with your bot token.

The Worker also supports:

- `POST /telegram/webhook`
- `GET /api/health`
- `GET /api/leaderboard`

## 6. Use it in a group

In a group where the bot is present, send:

```text
/game
```

The bot replies with a Telegram Game message containing the **Play** button.

After a game, the browser submits the score through the Telegram HTML5 Game API. Telegram keeps the official high scores for the game message.

## Important

Do not put your bot token inside `public/` or any browser JavaScript. The token belongs only in Cloudflare Worker secrets.

This first version deliberately uses Telegram's native HTML5 Game score system rather than inventing a client-trusted leaderboard. That makes the group leaderboard work naturally with Telegram's game message/high-score system.
