# Telegram Bot setup — exact sequence

## A. Create bot
Open @BotFather:

/newbot

Save the bot token.

## B. Create the game
In @BotFather:

/newgame

Choose the bot, then:
- Short name: `ninjafruit`
- Title: `Ninja Fruit`
- Description: `Slice fruit, avoid bombs and beat your group's high score.`

When the Cloudflare Worker is deployed, set the game's URL to:

`https://YOUR-WORKER.workers.dev/`

## C. Put the token in Cloudflare

Cloudflare dashboard:
Workers & Pages → your Worker → Settings → Variables and Secrets → Add secret

Name:
`BOT_TOKEN`

Value:
your BotFather token

Or with Wrangler:

`npx wrangler secret put BOT_TOKEN`

## D. Set the webhook

After deployment, open:

`https://YOUR-WORKER.workers.dev/api/set-webhook?secret=YOUR_BOT_TOKEN`

The response should contain `"ok":true`.

## E. Add the bot to a group

Add the bot to your Telegram group.

Send:

`/game`

The bot should send the native Telegram game card with the Play button.

## F. Score behavior

This project uses Telegram's HTML5 Game score mechanism. The game tries the Telegram game proxy when available.

If you open the Worker URL directly in Chrome, the game still works, but Telegram's native score submission is not available there.

## Security note

Never put `BOT_TOKEN` in:
- `public/game.js`
- `index.html`
- GitHub
- screenshots
- client-side environment variables

Only the Cloudflare Worker needs the token.
