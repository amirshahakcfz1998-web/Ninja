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
   * USER PRESSED PLAY
   */

  const callback = update?.callback_query;

  if (callback?.game_short_name) {

    if (
      callback.game_short_name !==
      env.GAME_SHORT_NAME
    ) {

      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Game not found.",
        show_alert: true
      });

      return;
    }

    /*
     * Open Ninja Fruit with context for high scores.
     */

    const params = {
      uid: callback.from?.id,
      cid: callback.message?.chat?.id,
      mid: callback.message?.message_id
    };

    // If it was an inline message
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


  /*
   * NORMAL MESSAGE
   */

  const message = update?.message;

  if (!message?.text) {
    return;
  }

  const text =
    message.text.trim().toLowerCase();

  const botUsername =
    (env.BOT_USERNAME || "").toLowerCase();


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


  /*
   * SEND GAME
   */

  await telegram(env, "sendGame", {
    chat_id: message.chat.id,
    game_short_name: env.GAME_SHORT_NAME,

    reply_parameters: {
      message_id: message.message_id
    },

    protect_content: false
  });
}


/* ---------------------------------------------
   SET WEBHOOK
--------------------------------------------- */

async function setWebhook(request, env) {

  if (!env.BOT_TOKEN) {
    return json(
      {
        ok: false,
        error: "BOT_TOKEN is missing"
      },
      500
    );
  }


  if (!env.WEBHOOK_SECRET) {
    return json(
      {
        ok: false,
        error: "WEBHOOK_SECRET is missing"
      },
      500
    );
  }


  const url =
    new URL(request.url);

  const secret =
    url.searchParams.get("secret");


  if (secret !== env.WEBHOOK_SECRET) {
    return json(
      {
        ok: false,
        error: "Unauthorized"
      },
      401
    );
  }


  const webhookUrl =
    `${url.origin}/telegram/webhook`;


  const result =
    await telegram(
      env,
      "setWebhook",
      {
        url: webhookUrl,

        allowed_updates: [
          "message",
          "callback_query",
          "inline_query"
        ]
      }
    );


  return json(result);
}


/* ---------------------------------------------
   WEBHOOK INFO
--------------------------------------------- */

async function getWebhookInfo(env) {

  if (!env.BOT_TOKEN) {
    return json(
      {
        ok: false,
        error: "BOT_TOKEN is missing"
      },
      500
    );
  }


  const result =
    await telegram(
      env,
      "getWebhookInfo",
      {}
    );


  return json(result);
}


/* ---------------------------------------------
   SUBMIT SCORE (for group leaderboards)
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
    force: false,
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

    game:
      env.GAME_SHORT_NAME || null,

    worker:
      "ninja-fruit",

    telegramConfigured:
      Boolean(env.BOT_TOKEN),

    webhookConfigured:
      Boolean(env.WEBHOOK_SECRET)
  });
}


/* ---------------------------------------------
   MAIN WORKER
--------------------------------------------- */

export default {

  async fetch(request, env, ctx) {

    const url =
      new URL(request.url);


    /* HEALTH */

    if (
      url.pathname === "/api/health" &&
      request.method === "GET"
    ) {
      return health(env);
    }


    /* SET WEBHOOK */

    if (
      url.pathname === "/api/set-webhook" &&
      request.method === "GET"
    ) {
      return setWebhook(request, env);
    }


    /* WEBHOOK INFO */

    if (
      url.pathname === "/api/webhook-info" &&
      request.method === "GET"
    ) {
      return getWebhookInfo(env);
    }


    /* SUBMIT SCORE */

    if (
      url.pathname === "/api/submit-score" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      return submitScore(request, env);
    }


    /* TELEGRAM WEBHOOK */

    if (
      url.pathname === "/telegram/webhook" &&
      request.method === "POST"
    ) {

      try {

        const update =
          await request.json();


        /*
         * Respond quickly to Telegram.
         */

        ctx.waitUntil(
          handleTelegramUpdate(
            update,
            env,
            request
          )
        );


        return json({
          ok: true
        });

      } catch (error) {

        return json(
          {
            ok: false,
            error:
              "Invalid Telegram update"
          },
          400
        );
      }
    }


    /* STATIC GAME */

    return env.ASSETS.fetch(request);
  }
};
