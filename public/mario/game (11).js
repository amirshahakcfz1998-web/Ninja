"use strict";
/* Super Mario-style platformer — Telegram game (short name: mario).
   Original code & art inspired by classic 8-bit platformers; no Nintendo
   assets used. Higher jump per user request (hold jump = higher).
   Pure logic in Mario (testable in node); browser code in browserBoot(). */

// Error trap: surface script errors on the start card (debug aid).
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  function show(msg) {
    try {
      var t = document.getElementById("cardTitle");
      var x = document.getElementById("cardText");
      var card = document.getElementById("card");
      if (t) t.textContent = "خطا";
      if (x) x.innerHTML = '<span style="color:#f87171">خطا: ' + String(msg).slice(0, 300) + "</span>";
      if (card) card.classList.add("show");
    } catch (_) {}
  }
  window.addEventListener("error", function (e) { show(e.message || e.error); });
})();

var Mario = (function () {
  "use strict";

  var TILE = 32;
  var VIEW_W = 800, VIEW_H = 448;
  var ROWS = 14, LEVEL_W = 214;

  // Physics (dt-based, 60fps reference). Jump tuned HIGH per user request.
  var GRAV = 2400, HOLD_GRAV = 1500, JUMP_V = 800;
  var MAX_FALL = 950;
  var WALK_ACCEL = 2000, AIR_ACCEL = 1500, FRICTION = 2400;
  var WALK_MAX = 175, RUN_MAX = 285;

  // Tiles: 0 empty, 1 ground, 2 brick, 3 ?coin, 4 ?mushroom, 5 used,
  //        6 pipe (solid), 7 stair, 8 flagpole (trigger), 9 flag base (solid)
  function isSolid(t) {
    return t === 1 || t === 2 || t === 3 || t === 4 || t === 5 || t === 6 || t === 7 || t === 9;
  }
  function tileAt(grid, tx, ty) {
    if (tx < 0) return 1;
    if (tx >= LEVEL_W || ty < 0) return 0;
    if (ty >= ROWS) return 1;
    return grid[ty][tx];
  }

  function buildLevel() {
    var g = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < LEVEL_W; c++) row.push(0);
      g.push(row);
    }
    function set(c, r, t) { if (c >= 0 && c < LEVEL_W && r >= 0 && r < ROWS) g[r][c] = t; }
    function fill(c0, c1, r0, r1, t) {
      for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) set(c, r, t);
    }

    // Ground rows 11-13 with gaps.
    var gaps = [[58, 59], [70, 72], [140, 141], [145, 147]];
    function inGap(c) {
      for (var i = 0; i < gaps.length; i++) if (c >= gaps[i][0] && c <= gaps[i][1]) return true;
      return false;
    }
    for (var c = 0; c < LEVEL_W; c++) {
      if (!inGap(c)) fill(c, c, 11, 13, 1);
    }

    // Question blocks & bricks (row 7).
    set(16, 7, 3);
    set(20, 7, 2); set(21, 7, 3); set(22, 7, 2); set(23, 7, 4); set(24, 7, 2);
    set(78, 7, 3); set(78, 3, 3);
    set(94, 7, 2); set(95, 7, 3); set(96, 7, 2);
    set(128, 7, 3); set(130, 7, 2); set(132, 7, 3);

    // Pipes: [x, height]
    var pipes = [[28, 2], [36, 3], [44, 4], [120, 2]];
    for (var p = 0; p < pipes.length; p++) {
      var px = pipes[p][0], ph = pipes[p][1];
      fill(px, px + 1, 11 - ph, 10, 6);
    }

    // Stairs up 1..4 at x=86..89, then down.
    for (var s = 0; s < 4; s++) fill(86 + s, 86 + s, 10 - s, 10, 7);
    for (var s2 = 0; s2 < 4; s2++) fill(92 + s2, 92 + s2, 7 + s2, 10, 7);
    // Big end stairs 1..8 at x=176..183.
    for (var s3 = 0; s3 < 8; s3++) fill(176 + s3, 176 + s3, 10 - s3, 10, 7);

    // Flagpole at x=186, rows 1..10; solid base.
    for (var fr = 1; fr <= 10; fr++) set(186, fr, 8);
    set(186, 10, 9);

    // Floating coins: list of {c, r}.
    var coins = [];
    function coinRow(c0, c1, r) { for (var c = c0; c <= c1; c++) coins.push({ c: c, r: r }); }
    coinRow(69, 73, 5);
    coinRow(112, 116, 6);
    coinRow(139, 148, 4);
    coins.push({ c: 16, r: 4 }, { c: 78, r: 1 });

    // Enemy spawns: {x (tiles, float), type: 'goomba'|'koopa'}.
    var enemies = [
      { x: 22.5, type: "goomba" }, { x: 40, type: "goomba" }, { x: 51, type: "goomba" },
      { x: 52.5, type: "goomba" }, { x: 82, type: "goomba" }, { x: 104, type: "koopa" },
      { x: 108, type: "koopa" }, { x: 134, type: "goomba" }, { x: 152, type: "goomba" },
      { x: 161, type: "goomba" }, { x: 163, type: "goomba" }, { x: 165, type: "goomba" },
      { x: 168, type: "koopa" }
    ];

    return { grid: g, coins: coins, enemies: enemies, flagX: 186 * TILE, castleX: 196 * TILE };
  }

  // AABB vs tilemap, swept (no tunneling even on large steps).
  // e: {x,y,w,h,vx,vy}. Mutates e. Returns collision flags.
  function moveAndCollide(e, dt, grid) {
    var res = { hitLeft: false, hitRight: false, landed: false, hitHead: false, headTX: -1, headTY: -1 };
    var T = TILE;
    // X axis.
    var newX = e.x + e.vx * dt;
    var y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 1) / T);
    if (e.vx > 0) {
      var tx0 = Math.floor((e.x + e.w) / T), tx1 = Math.floor((newX + e.w) / T);
      var hx = -1;
      for (var tx = tx0; tx <= tx1 && hx < 0; tx++)
        for (var ty = y0; ty <= y1; ty++)
          if (isSolid(tileAt(grid, tx, ty))) { hx = tx; break; }
      if (hx >= 0) { e.x = hx * T - e.w - 0.01; e.vx = 0; res.hitRight = true; }
      else e.x = newX;
    } else if (e.vx < 0) {
      var tx0b = Math.floor(e.x / T), tx1b = Math.floor(newX / T);
      var hx2 = -1;
      for (var txb = tx0b; txb >= tx1b && hx2 < 0; txb--)
        for (var tyb = y0; tyb <= y1; tyb++)
          if (isSolid(tileAt(grid, txb, tyb))) { hx2 = txb; break; }
      if (hx2 >= 0) { e.x = (hx2 + 1) * T + 0.01; e.vx = 0; res.hitLeft = true; }
      else e.x = newX;
    } else { e.x = newX; }
    // Y axis.
    var newY = e.y + e.vy * dt;
    var x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 1) / T);
    if (e.vy > 0) {
      var ty0 = Math.floor((e.y + e.h) / T), ty1 = Math.floor((newY + e.h) / T);
      var hy = -1;
      for (var tyy = ty0; tyy <= ty1 && hy < 0; tyy++)
        for (var txx = x0; txx <= x1; txx++)
          if (isSolid(tileAt(grid, txx, tyy))) { hy = tyy; break; }
      if (hy >= 0) { e.y = hy * T - e.h; e.vy = 0; res.landed = true; }
      else e.y = newY;
    } else if (e.vy < 0) {
      var ty0b = Math.floor(e.y / T), ty1b = Math.floor(newY / T);
      var tcx = Math.floor((e.x + e.w / 2) / T);
      var hy2 = -1, htx = -1;
      for (var tyy2 = ty0b; tyy2 >= ty1b && hy2 < 0; tyy2--) {
        if (isSolid(tileAt(grid, tcx, tyy2))) { hy2 = tyy2; htx = tcx; break; }
      }
      if (hy2 < 0) {
        for (var tyy3 = ty0b; tyy3 >= ty1b && hy2 < 0; tyy3--)
          for (var txx2 = x0; txx2 <= x1; txx2++)
            if (isSolid(tileAt(grid, txx2, tyy3))) { hy2 = tyy3; htx = txx2; break; }
      }
      if (hy2 >= 0) {
        e.y = (hy2 + 1) * T + 0.01; e.vy = 0;
        res.hitHead = true; res.headTX = htx; res.headTY = hy2;
      } else e.y = newY;
    } else { e.y = newY; }
    return res;
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  var SCORE = { coin: 100, stomp: 200, block: 50, mushroom: 500, flag: 1000, timeBonus: 10 };

  return {
    TILE: TILE, VIEW_W: VIEW_W, VIEW_H: VIEW_H, ROWS: ROWS, LEVEL_W: LEVEL_W,
    GRAV: GRAV, HOLD_GRAV: HOLD_GRAV, JUMP_V: JUMP_V, MAX_FALL: MAX_FALL,
    WALK_ACCEL: WALK_ACCEL, AIR_ACCEL: AIR_ACCEL, FRICTION: FRICTION,
    WALK_MAX: WALK_MAX, RUN_MAX: RUN_MAX, SCORE: SCORE,
    isSolid: isSolid, tileAt: tileAt, buildLevel: buildLevel,
    moveAndCollide: moveAndCollide, aabb: aabb
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Mario;

/* ================= BROWSER ================= */
(function browserBoot() {
  if (typeof document === "undefined") return;
  var D = Mario;

  // ---------- DOM ----------
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var coinsEl = document.getElementById("coins");
  var livesEl = document.getElementById("lives");
  var timeEl = document.getElementById("time");
  var muteBtn = document.getElementById("muteBtn");
  var pauseBtn = document.getElementById("pauseBtn");
  var card = document.getElementById("card");
  var cardTitle = document.getElementById("cardTitle");
  var cardText = document.getElementById("cardText");
  var cardButtons = document.getElementById("cardButtons");
  var leftBtn = document.getElementById("leftBtn");
  var rightBtn = document.getElementById("rightBtn");
  var jumpBtn = document.getElementById("jumpBtn");
  var runBtn = document.getElementById("runBtn");

  // ---------- HELPERS ----------
  var FA = "۰۱۲۳۴۵۶۷۸۹";
  function fa(n) { return String(n).replace(/[0-9]/g, function (d) { return FA[+d]; }); }
  function read(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---------- SOUND ----------
  var Sound = (function () {
    var ac = null, muted = read("marioMuted", "0") === "1";
    function ensure() {
      if (ac) { if (ac.state === "suspended") ac.resume(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ac = new AC();
      } catch (_) { ac = null; }
    }
    function tone(f0, f1, dur, type, vol, delay) {
      if (muted) return;
      ensure();
      if (!ac) return;
      try {
        var t = ac.currentTime + (delay || 0);
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = type || "square";
        o.frequency.setValueAtTime(Math.max(30, f0), t);
        if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
        g.gain.setValueAtTime(vol || 0.08, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (_) {}
    }
    return {
      ensure: ensure,
      jump: function () { tone(280, 680, 0.16, "square", 0.07); },
      coin: function () { tone(988, 988, 0.07, "square", 0.07); tone(1319, 1319, 0.22, "square", 0.07, 0.07); },
      stomp: function () { tone(420, 120, 0.12, "square", 0.09); },
      bump: function () { tone(140, 90, 0.1, "square", 0.09); },
      sprout: function () { tone(300, 900, 0.25, "sine", 0.08); },
      power: function () { tone(523, 523, 0.08, "square", 0.08); tone(659, 659, 0.08, "square", 0.08, 0.08); tone(784, 784, 0.14, "square", 0.08, 0.16); },
      shrink: function () { tone(600, 150, 0.3, "sawtooth", 0.08); },
      die: function () { tone(500, 80, 0.5, "square", 0.09); },
      flag: function () { var n = [523, 587, 659, 784, 880, 1046]; for (var i = 0; i < n.length; i++) tone(n[i], n[i], 0.12, "square", 0.07, i * 0.09); },
      click: function () { tone(600, 600, 0.05, "sine", 0.07); },
      toggleMute: function () { muted = !muted; store("marioMuted", muted ? "1" : "0"); return muted; },
      isMuted: function () { return muted; }
    };
  })();
  function refreshMute() { if (muteBtn) muteBtn.textContent = Sound.isMuted() ? "🔇" : "🔊"; }

  function showCard(title, html, buttons) {
    cardTitle.textContent = title;
    cardText.innerHTML = html;
    cardButtons.innerHTML = "";
    (buttons || []).forEach(function (b) {
      var btn = document.createElement("button");
      btn.textContent = b.text;
      if (b.ghost) btn.className = "ghost";
      btn.addEventListener("click", function () { Sound.ensure(); Sound.click(); b.onClick(); });
      cardButtons.appendChild(btn);
    });
    card.classList.add("show");
  }
  function hideCard() { card.classList.remove("show"); }

  // ---------- STATE ----------
  var phase = "menu"; // menu | play | win | over
  var paused = false;
  var level = null;
  var player = null;
  var enemies = [], items = [], parts = [], floats = [], coinAnims = [];
  var camX = 0;
  var score = 0, coins = 0, lives = 3, timeLeft = 300;
  var best = parseInt(read("marioBest", "0"), 10) || 0;
  var serverBest = NaN, isRecord = false;
  var input = { left: false, right: false, jump: false, jumpPressed: false, run: false };
  var coyote = 0, jumpBuf = 0, invuln = 0;
  var winT = 0, dieT = 0;
  var timeAcc = 0;

  function updateHUD() {
    scoreEl.textContent = fa(score);
    coinsEl.textContent = fa(coins);
    livesEl.textContent = fa(lives);
    timeEl.textContent = fa(Math.ceil(timeLeft));
  }

  // ---------- GAME FLOW ----------
  function newPlayer() {
    return {
      x: 2.5 * D.TILE, y: 8 * D.TILE, w: 24, h: 30,
      vx: 0, vy: 0, big: false, onGround: false, face: 1,
      animT: 0, dead: false
    };
  }

  function startLevel() {
    Sound.ensure();
    level = D.buildLevel();
    player = newPlayer();
    enemies = level.enemies.map(function (s) {
      return {
        x: s.x * D.TILE, y: 8 * D.TILE, w: 26, h: 26,
        vx: s.type === "koopa" ? -60 : -42, vy: 0,
        type: s.type, alive: true, animT: Math.random() * 2, active: false
      };
    });
    items = []; parts = []; floats = []; coinAnims = [];
    camX = 0;
    score = 0; coins = 0; lives = 3; timeLeft = 300;
    coyote = 0; jumpBuf = 0; invuln = 0; winT = 0; dieT = 0; timeAcc = 0;
    isRecord = false; paused = false;
    hideCard();
    phase = "play";
    updateHUD();
  }

  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) floats.push({ x: x, y: y, text: "+" + n, age: 0, life: 0.9 });
    updateHUD();
  }

  function burst(x, y, color, n, spread) {
    for (var i = 0; i < n; i++) {
      parts.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * (spread || 260),
        vy: -Math.random() * 320 - 60,
        age: 0, life: 0.6 + Math.random() * 0.4,
        color: color, size: 3 + Math.random() * 4
      });
    }
  }

  function hitBlock(tx, ty) {
    var t = D.tileAt(level.grid, tx, ty);
    var cx = tx * D.TILE + D.TILE / 2, topY = ty * D.TILE;
    if (t === 3) { // ? coin
      level.grid[ty][tx] = 5;
      coins++; addScore(D.SCORE.coin, cx, topY - 10);
      coinAnims.push({ x: cx, y: topY - 8, age: 0 });
      burst(cx, topY, "#fde047", 6, 160);
      Sound.coin();
    } else if (t === 4) { // ? mushroom
      level.grid[ty][tx] = 5;
      items.push({ x: tx * D.TILE + 4, y: topY - 24, w: 24, h: 24, vx: 0, vy: -260, kind: "mush", emerge: 0.9, dead: false });
      addScore(D.SCORE.block, cx, topY - 10);
      Sound.sprout();
    } else if (t === 2) { // brick
      if (player.big) {
        level.grid[ty][tx] = 0;
        addScore(D.SCORE.block, cx, topY - 10);
        burst(cx, topY + 16, "#c2703d", 10, 340);
        Sound.bump();
      } else {
        addScore(0);
        Sound.bump();
      }
    } else {
      Sound.bump();
    }
    updateHUD();
  }

  function grow() {
    if (!player.big) {
      player.big = true;
      player.h = 54; player.y -= 24;
      addScore(D.SCORE.mushroom, player.x + 12, player.y);
      burst(player.x + 12, player.y + 20, "#f87171", 10, 200);
      Sound.power();
    } else {
      addScore(D.SCORE.mushroom, player.x + 12, player.y);
      Sound.power();
    }
    updateHUD();
  }

  function hurt() {
    if (invuln > 0 || player.dead) return;
    if (player.big) {
      player.big = false;
      player.h = 30; player.y += 24;
      invuln = 2;
      Sound.shrink();
    } else {
      die();
    }
  }

  function die() {
    if (player.dead) return;
    player.dead = true;
    player.vy = -650;
    dieT = 0;
    lives--;
    Sound.die();
    updateHUD();
  }

  // ---------- SCORE SUBMIT (same protocol as other games) ----------
  async function reportScore(value) {
    var status = "n/a", rec = false;
    try {
      var params = new URLSearchParams(window.location.search);
      var uid = params.get("uid");
      var imid = params.get("imid");
      var cid = params.get("cid"), mid = params.get("mid");
      var game = params.get("game");
      try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe &&
            window.Telegram.WebApp.initDataUnsafe.user) {
          uid = String(window.Telegram.WebApp.initDataUnsafe.user.id);
        }
      } catch (_) {}
      if (uid && (imid || (cid && mid))) {
        var body = { score: value, uid: Number(uid) };
        if (game) body.game = game;
        if (imid) body.imid = imid;
        if (cid) body.cid = cid;
        if (mid) body.mid = mid;
        var res = await fetch("/api/submit-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        var data = await res.json().catch(function () { return {}; });
        if (Number.isFinite(Number(data.best))) serverBest = Number(data.best);
        rec = data.ok === true && data.isRecord === true;
        status = data.ok ? (rec ? "server-ok-record" : "server-ok") : ("server-fail:" + (data.error || res.status));
      } else {
        status = "missing-params uid=" + (uid || "null") + " imid=" + (imid || "null");
      }
    } catch (e) { status = "error:" + (e.message || "unknown"); }
    return { status: status, isRecord: rec };
  }

  async function finishRun(won) {
    var status = "n/a";
    isRecord = false;
    if (score > 0) {
      try { var r = await reportScore(score); status = r.status; isRecord = r.isRecord; }
      catch (e) { status = "error:" + (e.message || "unknown"); }
    } else { status = "skipped (zero)"; }
    if (score > best) { best = score; store("marioBest", String(best)); }
    var shownBest = Number.isFinite(serverBest) ? serverBest : best;
    var recordLine = isRecord ? "🎉 <b>رکورد جدید!</b><br>" : "";
    showCard(
      won ? "🏁 مرحله تمام شد!" : "💥 بازی تمام شد",
      "امتیاز: <b>" + fa(score) + "</b><br>" +
      "سکه: <b>" + fa(coins) + "</b> 🪙<br>" +
      "رکورد: <b>" + fa(shownBest) + "</b><br>" +
      recordLine +
      '<br><small style="opacity:.65">' + esc(status) + "</small>",
      [{ text: "🔄 دوباره بازی", onClick: startLevel }]
    );
    updateHUD();
  }

  // ---------- UPDATE ----------
  function updatePlayer(dt) {
    var p = player;
    if (p.dead) {
      dieT += dt;
      p.vy = Math.min(p.vy + D.GRAV * dt, D.MAX_FALL);
      p.y += p.vy * dt;
      if (dieT > 1.6) {
        if (lives > 0) {
          // Respawn at start, keep score/coins.
          var keepScore = score, keepCoins = coins, keepLives = lives;
          var keepTime = timeLeft;
          level = D.buildLevel();
          player = newPlayer();
          enemies = level.enemies.map(function (s) {
            return { x: s.x * D.TILE, y: 8 * D.TILE, w: 26, h: 26, vx: s.type === "koopa" ? -60 : -42, vy: 0, type: s.type, alive: true, animT: 0, active: false };
          });
          items = []; parts = []; floats = []; coinAnims = [];
          camX = 0; invuln = 2;
          score = keepScore; coins = keepCoins; lives = keepLives; timeLeft = keepTime;
          updateHUD();
        } else {
          phase = "over";
          finishRun(false);
        }
      }
      return;
    }

    // Win sequence: slide down pole, walk to castle.
    if (phase === "win") {
      winT += dt;
      if (winT < 1.2) {
        p.y += 260 * dt;
        var baseY = 10 * D.TILE - p.h;
        if (p.y > baseY) p.y = baseY;
      } else {
        p.x += 120 * dt;
        p.animT += dt * 8;
        if (p.x > level.castleX + 40) {
          addScore(Math.ceil(timeLeft) * D.SCORE.timeBonus);
          phase = "over";
          finishRun(true);
        }
      }
      return;
    }

    // Horizontal.
    var max = input.run ? D.RUN_MAX : D.WALK_MAX;
    var acc = p.onGround ? D.WALK_ACCEL : D.AIR_ACCEL;
    if (input.left && !input.right) {
      p.vx = Math.max(p.vx - acc * dt, -max);
      p.face = -1;
    } else if (input.right && !input.left) {
      p.vx = Math.min(p.vx + acc * dt, max);
      p.face = 1;
    } else if (p.onGround) {
      var f = D.FRICTION * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }
    p.animT += dt * (2 + Math.abs(p.vx) / 40);

    // Jump: buffer + coyote + variable height (HIGH jump).
    if (p.onGround) coyote = 0.09; else coyote -= dt;
    if (input.jumpPressed) { jumpBuf = 0.12; input.jumpPressed = false; }
    else jumpBuf -= dt;
    if (jumpBuf > 0 && coyote > 0) {
      p.vy = -D.JUMP_V;
      p.onGround = false;
      coyote = 0; jumpBuf = 0;
      Sound.jump();
    }
    // Variable height: holding jump = weaker gravity (higher jump).
    var g = (input.jump && p.vy < 0) ? D.HOLD_GRAV : D.GRAV;
    p.vy = Math.min(p.vy + g * dt, D.MAX_FALL);

    var wasGround = p.onGround;
    var res = D.moveAndCollide(p, dt, level.grid);
    p.onGround = res.landed;
    if (res.hitHead) hitBlock(res.headTX, res.headTY);
    if (!wasGround && p.onGround && p.vy === 0) { /* landed */ }
    if (invuln > 0) invuln -= dt;

    // Fell in a pit.
    if (p.y > D.VIEW_H + 80) { die(); return; }

    // Flagpole reached?
    if (p.x + p.w > level.flagX && phase === "play") {
      phase = "win";
      winT = 0;
      p.vx = 0;
      var hgt = clamp(Math.round((10 * D.TILE - p.y) / D.TILE), 0, 9);
      addScore(D.SCORE.flag + hgt * 100, p.x, p.y);
      Sound.flag();
      return;
    }

    // Camera.
    var target = clamp(p.x + p.w / 2 - D.VIEW_W * 0.42, 0, D.LEVEL_W * D.TILE - D.VIEW_W);
    camX += (target - camX) * Math.min(1, dt * 8);
  }

  function updateEnemies(dt) {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      // Activate near camera.
      if (!e.active) {
        if (e.x < camX + D.VIEW_W + 60) e.active = true;
        else continue;
      }
      if (e.x < camX - 120 || e.x > camX + D.VIEW_W + 200) continue;
      e.animT += dt * 6;
      e.vy = Math.min(e.vy + D.GRAV * dt, D.MAX_FALL);
      var res = D.moveAndCollide(e, dt, level.grid);
      if (res.hitLeft) e.vx = Math.abs(e.vx);
      if (res.hitRight) e.vx = -Math.abs(e.vx);
      if (e.y > D.VIEW_H + 120) e.alive = false;

      // Player interaction.
      if (player.dead || phase !== "play") continue;
      if (D.aabb(player, e)) {
        var stomp = player.vy > 60 && (player.y + player.h - e.y) < e.h * 0.6;
        if (stomp) {
          e.alive = false;
          addScore(D.SCORE.stomp, e.x + 13, e.y);
          burst(e.x + 13, e.y + 10, e.type === "koopa" ? "#4ade80" : "#a16207", 8, 220);
          player.vy = input.jump ? -620 : -420;
          player.onGround = false;
          Sound.stomp();
        } else {
          hurt();
        }
      }
    }
  }

  function updateItems(dt) {
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      if (it.dead) { items.splice(i, 1); continue; }
      if (it.emerge > 0) {
        it.emerge -= dt;
        it.y -= 26 * dt;
        if (it.emerge <= 0) it.vx = 75;
        continue;
      }
      it.vy = Math.min(it.vy + D.GRAV * dt, D.MAX_FALL);
      var res = D.moveAndCollide(it, dt, level.grid);
      if (res.hitLeft) it.vx = Math.abs(it.vx);
      if (res.hitRight) it.vx = -Math.abs(it.vx);
      if (it.y > D.VIEW_H + 120) { it.dead = true; continue; }
      if (!player.dead && phase === "play" && D.aabb(player, it)) {
        it.dead = true;
        grow();
      }
    }
    // Floating coins.
    var cg = level.coins;
    for (var k = cg.length - 1; k >= 0; k--) {
      var cn = cg[k];
      var cr = { x: cn.c * D.TILE + 6, y: cn.r * D.TILE + 6, w: 20, h: 20 };
      if (D.aabb(player, cr)) {
        cg.splice(k, 1);
        coins++;
        addScore(D.SCORE.coin, cr.x + 10, cr.y);
        coinAnims.push({ x: cr.x + 10, y: cr.y, age: 0 });
        Sound.coin();
        updateHUD();
      }
    }
  }

  function updateFx(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt;
    }
    for (var f = floats.length - 1; f >= 0; f--) {
      floats[f].age += dt;
      if (floats[f].age >= floats[f].life) floats.splice(f, 1);
    }
    for (var c = coinAnims.length - 1; c >= 0; c--) {
      coinAnims[c].age += dt;
      if (coinAnims[c].age > 0.45) coinAnims.splice(c, 1);
    }
  }

  function update(dt) {
    if (phase === "play" || phase === "win") {
      updatePlayer(dt);
      if (phase === "play") {
        updateEnemies(dt);
        updateItems(dt);
        // Timer.
        timeAcc += dt;
        if (timeAcc >= 1) {
          timeAcc -= 1;
          timeLeft--;
          updateHUD();
          if (timeLeft <= 0) { timeLeft = 0; die(); }
        }
      }
    }
    updateFx(dt);
  }

  // ---------- RENDER ----------
  function drawTile(tx, ty, t, time) {
    var x = tx * D.TILE - camX, y = ty * D.TILE;
    if (x < -40 || x > D.VIEW_W + 40) return;
    var T = D.TILE;
    if (t === 1) { // ground
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#fcbcb0";
      ctx.fillRect(x, y, T, 6);
      ctx.fillStyle = "#000";
      ctx.fillRect(x + 6, y + 12, 5, 5);
      ctx.fillRect(x + 20, y + 20, 5, 5);
    } else if (t === 2) { // brick
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#5a1f00";
      ctx.fillRect(x, y + 14, T, 3);
      ctx.fillRect(x + 15, y, 3, 14);
      ctx.fillRect(x + 7, y + 17, 3, 15);
      ctx.fillRect(x + 23, y + 17, 3, 15);
      ctx.fillRect(x, y, T, 3);
    } else if (t === 3 || t === 4) { // ? block
      var pulse = 0.5 + 0.5 * Math.sin(time * 5 + tx);
      ctx.fillStyle = "#f8b800";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "rgba(255,255,255," + (0.25 + pulse * 0.25).toFixed(2) + ")";
      ctx.fillRect(x + 3, y + 3, T - 6, 5);
      ctx.fillStyle = "#7c2d00";
      ctx.font = "bold 20px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", x + T / 2, y + T / 2 + 1);
      ctx.strokeStyle = "#7c2d00"; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
    } else if (t === 5) { // used
      ctx.fillStyle = "#9c5a24";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#5a2f0c";
      ctx.fillRect(x + 4, y + 4, 4, 4);
      ctx.fillRect(x + 22, y + 4, 4, 4);
      ctx.fillRect(x + 4, y + 22, 4, 4);
      ctx.fillRect(x + 22, y + 22, 4, 4);
    } else if (t === 6) { // pipe
      var isTop = !D.isSolid(D.tileAt(level.grid, tx, ty - 1)) || D.tileAt(level.grid, tx, ty - 1) !== 6;
      ctx.fillStyle = "#3fae2a";
      if (isTop) {
        ctx.fillRect(x - 3, y, T + 6, T);
        ctx.fillStyle = "#7ddc5f";
        ctx.fillRect(x, y + 3, 8, T - 6);
        ctx.fillStyle = "#1d6b12";
        ctx.fillRect(x + T - 4, y + 3, 8, T - 6);
      } else {
        ctx.fillRect(x + 3, y, T - 6, T);
        ctx.fillStyle = "#7ddc5f";
        ctx.fillRect(x + 7, y, 7, T);
        ctx.fillStyle = "#1d6b12";
        ctx.fillRect(x + T - 11, y, 7, T);
      }
    } else if (t === 7) { // stair block
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#fcbcb0";
      ctx.fillRect(x + 3, y + 3, T - 6, 4);
      ctx.strokeStyle = "#5a1f00"; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
    } else if (t === 8) { // flagpole
      ctx.fillStyle = "#2e9e44";
      ctx.fillRect(x + T / 2 - 3, y, 6, T);
      if (ty === 1) {
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.moveTo(x + T / 2 - 3, y + 4);
        ctx.lineTo(x + T / 2 - 30, y + 14);
        ctx.lineTo(x + T / 2 - 3, y + 24);
        ctx.closePath();
        ctx.fill();
      }
    } else if (t === 9) { // flag base
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(x - 4, y, T + 8, T);
      ctx.fillStyle = "#6b6b6b";
      ctx.fillRect(x, y + 3, T, 5);
    }
  }

  function drawPlayer(time) {
    var p = player;
    if (invuln > 0 && phase === "play" && Math.floor(time * 12) % 2 === 0) return; // blink
    var x = p.x - camX, y = p.y;
    var run = p.onGround && Math.abs(p.vx) > 20;
    var legSwing = run ? Math.sin(p.animT * 2) * 5 : 0;
    var big = p.big;
    var h = big ? 54 : 30;

    ctx.save();
    ctx.translate(x + p.w / 2, y + h);
    if (p.face < 0) ctx.scale(-1, 1);

    // Legs.
    ctx.fillStyle = "#2b4bd8";
    if (!p.onGround) {
      ctx.fillRect(-9, -12, 8, 12);
      ctx.fillRect(3, -16, 8, 10);
    } else if (run) {
      ctx.fillRect(-9, -12 + legSwing * 0.4, 8, 12);
      ctx.fillRect(1, -12 - legSwing * 0.4, 8, 12);
    } else {
      ctx.fillRect(-9, -12, 8, 12);
      ctx.fillRect(1, -12, 8, 12);
    }
    // Shoes.
    ctx.fillStyle = "#7c2d12";
    ctx.fillRect(-11, -5, 12, 5);
    ctx.fillRect(1, -5, 12, 5);
    // Torso (overalls).
    var torsoH = big ? 22 : 10;
    ctx.fillStyle = "#2b4bd8";
    ctx.fillRect(-10, -12 - torsoH, 20, torsoH);
    ctx.fillStyle = "#f8b800";
    ctx.fillRect(-3, -12 - torsoH + 4, 6, 6); // buttons
    // Arms.
    ctx.fillStyle = "#e52521";
    if (!p.onGround) {
      ctx.fillRect(-16, -12 - torsoH, 6, 14);
      ctx.fillRect(10, -12 - torsoH - 6, 6, 12);
    } else {
      var armSwing = run ? Math.sin(p.animT * 2 + 1.5) * 4 : 0;
      ctx.fillRect(-15, -12 - torsoH + armSwing * 0.5, 6, 12);
      ctx.fillRect(9, -12 - torsoH - armSwing * 0.5, 6, 12);
    }
    // Head.
    var hy = -12 - torsoH;
    ctx.fillStyle = "#ffcf9e";
    ctx.fillRect(-8, hy - 12, 16, 12);
    // Cap.
    ctx.fillStyle = "#e52521";
    ctx.fillRect(-9, hy - 18, 18, 7);
    ctx.fillRect(2, hy - 13, 10, 4); // brim
    ctx.fillStyle = "#fff";
    ctx.fillRect(-4, hy - 17, 8, 5);
    ctx.fillStyle = "#e52521";
    ctx.font = "bold 6px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // Eye + nose + mustache.
    ctx.fillStyle = "#202020";
    ctx.fillRect(2, hy - 9, 3, 5);
    ctx.fillStyle = "#ffcf9e";
    ctx.fillRect(8, hy - 7, 4, 4);
    ctx.fillStyle = "#3a1c00";
    ctx.fillRect(-2, hy - 4, 10, 3);
    ctx.restore();
  }

  function drawEnemy(e) {
    var x = e.x - camX, y = e.y;
    if (x < -40 || x > D.VIEW_W + 40) return;
    var step = Math.sin(e.animT) > 0 ? 3 : -3;
    if (e.type === "goomba") {
      ctx.fillStyle = "#a16207";
      ctx.fillRect(x, y + 4, 26, 18);
      ctx.fillStyle = "#713f12";
      ctx.fillRect(x + 2, y + 16, 22, 6);
      // Feet.
      ctx.fillStyle = "#3a2403";
      ctx.fillRect(x - 2 + step, y + 20, 10, 6);
      ctx.fillRect(x + 18 - step, y + 20, 10, 6);
      // Angry eyes.
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + 5, y + 8, 6, 7);
      ctx.fillRect(x + 15, y + 8, 6, 7);
      ctx.fillStyle = "#111";
      ctx.fillRect(x + 8, y + 10, 3, 4);
      ctx.fillRect(x + 15, y + 10, 3, 4);
    } else { // koopa
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(x + 2, y + 8, 22, 14);
      ctx.fillStyle = "#bbf7d0";
      ctx.fillRect(x + 6, y + 14, 14, 8);
      ctx.fillStyle = "#15803d";
      ctx.fillRect(x + 4, y, 18, 10); // head
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + 14, y + 3, 5, 5);
      ctx.fillStyle = "#111";
      ctx.fillRect(x + 16, y + 4, 3, 3);
      ctx.fillStyle = "#14532d";
      ctx.fillRect(x + step, y + 20, 9, 6);
      ctx.fillRect(x + 17 - step, y + 20, 9, 6);
    }
  }

  function drawCastle() {
    var x = level.castleX - camX, baseY = 11 * D.TILE;
    if (x < -200 || x > D.VIEW_W + 60) return;
    var W2 = 150, H2 = 130;
    ctx.fillStyle = "#c84c0c";
    ctx.fillRect(x, baseY - H2, W2, H2);
    // Battlements.
    for (var i = 0; i < 5; i++) ctx.fillRect(x + i * 32, baseY - H2 - 16, 20, 16);
    // Tower.
    ctx.fillRect(x + W2 / 2 - 25, baseY - H2 - 52, 50, 52);
    for (var j = 0; j < 3; j++) ctx.fillRect(x + W2 / 2 - 25 + j * 20, baseY - H2 - 66, 12, 14);
    // Door + windows.
    ctx.fillStyle = "#3a1500";
    ctx.fillRect(x + W2 / 2 - 16, baseY - 52, 32, 52);
    ctx.fillRect(x + 18, baseY - H2 + 24, 16, 16);
    ctx.fillRect(x + W2 - 34, baseY - H2 + 24, 16, 16);
    // Brick lines.
    ctx.fillStyle = "rgba(90,31,0,0.5)";
    for (var r = 0; r < 6; r++) ctx.fillRect(x, baseY - H2 + 12 + r * 20, W2, 2);
  }

  function render(time) {
    // Sky.
    var sky = ctx.createLinearGradient(0, 0, 0, D.VIEW_H);
    sky.addColorStop(0, "#5c94fc");
    sky.addColorStop(1, "#a5d8ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, D.VIEW_W, D.VIEW_H);

    // Clouds & hills (parallax).
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    var off = camX * 0.3;
    for (var ci = 0; ci < 8; ci++) {
      var cxp = ((ci * 380 - off) % 2400 + 2400) % 2400 - 200;
      ctx.beginPath();
      ctx.arc(cxp, 60 + (ci % 3) * 28, 26, 0, 6.283);
      ctx.arc(cxp + 26, 60 + (ci % 3) * 28, 20, 0, 6.283);
      ctx.arc(cxp - 26, 60 + (ci % 3) * 28, 18, 0, 6.283);
      ctx.fill();
    }
    ctx.fillStyle = "#3fae2a";
    var off2 = camX * 0.55;
    for (var hi = 0; hi < 7; hi++) {
      var hx = ((hi * 520 - off2) % 2600 + 2600) % 2600 - 260;
      ctx.beginPath();
      ctx.moveTo(hx, 11 * D.TILE);
      ctx.lineTo(hx + 130, 11 * D.TILE - 70 - (hi % 2) * 30);
      ctx.lineTo(hx + 260, 11 * D.TILE);
      ctx.closePath();
      ctx.fill();
    }

    // Tiles.
    var c0 = Math.max(0, Math.floor(camX / D.TILE) - 1);
    var c1 = Math.min(D.LEVEL_W - 1, Math.ceil((camX + D.VIEW_W) / D.TILE) + 1);
    for (var ty = 0; ty < D.ROWS; ty++) {
      for (var tx = c0; tx <= c1; tx++) {
        var t = level.grid[ty][tx];
        if (t) drawTile(tx, ty, t, time);
      }
    }

    drawCastle();

    // Floating coins.
    for (var k = 0; k < level.coins.length; k++) {
      var cn = level.coins[k];
      var qx = cn.c * D.TILE + D.TILE / 2 - camX, qy = cn.r * D.TILE + D.TILE / 2;
      if (qx < -20 || qx > D.VIEW_W + 20) continue;
      var sq = Math.abs(Math.cos(time * 4 + cn.c));
      ctx.fillStyle = "#f8b800";
      ctx.beginPath();
      ctx.ellipse(qx, qy, 4 + 8 * sq, 11, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.ellipse(qx, qy, 2 + 4 * sq, 7, 0, 0, 6.283);
      ctx.fill();
    }

    // Coin sparkles from ? blocks.
    for (var s = 0; s < coinAnims.length; s++) {
      var ca = coinAnims[s];
      var ay = ca.y - ca.age * 260;
      ctx.globalAlpha = 1 - ca.age / 0.45;
      ctx.fillStyle = "#f8b800";
      ctx.beginPath();
      ctx.ellipse(ca.x - camX, ay, 9, 12, 0, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Items (mushrooms).
    for (var m = 0; m < items.length; m++) {
      var it = items[m];
      if (it.dead) continue;
      var ix = it.x - camX, iy = it.y;
      ctx.fillStyle = "#e52521";
      ctx.fillRect(ix, iy, 24, 12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(ix + 4, iy + 2, 5, 5);
      ctx.fillRect(ix + 15, iy + 2, 5, 5);
      ctx.fillStyle = "#ffcf9e";
      ctx.fillRect(ix + 4, iy + 12, 16, 12);
      ctx.fillStyle = "#202020";
      ctx.fillRect(ix + 7, iy + 15, 3, 4);
      ctx.fillRect(ix + 14, iy + 15, 3, 4);
    }

    // Enemies.
    for (var e = 0; e < enemies.length; e++) {
      if (enemies[e].alive) drawEnemy(enemies[e]);
    }

    // Player.
    if (player) drawPlayer(time);

    // Particles.
    for (var p = 0; p < parts.length; p++) {
      var pt = parts[p];
      ctx.globalAlpha = 1 - pt.age / pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - camX - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // Floating scores.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var f = 0; f < floats.length; f++) {
      var fl = floats[f];
      ctx.globalAlpha = 1 - fl.age / fl.life;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px monospace";
      ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
      var fx = fl.x - camX, fy = fl.y - fl.age * 50;
      ctx.strokeText(fl.text, fx, fy);
      ctx.fillText(fl.text, fx, fy);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- INPUT ----------
  function bindHold(btn, on, off) {
    if (!btn) return;
    function down(e) {
      if (e) e.preventDefault();
      Sound.ensure();
      btn.classList.add("held");
      on();
    }
    function up() { btn.classList.remove("held"); off(); }
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  bindHold(leftBtn, function () { input.left = true; }, function () { input.left = false; });
  bindHold(rightBtn, function () { input.right = true; }, function () { input.right = false; });
  bindHold(runBtn, function () { input.run = true; }, function () { input.run = false; });
  bindHold(jumpBtn, function () {
    if (!input.jump) input.jumpPressed = true;
    input.jump = true;
  }, function () { input.jump = false; });

  var keymap = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ShiftLeft: "run", ShiftRight: "run", KeyJ: "run" };
  window.addEventListener("keydown", function (e) {
    Sound.ensure();
    var k = keymap[e.code];
    if (k) { input[k] = true; e.preventDefault(); }
    if ((e.code === "Space" || e.code === "KeyK" || e.code === "ArrowUp" || e.code === "KeyW") && !input.jump) {
      input.jumpPressed = true;
      input.jump = true;
      e.preventDefault();
    }
    if (e.code === "KeyP" && pauseBtn) pauseBtn.click();
  });
  window.addEventListener("keyup", function (e) {
    var k = keymap[e.code];
    if (k) input[k] = false;
    if (e.code === "Space" || e.code === "KeyK" || e.code === "ArrowUp" || e.code === "KeyW") input.jump = false;
  });

  // ---------- BUTTONS ----------
  if (muteBtn) muteBtn.addEventListener("click", function () {
    Sound.ensure();
    Sound.toggleMute();
    refreshMute();
  });
  if (pauseBtn) pauseBtn.addEventListener("click", function () {
    Sound.ensure(); Sound.click();
    if (phase !== "play") return;
    paused = !paused;
    if (paused) {
      showCard("⏸ توقف", "بازی متوقف شد.", [
        { text: "▶ ادامه", onClick: function () { paused = false; hideCard(); } },
        { text: "🔄 شروع دوباره", ghost: true, onClick: function () { paused = false; startLevel(); } }
      ]);
    } else hideCard();
  });

  // ---------- MAIN LOOP ----------
  var last = 0, time = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (!last) last = t;
    var dt = (t - last) / 1000;
    last = t;
    if (dt > 0.05) dt = 0.05;
    time += dt;
    // Landscape only: pause the game while the phone is portrait
    // (a rotate prompt overlays via CSS).
    if (window.innerHeight <= window.innerWidth) {
      if (!paused && (phase === "play" || phase === "win")) update(dt);
    }
    if (level && phase !== "menu") render(time);
  }

  // ---------- INIT ----------
  refreshMute();
  updateHUD();
  showCard(
    "🍄 سوپر ماریو",
    "بدو، بپر، سکه جمع کن و به پرچم برس!<br>" +
    "دکمهٔ <b>A</b> پرش است — نگهش دار تا <b>بلندتر</b> بپری.<br>" +
    "دکمهٔ <b>B</b> دویدن تند است.<br>" +
    "قارچ بخور تا بزرگ شوی و آجرها را بشکنی!",
    [{ text: "▶ شروع بازی", onClick: startLevel }]
  );
  requestAnimationFrame(frame);
})();
