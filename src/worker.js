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

  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return res.json();
}

function gameUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/`;
}

/* ---------------------------------------------
   TELEGRAM UPDATE
--------------------------------------------- */

async function handleTelegramUpdate(update, env, request) {

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
     * Tell Telegram where the HTML5 game is.
     */

    await telegram(env, "answerCallbackQuery", {
      callback_query_id: callback.id,
      url: gameUrl(request),
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

  const text = message.text.trim().toLowerCase();

  const botUsername =
    (env.BOT_USERNAME || "").toLowerCase();

  const commands = [
    "/start",
    "/game",
    "/ninja",
    `/game@${botUsername}`,
    `/ninja@${botUsername}`,
    `/start@${botUsername}`
  ];

  if (!commands.includes(text)) {
    return;
  }

  if (!env.GAME_SHORT_NAME) {
    return;
  }


  /*
   * SEND GAME MESSAGE
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

  const url = new URL(request.url);

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

  const result = await telegram(
    env,
    "setWebhook",
    {
      url: webhookUrl,

      allowed_updates: [
        "message",
        "callback_query"
      ]
    }
  );

  return json(result);
}


/* ---------------------------------------------
   WEBHOOK INFO
--------------------------------------------- */

async function webhookInfo(env) {

  const result =
    await telegram(
      env,
      "getWebhookInfo",
      {}
    );

  return json(result);
}


/* ---------------------------------------------
   HEALTH
--------------------------------------------- */

async function health(env) {

  return json({
    ok: true,
    game: env.GAME_SHORT_NAME || null,
    worker: "ninja-fruit",
    telegramConfigured: Boolean(env.BOT_TOKEN)
  });
}


/* ---------------------------------------------
   MAIN WORKER
--------------------------------------------- */

export default {

  async fetch(request, env, ctx) {

    const url =
      new URL(request.url);


    /*
     * HEALTH
     */

    if (
      url.pathname === "/api/health" &&
      request.method === "GET"
    ) {
      return health(env);
    }


    /*
     * SET WEBHOOK
     */

    if (
      url.pathname === "/api/set-webhook" &&
      request.method === "GET"
    ) {
      return setWebhook(request, env);
    }


    /*
     * WEBHOOK INFO
     */

    if (
      url.pathname === "/api/webhook-info" &&
      request.method === "GET"
    ) {
      return webhookInfo(env);
    }


    /*
     * TELEGRAM WEBHOOK
     */

    if (
      url.pathname === "/telegram/webhook" &&
      request.method === "POST"
    ) {

      try {

        const update =
          await request.json();

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
            error: "Invalid Telegram update"
          },
          400
        );
      }
    }


    /*
     * GAME FILES
     */

    return env.ASSETS.fetch(request);
  }
};
