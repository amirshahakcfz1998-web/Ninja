const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

async function telegram(env, method, body) {
  if (!env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}

/* ---------------------------------------------
   GAME URL
--------------------------------------------- */

function getGameUrl(request, gamePath = "/", extraParams = {}) {
  const url = new URL(request.url);
  const gameUrl = new URL(`${url.origin}${gamePath}`);

  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null) {
      gameUrl.searchParams.set(key, String(value));
    }
  }

  return gameUrl.toString();
}

function getGamePath(shortName) {
  const name = String(shortName || "").toLowerCase();
  if (name === "flyingbird") return "/bird/";
  if (name === "tetris") return "/tetris/";
  if (name === "drive") return "/drive/";
  if (name === "bricks_breeker") return "/bricks/";
  return "/"; // ninja fruit (default)
}

function gameSlug(shortName) {
  const name = String(shortName || "").toLowerCase();
  if (name === "flyingbird") return "bird";
  if (name === "tetris") return "tetris";
  if (name === "drive") return "drive";
  if (name === "bricks_breeker") return "bricks";
  return "ninja";
}

/* ---------------------------------------------
   TELEGRAM UPDATE
--------------------------------------------- */

async function handleTelegramUpdate(update, env, request) {

  // INLINE QUERY
  const inlineQuery = update?.inline_query;
  if (inlineQuery) {
    const results = [];

    // Ninja Fruit
    results.push({
      type: "game",
      id: "ninja",
      game_short_name: env.GAME_SHORT_NAME || "Game"
    });

    // Flying Bird
    results.push({
      type: "game",
      id: "bird",
      game_short_name: "flyingbird"
    });

    // Tetris
    results.push({
      type: "game",
      id: "tetris",
      game_short_name: "tetris"
    });

    // Drive (car racer)
    results.push({
      type: "game",
      id: "drive",
      game_short_name: "drive"
    });

    // Bricks Breaker
    results.push({
      type: "game",
      id: "bricks",
      game_short_name: "bricks_breeker"
    });

    await telegram(env, "answerInlineQuery", {
      inline_query_id: inlineQuery.id,
      results,
      cache_time: 30,
      is_personal: false
    });
    return;
  }

  // CALLBACK QUERY
  const callback = update?.callback_query;
  if (callback) {

    // Play button of a game
    if (callback.game_short_name) {
      const shortName = callback.game_short_name;
      const path = getGamePath(shortName);

      const params = {
        uid: callback.from?.id,
        cid: callback.message?.chat?.id,
        mid: callback.message?.message_id,
        game: shortName,
        // Cache-buster: Telegram clients reuse a cached game page (with stale
        // query params) across "Play" taps. A unique URL per tap forces a fresh
        // page load so uid/imid always match the tapped message.
        t: Date.now()
      };

      if (callback.inline_message_id) {
        params.imid = callback.inline_message_id;
      }

      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        url: getGameUrl(request, path, params),
        cache_time: 0
      });
      return;
    }

    // Menu buttons
    const data = callback.data;

    if (data === "play_ninja_solo") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      await telegram(env, "sendGame", {
        chat_id: callback.message.chat.id,
        game_short_name: env.GAME_SHORT_NAME || "Game"
      });
      return;
    }

    if (data === "play_bird_solo") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      await telegram(env, "sendGame", {
        chat_id: callback.message.chat.id,
        game_short_name: "flyingbird"
      });
      return;
    }

    if (data === "play_tetris_solo") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      await telegram(env, "sendGame", {
        chat_id: callback.message.chat.id,
        game_short_name: "tetris"
      });
      return;
    }

    if (data === "play_drive_solo") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      await telegram(env, "sendGame", {
        chat_id: callback.message.chat.id,
        game_short_name: "drive"
      });
      return;
    }

    if (data === "play_bricks_solo") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      await telegram(env, "sendGame", {
        chat_id: callback.message.chat.id,
        game_short_name: "bricks_breeker"
      });
      return;
    }

    if (data === "play_friend") {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "یک دوست را انتخاب کن 👇"
      });
      await telegram(env, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: "⚔️ *چالش با دوست*\n\nروی دکمه زیر بزن و یک دوست را انتخاب کن:",
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "📤 ارسال به دوست", switch_inline_query: "" }
          ]]
        }
      });
      return;
    }

    if (data === "play_group") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
      await telegram(env, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: "👥 *بازی در گروه*\n\nدر گروه تایپ کن:\n`@gameifyrbot`\n\nسپس بازی مورد نظرت را انتخاب کن.",
        parse_mode: "Markdown"
      });
      return;
    }
  }

  // NORMAL MESSAGE
  const message = update?.message;
  if (!message?.text) return;

  const text = message.text.trim().toLowerCase();
  const botUsername = (env.BOT_USERNAME || "").toLowerCase();

  const commands = [
    "/start", "/game", "/ninja", "/bird",
    `/start@${botUsername}`, `/game@${botUsername}`,
    `/ninja@${botUsername}`, `/bird@${botUsername}`
  ];

  if (!commands.includes(text)) return;

  // Main menu
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: "🎮 *Gameifyr Bot*\n\nیکی از بازی‌ها را انتخاب کن:",
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🥷 Ninja Fruit (تکی)", callback_data: "play_ninja_solo" }
        ],
        [
          { text: "🐦 Flying Bird (تکی)", callback_data: "play_bird_solo" }
        ],
        [
          { text: "🧱 تتریس (تکی)", callback_data: "play_tetris_solo" }
        ],
        [
          { text: "🏎️ ماشین‌سواری (تکی)", callback_data: "play_drive_solo" }
        ],
        [
          { text: "💥 بریکس بریکر (تکی)", callback_data: "play_bricks_solo" }
        ],
        [
          { text: "👥 بازی با دوست", callback_data: "play_friend" }
        ],
        [
          { text: "🏆 بازی در گروه", callback_data: "play_group" }
        ]
      ]
    }
  });
}

/* ---------------------------------------------
   SET WEBHOOK
--------------------------------------------- */

async function setWebhook(request, env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
  if (!env.WEBHOOK_SECRET) return json({ ok: false, error: "WEBHOOK_SECRET is missing" }, 500);

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (secret !== env.WEBHOOK_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);

  const result = await telegram(env, "setWebhook", {
    url: `${url.origin}/telegram/webhook`,
    allowed_updates: ["message", "callback_query", "inline_query"]
  });
  return json(result);
}

async function getWebhookInfo(env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
  return json(await telegram(env, "getWebhookInfo", {}));
}

/* ---------------------------------------------
   BEST-SCORE HISTORY (per-group records in KV)
   Key:
     best:{chatKey}:{game}:{userId} -> {uid, n, s, t}
   chatKey "0" is used for inline messages (no chat).
   A score is forwarded to Telegram only when it beats
   the player's own record, so the game message's native
   "Top Players" list always shows best scores.
--------------------------------------------- */

const bestKey = (chatKey, slug, uid) => `best:${chatKey}:${slug}:${uid}`;

async function readBest(env, chatKey, slug, uid) {
  try {
    const raw = await env.SCORES.get(bestKey(chatKey, slug, uid));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || !Number.isFinite(rec.s)) return null;
    return rec;
  } catch {
    return null;
  }
}

// Display name comes from Telegram itself, not from the client.
async function resolveName(env, chatId, userId, fallback) {
  const clean = (v) => (v ? String(v).slice(0, 64) : "") || "بازیکن";
  if (!Number.isFinite(chatId)) return clean(fallback);
  try {
    const res = await telegram(env, "getChatMember", { chat_id: chatId, user_id: userId });
    const u = res && res.result && res.result.user;
    if (u && u.first_name) {
      const full = (u.first_name + (u.last_name ? " " + u.last_name : "")).trim();
      if (full) return full.slice(0, 64);
    }
  } catch {
    // fall through to fallback
  }
  return clean(fallback);
}

// Stores the score only when it beats the player's own record.
async function recordBest(env, chatKey, slug, uid, score, name) {
  const prev = await readBest(env, chatKey, slug, uid);
  if (prev && score <= prev.s) return { isRecord: false, best: prev.s };
  const rec = { uid, n: name, s: score, t: Date.now() };
  await env.SCORES.put(bestKey(chatKey, slug, uid), JSON.stringify(rec));
  return { isRecord: true, best: score };
}

async function submitScore(request, env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);

  let data;
  try {
    data = request.method === "POST" ? await request.json() : Object.fromEntries(new URL(request.url).searchParams);
  } catch {
    return json({ ok: false, error: "Invalid body" }, 400);
  }

  const score = Math.floor(Number(data.score));
  const userId = Number(data.uid);
  if (!Number.isFinite(score) || score < 0 || !Number.isFinite(userId)) {
    return json({ ok: false, error: "Invalid score or user" }, 400);
  }

  const slug = gameSlug(data.game);
  const chatId = Number(data.cid);
  const chatKey = Number.isFinite(chatId) ? String(chatId) : "0";
  const messageId = Number(data.mid);

  // Persistent per-group record: only a new personal best is stored
  // and forwarded to Telegram. Lower scores are ignored.
  let stored = null;
  if (env.SCORES) {
    try {
      const name = await resolveName(env, chatId, userId, data.name);
      stored = await recordBest(env, chatKey, slug, userId, score, name);
    } catch (e) {
      console.error("leaderboard store failed:", e);
      stored = null;
    }
  }

  if (stored && !stored.isRecord) {
    return json({ ok: true, isRecord: false, best: stored.best, stored: true });
  }

  const body = {
    user_id: userId,
    score,
    force: false,
    disable_edit_message: false
  };

  if (data.imid) body.inline_message_id = String(data.imid);
  else if (Number.isFinite(chatId) && Number.isFinite(messageId)) {
    body.chat_id = chatId;
    body.message_id = messageId;
  } else {
    return json({ ok: false, error: "Missing chat/message context" }, 400);
  }

  try {
    const result = await telegram(env, "setGameScore", body);
    // Telegram can reject the score (bad message id, invalid user, ...).
    // Surface that instead of claiming success: the client shows this status
    // on the game-over screen, so a silent rejection looks like "record saved".
    if (!result || result.ok !== true) {
      const reason = (result && (result.description || result.error)) || "Telegram rejected the score";
      return json({ ok: false, error: String(reason) }, 502);
    }
    return json({
      ok: true,
      isRecord: stored ? stored.isRecord : true,
      best: stored ? stored.best : score,
      stored: Boolean(stored)
    });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}

async function health(env) {
  return json({
    ok: true,
    games: [env.GAME_SHORT_NAME || "Game", "flyingbird", "tetris", "drive", "bricks_breeker"],
    worker: "ninja-fruit",
    telegramConfigured: Boolean(env.BOT_TOKEN),
    webhookConfigured: Boolean(env.WEBHOOK_SECRET),
    kvConfigured: Boolean(env.SCORES)
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") return health(env);
    if (url.pathname === "/api/set-webhook" && request.method === "GET") return setWebhook(request, env);
    if (url.pathname === "/api/webhook-info" && request.method === "GET") return getWebhookInfo(env);
    if (url.pathname === "/api/submit-score" && (request.method === "GET" || request.method === "POST")) return submitScore(request, env);

    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env, request));
        return json({ ok: true });
      } catch {
        return json({ ok: false, error: "Invalid Telegram update" }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
      
