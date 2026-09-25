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

function appUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/`;
}

/* -------------------------------------------------------
   TELEGRAM UPDATE HANDLER
------------------------------------------------------- */

async function handleTelegramUpdate(update, env, request) {

  /* ---------------------------------------------
     1. GAME PLAY BUTTON
     --------------------------------------------- */

  const callback = update?.callback_query;

  if (callback?.game_short_name) {

    if (callback.game_short_name !== env.GAME_SHORT_NAME) {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Game not found.",
        show_alert: true
      });

      return { ok: false };
    }

    /*
      This is the critical part.

      Telegram opens this URL when the user
      presses the Play button.
    */

    const gameUrl = appUrl(request);

    const result = await telegram(env, "answerCallbackQuery", {
      callback_query_id: callback.id,
      url: gameUrl,
      cache_time: 0
    });

    return result;
  }


  /* ---------------------------------------------
     2. NORMAL TELEGRAM MESSAGES
     --------------------------------------------- */

  const message = update?.message;

  if (!message?.text) {
    return { ok: true };
  }

  const text = message.text.trim().toLowerCase();

  const botUsername =
    (env.BOT_USERNAME || "").toLowerCase();

  const commands = [
    "/game",
    `/game@${botUsername}`,
    "/ninja",
    `/ninja@${botUsername}`,
    "/start"
  ];

  if (!commands.includes(text)) {
    return { ok: true };
  }

  if (!env.BOT_TOKEN || !env.GAME_SHORT_NAME) {
    return {
      ok: false,
      error: "Missing BOT_TOKEN or GAME_SHORT_NAME"
    };
  }


  /* ---------------------------------------------
     3. SEND NINJA FRUIT GAME
     --------------------------------------------- */

  const result = await telegram(env, "sendGame", {
    chat_id: message.chat.id,
    game_short_name: env.GAME_SHORT_NAME,

    reply_parameters: {
      message_id: message.message_id
    },

    protect_content: false
  });

  return result;
}


/* -------------------------------------------------------
   SET WEBHOOK
------------------------------------------------------- */

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

  const url = new URL(request.url);

  const secret = url.searchParams.get("secret");

  /*
    Do NOT expose your BOT_TOKEN in the URL.
    Use a separate WEBHOOK_SECRET.
  */

  if (!env.WEBHOOK_SECRET) {
    return json(
      {
        ok: false,
        error: "WEBHOOK_SECRET is missing"
      },
      500
    );
  }

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

  const result = await telegram(env, "setWebhook", {
    url: webhookUrl,

    allowed_updates: [
      "message",
      "callback_query"
    ]
  });

  return json(result);
}


/* -------------------------------------------------------
   GET WEBHOOK INFO
------------------------------------------------------- */

async function getWebhookInfo(env) {

  const result =
    await telegram(env, "getWebhookInfo", {});

  return json(result);
}


/* -------------------------------------------------------
   TELEGRAM GAME SCORE
------------------------------------------------------- */

async function setGameScore(request, env) {

  if (!env.BOT_TOKEN) {
    return json(
      {
        ok: false,
        error: "BOT_TOKEN is missing"
      },
      500
    );
  }

  try {

    const body = await request.json();

    const {
      user_id,
      score,
      chat_id,
      message_id
    } = body;

    if (
      !user_id ||
      !Number.isInteger(score) ||
      score < 0
    ) {
      return json(
        {
          ok: false,
          error: "Invalid user_id or score"
        },
        400
      );
    }

    if (
      !chat_id ||
      !message_id
    ) {
      return json(
        {
          ok: false,
          error: "chat_id and message_id are required"
        },
        400
      );
    }

    /*
      Telegram requires the score to be
      associated with the original game message.
    */

    const result = await telegram(
      env,
      "setGameScore",
      {
        user_id: Number(user_id),
        score: Number(score),
        chat_id: chat_id,
        message_id: Number(message_id),

        /*
          Telegram will update the game message
          with the current leaderboard.
        */
        disable_edit_message: false
      }
    );

    return json(result);

  } catch (error) {

    return json(
      {
        ok: false,
        error: "Invalid score request"
      },
      400
    );
  }
}


/* -------------------------------------------------------
   GAME LEADERBOARD
------------------------------------------------------- */

async function getGameHighScores(request, env) {

  const url = new URL(request.url);

  const userId =
    url.searchParams.get("user_id");

  const chatId =
    url.searchParams.get("chat_id");

  const messageId =
    url.searchParams.get("message_id");

  if (
    !userId ||
    !chatId ||
    !messageId
  ) {
    return json(
      {
        ok: false,
        error:
          "user_id, chat_id and message_id are required"
      },
      400
    );
  }

  const result = await telegram(
    env,
    "getGameHighScores",
    {
      user_id: Number(userId),
      chat_id: chatId,
      message_id: Number(messageId)
    }
  );

  return json(result);
}


/* -------------------------------------------------------
   HEALTH
------------------------------------------------------- */

async function health(env) {

  return json({
    ok: true,
    game: env.GAME_SHORT_NAME || null,
    worker: "ninja-fruit",
    telegram: Boolean(env.BOT_TOKEN)
  });
}


/* -------------------------------------------------------
   MAIN WORKER
------------------------------------------------------- */

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


    /* SET GAME SCORE */

    if (
      url.pathname === "/api/set-score" &&
      request.method === "POST"
    ) {
      return setGameScore(request, env);
    }


    /* GET GAME HIGH SCORES */

    if (
      url.pathname === "/api/leaderboard" &&
      request.method === "GET"
    ) {
      return getGameHighScores(request, env);
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
          Respond immediately to Telegram.
          Process the update in background.
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
            error: "Invalid Telegram update"
          },
          400
        );
      }
    }


    /* STATIC GAME */

    return env.ASSETS.fetch(request);
  }
};
