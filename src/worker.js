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
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}


/* ---------------------------------------------
   GAME URL
--------------------------------------------- */

function getGameUrl(request, extraParams = {}) {
  const url = new URL(request.url);
  const gameUrl = new URL(`${url.origin}/`);

  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null) {
      gameUrl.searchParams.set(key, String(value));
    }
  }

  return gameUrl.toString();
}


/* ---------------------------------------------
   TELEGRAM UPDATE
--------------------------------------------- */

async function handleTelegramUpdate(update, env, request) {

  /*
   * INLINE QUERY (when user types @bot in a chat/group)
   */

  const inlineQuery = update?.inline_query;

  if (inlineQuery) {
    if (!env.GAME_SHORT_NAME) {
      return;
    }

    await telegram(env, "answerInlineQuery", {
      inline_query_id: inlineQuery.id,
      results: [
        {
          type: "game",
          id: "1",
          game_short_name: env.GAME_SHORT_NAME
        }
      ],
      cache_time: 30,
      is_personal: false
    });

    return;
  }


  /*
   * CALLBACK QUERY (buttons + Play button)
   */

  const callback = update?.callback_query;

  if (callback) {

    // Play Game button from game message
    if (callback.game_short_name) {

      if (callback.game_short_name !== env.GAME_SHORT_NAME) {
        await telegram(env, "answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Game not found.",
          show_alert: true
        });
        return;
      }

      const params = {
        uid: callback.from?.id,
        cid: callback.message?.chat?.id,
        mid: callback.message?.message_id
      };

      if (callback.inline_message_id) {
        params.imid = callback.inline_message_id;
      }

      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        url: getGameUrl(request, params),
        cache_time: 0
      });

      return;
    }

    // Menu buttons
    const data = callback.data;

    if (data === "play_solo") {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id
      });

      await telegram(env, "sendGame", {
        chat_id: callback.message.chat.id,
        game_short_name: env.GAME_SHORT_NAME
      });

      return;
    }

    if (data === "play_friend") {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "یک دوست را انتخاب کن و بازی را برایش بفرست 👇",
        show_alert: false
      });

      // Send a message that can be forwarded / shared
      await telegram(env, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: "⚔️ *چالش با دوست*\n\nروی دکمه زیر بزن و یک دوست را انتخاب کن تا بازی را برایش بفرستی:",
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📤 ارسال به دوست",
                switch_inline_query: "ninja"
              }
            ]
          ]
        }
      });

      return;
    }

    if (data === "play_group") {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id
      });

      await telegram(env, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: "👥 *بازی در گروه*\n\n۱. به گروه مورد نظرت برو\n۲. تایپ کن: `@gameifyrbot`\n۳. کارت بازی را انتخاب کن و بفرست\n\nبعد همه اعضای گروه می‌توانند بازی کنند و جدول امتیازات مخصوص همان گروه ساخته می‌شود.",
        parse_mode: "Markdown"
      });

      return;
    }
  }


  /*
   * NORMAL MESSAGE
   */

  const message = update?.message;

  if (!message?.text) {
    return;
  }

  const text = message.text.trim().toLowerCase();
  const botUsername = (env.BOT_USERNAME || "").toLowerCase();

  const commands = [
    "/start",
    "/game",
    "/ninja",
    `/start@${botUsername}`,
    `/game@${botUsername}`,
    `/ninja@${botUsername}`
  ];

  if (!commands.includes(text)) {
    return;
  }

  if (!env.GAME_SHORT_NAME) {
    return;
  }

  // Show main menu with 3 buttons
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: "🥷 *Ninja Fruit*\n\nمیوه‌ها را ببر، از بمب‌ها فرار کن!\n\nیکی از حالت‌های زیر را انتخاب کن:",
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎮 بازی تکی", callback_data: "play_solo" }
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

  if (!env.BOT_TOKEN) {
    return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
  }

  if (!env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "WEBHOOK_SECRET is missing" }, 500);
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (secret !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const webhookUrl = `${url.origin}/telegram/webhook`;

  const result = await telegram(env, "setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query", "inline_query"]
  });

  return json(result);
}


/* ---------------------------------------------
   WEBHOOK INFO
--------------------------------------------- */

async function getWebhookInfo(env) {

  if (!env.BOT_TOKEN) {
    return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
  }

  const result = await telegram(env, "getWebhookInfo", {});
  return json(result);
}


/* ---------------------------------------------
   SUBMIT SCORE
--------------------------------------------- */

async function submitScore(request, env) {
  if (!env.BOT_TOKEN) {
    return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
  }

  let data;
  try {
    if (request.method === "POST") {
      data = await request.json();
    } else {
      const url = new URL(request.url);
      data = {
        score: Number(url.searchParams.get("score")),
        uid: Number(url.searchParams.get("uid")),
        cid: url.searchParams.get("cid"),
        mid: url.searchParams.get("mid"),
        imid: url.searchParams.get("imid")
      };
    }
  } catch {
    return json({ ok: false, error: "Invalid body" }, 400);
  }

  const score = Number(data.score);
  const userId = Number(data.uid);

  if (!Number.isFinite(score) || score < 0 || !Number.isFinite(userId)) {
    return json({ ok: false, error: "Invalid score or user" }, 400);
  }

  const body = {
    user_id: userId,
    score: Math.floor(score),
    force: true,
    disable_edit_message: false
  };

  if (data.imid) {
    body.inline_message_id = String(data.imid);
  } else if (data.cid && data.mid) {
    body.chat_id = Number(data.cid);
    body.message_id = Number(data.mid);
  } else {
    return json({ ok: false, error: "Missing chat/message context" }, 400);
  }

  try {
    const result = await telegram(env, "setGameScore", body);
    return json({ ok: true, result });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}


/* ---------------------------------------------
   HEALTH
--------------------------------------------- */

async function health(env) {
  return json({
    ok: true,
    game: env.GAME_SHORT_NAME || null,
    worker: "ninja-fruit",
    telegramConfigured: Boolean(env.BOT_TOKEN),
    webhookConfigured: Boolean(env.WEBHOOK_SECRET)
  });
}


/* ---------------------------------------------
   MAIN WORKER
--------------------------------------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return health(env);
    }

    if (url.pathname === "/api/set-webhook" && request.method === "GET") {
      return setWebhook(request, env);
    }

    if (url.pathname === "/api/webhook-info" && request.method === "GET") {
      return getWebhookInfo(env);
    }

    if (url.pathname === "/api/submit-score" && (request.method === "GET" || request.method === "POST")) {
      return submitScore(request, env);
    }

    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env, request));
        return json({ ok: true });
      } catch (error) {
        return json({ ok: false, error: "Invalid Telegram update" }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
