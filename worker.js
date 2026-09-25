const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

async function telegram(env, method, body) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

function appUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/`;
}

async function handleTelegramUpdate(update, env, request) {
  const message = update?.message;
  if (!message?.text) return { ok: true };

  const text = message.text.trim().toLowerCase();
  if (!["/game", "/game@"+(env.BOT_USERNAME || "").toLowerCase(), "/ninja", "/ninja@"+(env.BOT_USERNAME || "").toLowerCase()].includes(text)) {
    return { ok: true };
  }

  if (!env.BOT_TOKEN || !env.GAME_SHORT_NAME) {
    return { ok: false, error: "Missing BOT_TOKEN or GAME_SHORT_NAME" };
  }

  // Telegram HTML5 Game messages are the native way to launch a game from a group.
  const result = await telegram(env, "sendGame", {
    chat_id: message.chat.id,
    game_short_name: env.GAME_SHORT_NAME,
    reply_to_message_id: message.message_id,
    protect_content: false
  });

  return result;
}

async function setWebhook(request, env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (secret !== env.BOT_TOKEN) return json({ ok: false, error: "Unauthorized" }, 401);

  const webhookUrl = `${url.origin}/telegram/webhook`;
  const result = await telegram(env, "setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"]
  });

  return json(result);
}

async function getLeaderboard(env) {
  // The native Telegram game leaderboard is message-specific and user-specific.
  // This endpoint exists for health/debugging and future expansion.
  return json({
    ok: true,
    game: env.GAME_SHORT_NAME || null,
    note: "Use Telegram HTML5 Game high scores for the native group leaderboard."
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, game: env.GAME_SHORT_NAME || "ninjafruit" });
    }

    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      return getLeaderboard(env);
    }

    if (url.pathname === "/api/set-webhook" && request.method === "GET") {
      return setWebhook(request, env);
    }

    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env, request));
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: "Invalid update" }, 400);
      }
    }

    // Static game files are served by Cloudflare Assets.
    return env.ASSETS.fetch(request);
  }
};
