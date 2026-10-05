"use strict";
/* Super Mario-style platformer — multi-level, original art.
   Inspired by classic 8-bit platformers. No Nintendo assets used.
   Higher jump (hold = higher). Pure logic in Mario; browser in browserBoot(). */

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
  var ROWS = 14;

  // Physics (dt-based). Jump tuned HIGH.
  var GRAV = 2400, HOLD_GRAV = 1500, JUMP_V = 820;
  var MAX_FALL = 980;
  var WALK_ACCEL = 2100, AIR_ACCEL = 1550, FRICTION = 2500;
  var WALK_MAX = 180, RUN_MAX = 295;

  // Tiles: 0 empty, 1 ground, 2 brick, 3 ?coin, 4 ?mushroom, 5 used,
  //        6 pipe, 7 stair, 8 flagpole, 9 flag base
  function isSolid(t) {
    return t === 1 || t === 2 || t === 3 || t === 4 || t === 5 || t === 6 || t === 7 || t === 9;
  }
  function tileAt(grid, tx, ty, levelW) {
    if (tx < 0) return 1;
    if (tx >= levelW || ty < 0) return 0;
    if (ty >= ROWS) return 1;
    return grid[ty][tx];
  }

  function makeGrid(levelW) {
    var g = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < levelW; c++) row.push(0);
      g.push(row);
    }
    return g;
  }

  function set(g, c, r, t, levelW) {
    if (c >= 0 && c < levelW && r >= 0 && r < ROWS) g[r][c] = t;
  }
  function fill(g, c0, c1, r0, r1, t, levelW) {
    for (var r = r0; r <= r1; r++)
      for (var c = c0; c <= c1; c++) set(g, c, r, t, levelW);
  }

  // ===== LEVEL DEFINITIONS (original designs) =====
  function buildLevel(levelNum) {
    levelNum = Math.max(1, Math.min(3, levelNum || 1));
    var levelW, gaps, pipes, stairs, qBlocks, bricks, coins, enemies, flagX, castleX;

    if (levelNum === 1) {
      levelW = 210;
      gaps = [[56, 57], [68, 70], [135, 136]];
      pipes = [[26, 2], [38, 3], [48, 2], [110, 3]];
      // stairs: array of {x, h, up:true/false}
      stairs = [
        { x: 80, h: 4, dir: 1 },
        { x: 88, h: 4, dir: -1 },
        { x: 168, h: 7, dir: 1 }
      ];
      qBlocks = [
        [15, 7, 3], [19, 7, 2], [20, 7, 3], [21, 7, 2], [22, 7, 4], [23, 7, 2],
        [74, 7, 3], [74, 3, 3], [92, 7, 2], [93, 7, 3], [94, 7, 2],
        [124, 7, 3], [126, 7, 2], [128, 7, 3]
      ];
      coins = [];
      function coinRow(c0, c1, r) { for (var c = c0; c <= c1; c++) coins.push({ c: c, r: r }); }
      coinRow(66, 70, 5);
      coinRow(105, 109, 6);
      coinRow(132, 140, 4);
      coins.push({ c: 15, r: 4 }, { c: 74, r: 1 });
      enemies = [
        { x: 21.5, type: "goomba" }, { x: 36, type: "goomba" }, { x: 50, type: "goomba" },
        { x: 51.5, type: "goomba" }, { x: 78, type: "goomba" }, { x: 100, type: "koopa" },
        { x: 104, type: "koopa" }, { x: 130, type: "goomba" }, { x: 148, type: "goomba" },
        { x: 155, type: "goomba" }, { x: 157, type: "goomba" }, { x: 162, type: "koopa" }
      ];
      flagX = 182 * TILE;
      castleX = 192 * TILE;
    } else if (levelNum === 2) {
      levelW = 230;
      gaps = [[42, 44], [72, 74], [118, 120], [160, 162], [175, 177]];
      pipes = [[20, 2], [32, 4], [55, 3], [90, 2], [140, 4], [155, 2]];
      stairs = [
        { x: 100, h: 5, dir: 1 },
        { x: 110, h: 5, dir: -1 },
        { x: 190, h: 8, dir: 1 }
      ];
      qBlocks = [
        [12, 7, 3], [14, 7, 4], [16, 7, 3],
        [28, 4, 3], [48, 7, 2], [49, 7, 3], [50, 7, 2],
        [68, 7, 3], [68, 3, 4], [85, 7, 3], [87, 7, 2],
        [130, 7, 3], [132, 7, 4], [134, 7, 3],
        [170, 6, 3], [172, 6, 2]
      ];
      coins = [];
      function coinRow2(c0, c1, r) { for (var c = c0; c <= c1; c++) coins.push({ c: c, r: r }); }
      coinRow2(38, 42, 5);
      coinRow2(78, 84, 4);
      coinRow2(115, 122, 5);
      coinRow2(148, 155, 3);
      coins.push({ c: 28, r: 2 }, { c: 68, r: 1 });
      enemies = [
        { x: 18, type: "goomba" }, { x: 30, type: "koopa" }, { x: 46, type: "goomba" },
        { x: 60, type: "goomba" }, { x: 62, type: "goomba" }, { x: 80, type: "koopa" },
        { x: 95, type: "goomba" }, { x: 108, type: "koopa" }, { x: 125, type: "goomba" },
        { x: 145, type: "goomba" }, { x: 147, type: "goomba" }, { x: 165, type: "koopa" },
        { x: 180, type: "goomba" }, { x: 182, type: "goomba" }
      ];
      flagX = 205 * TILE;
      castleX = 215 * TILE;
    } else { // level 3
      levelW = 250;
      gaps = [[35, 37], [65, 68], [95, 97], [130, 133], [170, 172], [195, 197]];
      pipes = [[18, 3], [28, 2], [50, 4], [80, 3], [110, 2], [150, 4], [180, 3]];
      stairs = [
        { x: 60, h: 4, dir: 1 },
        { x: 70, h: 4, dir: -1 },
        { x: 140, h: 6, dir: 1 },
        { x: 155, h: 6, dir: -1 },
        { x: 210, h: 9, dir: 1 }
      ];
      qBlocks = [
        [10, 7, 3], [12, 7, 2], [13, 7, 4], [14, 7, 2], [15, 7, 3],
        [40, 6, 3], [42, 6, 3], [44, 6, 4],
        [75, 7, 2], [76, 7, 3], [77, 7, 2],
        [100, 4, 3], [102, 7, 3], [104, 7, 4],
        [125, 7, 3], [160, 5, 3], [162, 5, 2], [164, 5, 3],
        [185, 7, 4], [187, 7, 3]
      ];
      coins = [];
      function coinRow3(c0, c1, r) { for (var c = c0; c <= c1; c++) coins.push({ c: c, r: r }); }
      coinRow3(22, 27, 5);
      coinRow3(55, 60, 4);
      coinRow3(90, 96, 3);
      coinRow3(135, 142, 5);
      coinRow3(175, 182, 4);
      coins.push({ c: 40, r: 3 }, { c: 100, r: 2 }, { c: 160, r: 2 });
      enemies = [
        { x: 16, type: "goomba" }, { x: 25, type: "koopa" }, { x: 38, type: "goomba" },
        { x: 48, type: "goomba" }, { x: 58, type: "koopa" }, { x: 72, type: "goomba" },
        { x: 85, type: "koopa" }, { x: 98, type: "goomba" }, { x: 115, type: "goomba" },
        { x: 120, type: "koopa" }, { x: 138, type: "goomba" }, { x: 148, type: "koopa" },
        { x: 165, type: "goomba" }, { x: 168, type: "goomba" }, { x: 190, type: "koopa" },
        { x: 200, type: "goomba" }, { x: 202, type: "goomba" }
      ];
      flagX = 228 * TILE;
      castleX = 238 * TILE;
    }

    var g = makeGrid(levelW);

    // Ground with gaps
    function inGap(c) {
      for (var i = 0; i < gaps.length; i++)
        if (c >= gaps[i][0] && c <= gaps[i][1]) return true;
      return false;
    }
    for (var c = 0; c < levelW; c++) {
      if (!inGap(c)) fill(g, c, c, 11, 13, 1, levelW);
    }

    // Pipes
    for (var p = 0; p < pipes.length; p++) {
      var px = pipes[p][0], ph = pipes[p][1];
      fill(g, px, px + 1, 11 - ph, 10, 6, levelW);
    }

    // Stairs
    for (var s = 0; s < stairs.length; s++) {
      var st = stairs[s];
      if (st.dir === 1) {
        for (var i = 0; i < st.h; i++) fill(g, st.x + i, st.x + i, 10 - i, 10, 7, levelW);
      } else {
        for (var i = 0; i < st.h; i++) fill(g, st.x + i, st.x + i, 10 - (st.h - 1 - i), 10, 7, levelW);
      }
    }

    // Question / brick blocks
    for (var b = 0; b < qBlocks.length; b++) {
      var qb = qBlocks[b];
      set(g, qb[0], qb[1], qb[2], levelW);
    }

    // Flagpole
    var flagTile = Math.floor(flagX / TILE);
    for (var fr = 1; fr <= 10; fr++) set(g, flagTile, fr, 8, levelW);
    set(g, flagTile, 10, 9, levelW);

    return {
      grid: g,
      coins: coins,
      enemies: enemies,
      flagX: flagX,
      castleX: castleX,
      levelW: levelW,
      levelNum: levelNum
    };
  }

  // AABB vs tilemap, swept
  function moveAndCollide(e, dt, grid, levelW) {
    var res = { hitLeft: false, hitRight: false, landed: false, hitHead: false, headTX: -1, headTY: -1 };
    var T = TILE;
    // X
    var newX = e.x + e.vx * dt;
    var y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 1) / T);
    if (e.vx > 0) {
      var tx0 = Math.floor((e.x + e.w) / T), tx1 = Math.floor((newX + e.w) / T);
      var hx = -1;
      for (var tx = tx0; tx <= tx1 && hx < 0; tx++)
        for (var ty = y0; ty <= y1; ty++)
          if (isSolid(tileAt(grid, tx, ty, levelW))) { hx = tx; break; }
      if (hx >= 0) { e.x = hx * T - e.w - 0.01; e.vx = 0; res.hitRight = true; }
      else e.x = newX;
    } else if (e.vx < 0) {
      var tx0b = Math.floor(e.x / T), tx1b = Math.floor(newX / T);
      var hx2 = -1;
      for (var txb = tx0b; txb >= tx1b && hx2 < 0; txb--)
        for (var tyb = y0; tyb <= y1; tyb++)
          if (isSolid(tileAt(grid, txb, tyb, levelW))) { hx2 = txb; break; }
      if (hx2 >= 0) { e.x = (hx2 + 1) * T + 0.01; e.vx = 0; res.hitLeft = true; }
      else e.x = newX;
    } else e.x = newX;
    // Y
    var newY = e.y + e.vy * dt;
    var x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 1) / T);
    if (e.vy > 0) {
      var ty0 = Math.floor((e.y + e.h) / T), ty1 = Math.floor((newY + e.h) / T);
      var hy = -1;
      for (var tyy = ty0; tyy <= ty1 && hy < 0; tyy++)
        for (var txx = x0; txx <= x1; txx++)
          if (isSolid(tileAt(grid, txx, tyy, levelW))) { hy = tyy; break; }
      if (hy >= 0) { e.y = hy * T - e.h; e.vy = 0; res.landed = true; }
      else e.y = newY;
    } else if (e.vy < 0) {
      var ty0b = Math.floor(e.y / T), ty1b = Math.floor(newY / T);
      var tcx = Math.floor((e.x + e.w / 2) / T);
      var hy2 = -1, htx = -1;
      for (var tyy2 = ty0b; tyy2 >= ty1b && hy2 < 0; tyy2--) {
        if (isSolid(tileAt(grid, tcx, tyy2, levelW))) { hy2 = tyy2; htx = tcx; break; }
      }
      if (hy2 < 0) {
        for (var tyy3 = ty0b; tyy3 >= ty1b && hy2 < 0; tyy3--)
          for (var txx2 = x0; txx2 <= x1; txx2++)
            if (isSolid(tileAt(grid, txx2, tyy3, levelW))) { hy2 = tyy3; htx = txx2; break; }
      }
      if (hy2 >= 0) {
        e.y = (hy2 + 1) * T + 0.01; e.vy = 0;
        res.hitHead = true; res.headTX = htx; res.headTY = hy2;
      } else e.y = newY;
    } else e.y = newY;
    return res;
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  var SCORE = { coin: 100, stomp: 200, block: 50, mushroom: 500, flag: 1000, timeBonus: 10, levelClear: 2000 };

  return {
    TILE: TILE, VIEW_W: VIEW_W, VIEW_H: VIEW_H, ROWS: ROWS,
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

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var PIXEL_SCALE = 2;
  var buf = document.createElement("canvas");
  buf.width = D.VIEW_W / PIXEL_SCALE;
  buf.height = D.VIEW_H / PIXEL_SCALE;
  var bufCtx = buf.getContext("2d");

  var scoreEl = document.getElementById("score");
  var coinsEl = document.getElementById("coins");
  var livesEl = document.getElementById("lives");
  var timeEl = document.getElementById("time");
  var levelEl = document.getElementById("levelNum");
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
      jump: function () { tone(280, 700, 0.15, "square", 0.07); },
      coin: function () { tone(988, 988, 0.06, "square", 0.07); tone(1319, 1319, 0.2, "square", 0.07, 0.06); },
      stomp: function () { tone(420, 110, 0.11, "square", 0.09); },
      bump: function () { tone(140, 85, 0.09, "square", 0.09); },
      sprout: function () { tone(300, 920, 0.24, "sine", 0.08); },
      power: function () { tone(523, 523, 0.07, "square", 0.08); tone(659, 659, 0.07, "square", 0.08, 0.07); tone(784, 784, 0.13, "square", 0.08, 0.14); },
      shrink: function () { tone(600, 140, 0.28, "sawtooth", 0.08); },
      die: function () { tone(480, 70, 0.48, "square", 0.09); },
      flag: function () { var n = [523, 587, 659, 784, 880, 1046]; for (var i = 0; i < n.length; i++) tone(n[i], n[i], 0.11, "square", 0.07, i * 0.085); },
      levelClear: function () { var n = [523, 659, 784, 1046, 784, 1046]; for (var i = 0; i < n.length; i++) tone(n[i], n[i], 0.14, "square", 0.08, i * 0.12); },
      click: function () { tone(600, 600, 0.045, "sine", 0.07); },
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
  var phase = "menu";
  var paused = false;
  var level = null;
  var currentLevel = 1;
  var maxLevel = 3;
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
    if (levelEl) levelEl.textContent = fa(currentLevel);
  }

  function newPlayer() {
    return {
      x: 2.5 * D.TILE, y: 8 * D.TILE, w: 22, h: 30,
      vx: 0, vy: 0, big: false, onGround: false, face: 1,
      animT: 0, dead: false
    };
  }

  function startLevel(num) {
    Sound.ensure();
    currentLevel = num || currentLevel || 1;
    level = D.buildLevel(currentLevel);
    player = newPlayer();
    enemies = level.enemies.map(function (s) {
      return {
        x: s.x * D.TILE, y: 8 * D.TILE, w: 26, h: 26,
        vx: s.type === "koopa" ? -58 : -40, vy: 0,
        type: s.type, alive: true, animT: Math.random() * 2, active: false
      };
    });
    items = []; parts = []; floats = []; coinAnims = [];
    camX = 0;
    timeLeft = 300;
    coyote = 0; jumpBuf = 0; invuln = 0; winT = 0; dieT = 0; timeAcc = 0;
    paused = false;
    hideCard();
    phase = "play";
    updateHUD();
  }

  function startGame() {
    score = 0; coins = 0; lives = 3;
    currentLevel = 1;
    isRecord = false;
    startLevel(1);
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
        age: 0, life: 0.55 + Math.random() * 0.4,
        color: color, size: 3 + Math.random() * 4
      });
    }
  }

  function hitBlock(tx, ty) {
    var t = D.tileAt(level.grid, tx, ty, level.levelW);
    var cx = tx * D.TILE + D.TILE / 2, topY = ty * D.TILE;
    if (t === 3) {
      level.grid[ty][tx] = 5;
      coins++; addScore(D.SCORE.coin, cx, topY - 10);
      coinAnims.push({ x: cx, y: topY - 8, age: 0 });
      burst(cx, topY, "#fde047", 6, 160);
      Sound.coin();
    } else if (t === 4) {
      level.grid[ty][tx] = 5;
      items.push({ x: tx * D.TILE + 4, y: topY - 24, w: 24, h: 24, vx: 0, vy: -260, kind: "mush", emerge: 0.85, dead: false });
      addScore(D.SCORE.block, cx, topY - 10);
      Sound.sprout();
    } else if (t === 2) {
      if (player.big) {
        level.grid[ty][tx] = 0;
        addScore(D.SCORE.block, cx, topY - 10);
        burst(cx, topY + 16, "#c2703d", 10, 340);
        Sound.bump();
      } else {
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
      player.h = 52; player.y -= 22;
      addScore(D.SCORE.mushroom, player.x + 11, player.y);
      burst(player.x + 11, player.y + 18, "#f87171", 10, 200);
      Sound.power();
    } else {
      addScore(D.SCORE.mushroom, player.x + 11, player.y);
      Sound.power();
    }
    updateHUD();
  }

  function hurt() {
    if (invuln > 0 || player.dead) return;
    if (player.big) {
      player.big = false;
      player.h = 30; player.y += 22;
      invuln = 2.1;
      Sound.shrink();
    } else {
      die();
    }
  }

  function die() {
    if (player.dead) return;
    player.dead = true;
    player.vy = -660;
    dieT = 0;
    lives--;
    Sound.die();
    updateHUD();
  }

  async function reportScore(value) {
    var status = "n/a", rec = false;
    try {
      var params = new URLSearchParams(window.location.search);
      var uid = params.get("uid");
      var imid = params.get("imid");
      var cid = params.get("cid"), mid = params.get("mid");
      var game = params.get("game") || "mario";
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
        status = "missing-params";
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
    } else { status = "skipped"; }
    if (score > best) { best = score; store("marioBest", String(best)); }
    var shownBest = Number.isFinite(serverBest) ? serverBest : best;
    var recordLine = isRecord ? "🎉 <b>رکورد جدید!</b><br>" : "";
    showCard(
      won ? "🏆 تبریک! بازی تمام شد" : "💥 بازی تمام شد",
      "امتیاز نهایی: <b>" + fa(score) + "</b><br>" +
      "سکه: <b>" + fa(coins) + "</b> 🪙<br>" +
      "مرحله: <b>" + fa(currentLevel) + "</b> / " + fa(maxLevel) + "<br>" +
      "رکورد: <b>" + fa(shownBest) + "</b><br>" +
      recordLine +
      '<br><small style="opacity:.65">' + esc(status) + "</small>",
      [{ text: "🔄 بازی دوباره", onClick: startGame }]
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
      if (dieT > 1.55) {
        if (lives > 0) {
          var keepScore = score, keepCoins = coins, keepLives = lives;
          level = D.buildLevel(currentLevel);
          player = newPlayer();
          enemies = level.enemies.map(function (s) {
            return { x: s.x * D.TILE, y: 8 * D.TILE, w: 26, h: 26, vx: s.type === "koopa" ? -58 : -40, vy: 0, type: s.type, alive: true, animT: 0, active: false };
          });
          items = []; parts = []; floats = []; coinAnims = [];
          camX = 0; invuln = 2.2;
          score = keepScore; coins = keepCoins; lives = keepLives;
          timeLeft = Math.max(timeLeft, 120);
          updateHUD();
        } else {
          phase = "over";
          finishRun(false);
        }
      }
      return;
    }

    if (phase === "win") {
      winT += dt;
      if (winT < 1.15) {
        p.y += 250 * dt;
        var baseY = 10 * D.TILE - p.h;
        if (p.y > baseY) p.y = baseY;
      } else {
        p.x += 125 * dt;
        p.animT += dt * 9;
        if (p.x > level.castleX + 30) {
          addScore(Math.ceil(timeLeft) * D.SCORE.timeBonus);
          addScore(D.SCORE.levelClear);
          if (currentLevel < maxLevel) {
            currentLevel++;
            showCard(
              "🏁 مرحله " + fa(currentLevel - 1) + " تمام!",
              "آفرین! آماده‌ای برای مرحلهٔ بعدی؟<br>امتیاز فعلی: <b>" + fa(score) + "</b>",
              [{ text: "▶ مرحله " + fa(currentLevel), onClick: function () { startLevel(currentLevel); } }]
            );
            phase = "menu";
          } else {
            phase = "over";
            finishRun(true);
          }
        }
      }
      return;
    }

    // Horizontal
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
    p.animT += dt * (2.2 + Math.abs(p.vx) / 38);

    // Jump
    if (p.onGround) coyote = 0.09; else coyote -= dt;
    if (input.jumpPressed) { jumpBuf = 0.12; input.jumpPressed = false; }
    else jumpBuf -= dt;
    if (jumpBuf > 0 && coyote > 0) {
      p.vy = -D.JUMP_V;
      p.onGround = false;
      coyote = 0; jumpBuf = 0;
      Sound.jump();
    }
    var g = (input.jump && p.vy < 0) ? D.HOLD_GRAV : D.GRAV;
    p.vy = Math.min(p.vy + g * dt, D.MAX_FALL);

    var res = D.moveAndCollide(p, dt, level.grid, level.levelW);
    p.onGround = res.landed;
    if (res.hitHead) hitBlock(res.headTX, res.headTY);
    if (invuln > 0) invuln -= dt;

    if (p.y > D.VIEW_H + 90) { die(); return; }

    if (p.x + p.w > level.flagX && phase === "play") {
      phase = "win";
      winT = 0;
      p.vx = 0;
      var hgt = clamp(Math.round((10 * D.TILE - p.y) / D.TILE), 0, 9);
      addScore(D.SCORE.flag + hgt * 100, p.x, p.y);
      Sound.flag();
      return;
    }

    var target = clamp(p.x + p.w / 2 - D.VIEW_W * 0.40, 0, level.levelW * D.TILE - D.VIEW_W);
    camX += (target - camX) * Math.min(1, dt * 7.5);
  }

  function updateEnemies(dt) {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      if (!e.active) {
        if (e.x < camX + D.VIEW_W + 70) e.active = true;
        else continue;
      }
      if (e.x < camX - 140 || e.x > camX + D.VIEW_W + 220) continue;
      e.animT += dt * 6.5;
      e.vy = Math.min(e.vy + D.GRAV * dt, D.MAX_FALL);
      var res = D.moveAndCollide(e, dt, level.grid, level.levelW);
      if (res.hitLeft) e.vx = Math.abs(e.vx);
      if (res.hitRight) e.vx = -Math.abs(e.vx);
      if (e.y > D.VIEW_H + 130) e.alive = false;

      if (player.dead || phase !== "play") continue;
      if (D.aabb(player, e)) {
        var stomp = player.vy > 55 && (player.y + player.h - e.y) < e.h * 0.58;
        if (stomp) {
          e.alive = false;
          addScore(D.SCORE.stomp, e.x + 13, e.y);
          burst(e.x + 13, e.y + 10, e.type === "koopa" ? "#4ade80" : "#a16207", 8, 220);
          player.vy = input.jump ? -640 : -430;
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
        it.y -= 28 * dt;
        if (it.emerge <= 0) it.vx = 78;
        continue;
      }
      it.vy = Math.min(it.vy + D.GRAV * dt, D.MAX_FALL);
      var res = D.moveAndCollide(it, dt, level.grid, level.levelW);
      if (res.hitLeft) it.vx = Math.abs(it.vx);
      if (res.hitRight) it.vx = -Math.abs(it.vx);
      if (it.y > D.VIEW_H + 130) { it.dead = true; continue; }
      if (!player.dead && phase === "play" && D.aabb(player, it)) {
        it.dead = true;
        grow();
      }
    }
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
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 920 * dt;
    }
    for (var f = floats.length - 1; f >= 0; f--) {
      floats[f].age += dt;
      if (floats[f].age >= floats[f].life) floats.splice(f, 1);
    }
    for (var c = coinAnims.length - 1; c >= 0; c--) {
      coinAnims[c].age += dt;
      if (coinAnims[c].age > 0.42) coinAnims.splice(c, 1);
    }
  }

  function update(dt) {
    if (phase === "play" || phase === "win") {
      updatePlayer(dt);
      if (phase === "play") {
        updateEnemies(dt);
        updateItems(dt);
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

  // ---------- IMPROVED RENDER (original pixel style) ----------
  function drawTile(tx, ty, t, time) {
    var x = tx * D.TILE - camX, y = ty * D.TILE;
    if (x < -48 || x > D.VIEW_W + 48) return;
    var T = D.TILE;

    if (t === 1) { // ground / dirt
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#e8a070";
      ctx.fillRect(x, y, T, 7);
      ctx.fillStyle = "#8a3a08";
      ctx.fillRect(x + 4, y + 14, 6, 5);
      ctx.fillRect(x + 18, y + 20, 5, 5);
      ctx.fillRect(x + 10, y + 24, 4, 4);
    } else if (t === 2) { // brick
      ctx.fillStyle = "#b85a20";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#6b2e08";
      ctx.fillRect(x, y + 14, T, 3);
      ctx.fillRect(x + 15, y, 3, 14);
      ctx.fillRect(x + 7, y + 17, 3, 15);
      ctx.fillRect(x + 23, y + 17, 3, 15);
      ctx.fillStyle = "#d48a40";
      ctx.fillRect(x, y, T, 3);
      ctx.fillRect(x, y, 3, T);
    } else if (t === 3 || t === 4) { // ? block
      var pulse = 0.45 + 0.55 * Math.sin(time * 5.5 + tx * 1.3);
      ctx.fillStyle = "#f0b000";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "rgba(255,255,220," + (0.2 + pulse * 0.3).toFixed(2) + ")";
      ctx.fillRect(x + 3, y + 3, T - 6, 6);
      ctx.fillStyle = "#6b2e00";
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", x + T / 2, y + T / 2 + 1);
      ctx.strokeStyle = "#6b2e00"; ctx.lineWidth = 2.5;
      ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
    } else if (t === 5) { // used block
      ctx.fillStyle = "#8a5a30";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#4a2a10";
      ctx.fillRect(x + 5, y + 5, 5, 5);
      ctx.fillRect(x + 22, y + 5, 5, 5);
      ctx.fillRect(x + 5, y + 22, 5, 5);
      ctx.fillRect(x + 22, y + 22, 5, 5);
      ctx.strokeStyle = "#4a2a10"; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
    } else if (t === 6) { // pipe
      var isTop = !D.isSolid(D.tileAt(level.grid, tx, ty - 1, level.levelW)) || D.tileAt(level.grid, tx, ty - 1, level.levelW) !== 6;
      if (isTop) {
        ctx.fillStyle = "#2e9e2a";
        ctx.fillRect(x - 4, y, T + 8, T);
        ctx.fillStyle = "#6edc5a";
        ctx.fillRect(x - 1, y + 4, 9, T - 8);
        ctx.fillStyle = "#1a6b14";
        ctx.fillRect(x + T - 6, y + 4, 9, T - 8);
        ctx.fillStyle = "#1a5a12";
        ctx.fillRect(x - 4, y, T + 8, 5);
      } else {
        ctx.fillStyle = "#2e9e2a";
        ctx.fillRect(x + 2, y, T - 4, T);
        ctx.fillStyle = "#6edc5a";
        ctx.fillRect(x + 6, y, 7, T);
        ctx.fillStyle = "#1a6b14";
        ctx.fillRect(x + T - 10, y, 7, T);
      }
    } else if (t === 7) { // stair / hard block
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#f0c0a0";
      ctx.fillRect(x + 3, y + 3, T - 6, 5);
      ctx.strokeStyle = "#6b2e08"; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
      ctx.fillStyle = "#8a3a08";
      ctx.fillRect(x + 8, y + 14, 4, 4);
      ctx.fillRect(x + 18, y + 20, 4, 4);
    } else if (t === 8) { // flagpole
      ctx.fillStyle = "#2a8a3a";
      ctx.fillRect(x + T / 2 - 3, y, 6, T);
      if (ty === 1) {
        // flag
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.moveTo(x + T / 2 - 3, y + 3);
        ctx.lineTo(x + T / 2 - 32, y + 13);
        ctx.lineTo(x + T / 2 - 3, y + 24);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillRect(x + T / 2 - 18, y + 10, 6, 6);
      }
    } else if (t === 9) { // flag base
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(x - 5, y, T + 10, T);
      ctx.fillStyle = "#6a6a6a";
      ctx.fillRect(x - 1, y + 3, T + 2, 6);
      ctx.fillStyle = "#222";
      ctx.fillRect(x + 6, y + 14, 6, 6);
      ctx.fillRect(x + 18, y + 14, 6, 6);
    }
  }

  function drawPlayer(time) {
    var p = player;
    if (invuln > 0 && phase === "play" && Math.floor(time * 11) % 2 === 0) return;
    var x = p.x - camX, y = p.y;
    var run = p.onGround && Math.abs(p.vx) > 22;
    var legSwing = run ? Math.sin(p.animT * 2.1) * 5.5 : 0;
    var big = p.big;
    var h = big ? 52 : 30;

    ctx.save();
    ctx.translate(x + p.w / 2, y + h);
    if (p.face < 0) ctx.scale(-1, 1);

    // Legs (blue overalls)
    ctx.fillStyle = "#1e3a8a";
    if (!p.onGround) {
      ctx.fillRect(-9, -13, 8, 13);
      ctx.fillRect(2, -17, 8, 11);
    } else if (run) {
      ctx.fillRect(-9, -13 + legSwing * 0.45, 8, 13);
      ctx.fillRect(1, -13 - legSwing * 0.45, 8, 13);
    } else {
      ctx.fillRect(-9, -13, 8, 13);
      ctx.fillRect(1, -13, 8, 13);
    }
    // Shoes
    ctx.fillStyle = "#6b2e0a";
    ctx.fillRect(-11, -5, 12, 5);
    ctx.fillRect(1, -5, 12, 5);

    // Torso
    var torsoH = big ? 20 : 9;
    ctx.fillStyle = "#1e3a8a";
    ctx.fillRect(-10, -13 - torsoH, 20, torsoH);
    // Yellow buttons
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-3, -13 - torsoH + 3, 6, 5);

    // Arms (red)
    ctx.fillStyle = "#dc2626";
    if (!p.onGround) {
      ctx.fillRect(-16, -13 - torsoH, 6, 14);
      ctx.fillRect(10, -13 - torsoH - 5, 6, 12);
    } else {
      var armSwing = run ? Math.sin(p.animT * 2.1 + 1.4) * 4.5 : 0;
      ctx.fillRect(-15, -13 - torsoH + armSwing * 0.5, 6, 12);
      ctx.fillRect(9, -13 - torsoH - armSwing * 0.5, 6, 12);
    }

    // Head
    var hy = -13 - torsoH;
    ctx.fillStyle = "#fcd9b0";
    ctx.fillRect(-8, hy - 13, 16, 13);

    // Cap (red)
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(-9, hy - 19, 18, 7);
    ctx.fillRect(1, hy - 14, 11, 4); // brim
    // White circle on cap
    ctx.fillStyle = "#fff";
    ctx.fillRect(-4, hy - 18, 8, 5);
    ctx.fillStyle = "#dc2626";
    ctx.font = "bold 7px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // (no letter, just white patch)

    // Eye
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(2, hy - 10, 3, 5);
    // Nose
    ctx.fillStyle = "#fcd9b0";
    ctx.fillRect(7, hy - 8, 4, 4);
    // Mustache
    ctx.fillStyle = "#3a1c00";
    ctx.fillRect(-1, hy - 4, 11, 3);

    ctx.restore();
  }

  function drawEnemy(e) {
    var x = e.x - camX, y = e.y;
    if (x < -50 || x > D.VIEW_W + 50) return;
    var step = Math.sin(e.animT) > 0 ? 3.5 : -3.5;

    if (e.type === "goomba") {
      // Body
      ctx.fillStyle = "#92400e";
      ctx.fillRect(x + 1, y + 5, 24, 17);
      // Darker feet area
      ctx.fillStyle = "#78350f";
      ctx.fillRect(x + 2, y + 17, 22, 5);
      // Feet
      ctx.fillStyle = "#3f2a0a";
      ctx.fillRect(x - 1 + step, y + 21, 11, 5);
      ctx.fillRect(x + 16 - step, y + 21, 11, 5);
      // Eyes (angry)
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + 5, y + 8, 6, 7);
      ctx.fillRect(x + 15, y + 8, 6, 7);
      ctx.fillStyle = "#111";
      ctx.fillRect(x + 8, y + 10, 3, 4);
      ctx.fillRect(x + 15, y + 10, 3, 4);
      // Brows
      ctx.fillStyle = "#3f2a0a";
      ctx.fillRect(x + 4, y + 7, 8, 2);
      ctx.fillRect(x + 14, y + 7, 8, 2);
    } else { // koopa
      // Shell
      ctx.fillStyle = "#16a34a";
      ctx.fillRect(x + 2, y + 8, 22, 14);
      ctx.fillStyle = "#bbf7d0";
      ctx.fillRect(x + 6, y + 13, 14, 7);
      // Head
      ctx.fillStyle = "#15803d";
      ctx.fillRect(x + 4, y, 18, 10);
      // Eye
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + 14, y + 2, 5, 5);
      ctx.fillStyle = "#111";
      ctx.fillRect(x + 16, y + 3, 3, 3);
      // Feet
      ctx.fillStyle = "#14532d";
      ctx.fillRect(x + step, y + 20, 9, 6);
      ctx.fillRect(x + 17 - step, y + 20, 9, 6);
      // Beak
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(x + 18, y + 5, 5, 3);
    }
  }

  function drawCastle() {
    var x = level.castleX - camX, baseY = 11 * D.TILE;
    if (x < -220 || x > D.VIEW_W + 80) return;
    var W2 = 160, H2 = 135;
    // Main body
    ctx.fillStyle = "#b85a20";
    ctx.fillRect(x, baseY - H2, W2, H2);
    // Battlements
    for (var i = 0; i < 5; i++) {
      ctx.fillRect(x + i * 34, baseY - H2 - 18, 22, 18);
    }
    // Tower
    ctx.fillRect(x + W2 / 2 - 28, baseY - H2 - 55, 56, 55);
    for (var j = 0; j < 3; j++) {
      ctx.fillRect(x + W2 / 2 - 28 + j * 22, baseY - H2 - 70, 14, 15);
    }
    // Door
    ctx.fillStyle = "#2a1000";
    ctx.fillRect(x + W2 / 2 - 18, baseY - 55, 36, 55);
    // Windows
    ctx.fillRect(x + 20, baseY - H2 + 28, 18, 18);
    ctx.fillRect(x + W2 - 38, baseY - H2 + 28, 18, 18);
    // Brick lines
    ctx.fillStyle = "rgba(80,25,0,0.45)";
    for (var r = 0; r < 7; r++) ctx.fillRect(x, baseY - H2 + 14 + r * 18, W2, 2);
  }

  function render(time) {
    var disp = ctx;
    ctx = bufCtx;
    ctx.setTransform(1 / PIXEL_SCALE, 0, 0, 1 / PIXEL_SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Sky gradient
    var sky = ctx.createLinearGradient(0, 0, 0, D.VIEW_H);
    sky.addColorStop(0, "#5b9cf5");
    sky.addColorStop(0.7, "#87ceeb");
    sky.addColorStop(1, "#b8e0ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, D.VIEW_W, D.VIEW_H);

    // Clouds (parallax)
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    var off = camX * 0.28;
    for (var ci = 0; ci < 9; ci++) {
      var cxp = ((ci * 360 - off) % 2600 + 2600) % 2600 - 220;
      var cy = 50 + (ci % 3) * 32;
      ctx.beginPath();
      ctx.arc(cxp, cy, 28, 0, 6.283);
      ctx.arc(cxp + 28, cy, 22, 0, 6.283);
      ctx.arc(cxp - 26, cy, 20, 0, 6.283);
      ctx.arc(cxp + 12, cy - 12, 16, 0, 6.283);
      ctx.fill();
    }

    // Hills (parallax)
    ctx.fillStyle = "#3d9e2f";
    var off2 = camX * 0.52;
    for (var hi = 0; hi < 8; hi++) {
      var hx = ((hi * 480 - off2) % 2800 + 2800) % 2800 - 280;
      ctx.beginPath();
      ctx.moveTo(hx, 11 * D.TILE);
      ctx.lineTo(hx + 140, 11 * D.TILE - 75 - (hi % 2) * 28);
      ctx.lineTo(hx + 280, 11 * D.TILE);
      ctx.closePath();
      ctx.fill();
    }

    // Tiles
    var c0 = Math.max(0, Math.floor(camX / D.TILE) - 1);
    var c1 = Math.min(level.levelW - 1, Math.ceil((camX + D.VIEW_W) / D.TILE) + 1);
    for (var ty = 0; ty < D.ROWS; ty++) {
      for (var tx = c0; tx <= c1; tx++) {
        var t = level.grid[ty][tx];
        if (t) drawTile(tx, ty, t, time);
      }
    }

    drawCastle();

    // Floating coins
    for (var k = 0; k < level.coins.length; k++) {
      var cn = level.coins[k];
      var qx = cn.c * D.TILE + D.TILE / 2 - camX, qy = cn.r * D.TILE + D.TILE / 2;
      if (qx < -25 || qx > D.VIEW_W + 25) continue;
      var sq = Math.abs(Math.cos(time * 4.2 + cn.c));
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.ellipse(qx, qy, 5 + 7 * sq, 11, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.ellipse(qx, qy, 2.5 + 3.5 * sq, 7, 0, 0, 6.283);
      ctx.fill();
    }

    // Coin rise anims
    for (var s = 0; s < coinAnims.length; s++) {
      var ca = coinAnims[s];
      var ay = ca.y - ca.age * 270;
      ctx.globalAlpha = 1 - ca.age / 0.42;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.ellipse(ca.x - camX, ay, 9, 12, 0, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Mushrooms
    for (var m = 0; m < items.length; m++) {
      var it = items[m];
      if (it.dead) continue;
      var ix = it.x - camX, iy = it.y;
      // Cap
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(ix, iy, 24, 12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(ix + 4, iy + 2, 5, 5);
      ctx.fillRect(ix + 15, iy + 2, 5, 5);
      // Stem
      ctx.fillStyle = "#fcd9b0";
      ctx.fillRect(ix + 4, iy + 12, 16, 12);
      // Eyes
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(ix + 7, iy + 15, 3, 4);
      ctx.fillRect(ix + 14, iy + 15, 3, 4);
    }

    // Enemies
    for (var e = 0; e < enemies.length; e++) {
      if (enemies[e].alive) drawEnemy(enemies[e]);
    }

    // Player
    if (player) drawPlayer(time);

    // Particles
    for (var p = 0; p < parts.length; p++) {
      var pt = parts[p];
      ctx.globalAlpha = 1 - pt.age / pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - camX - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // Floating scores
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var f = 0; f < floats.length; f++) {
      var fl = floats[f];
      ctx.globalAlpha = 1 - fl.age / fl.life;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px monospace";
      ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
      var fx = fl.x - camX, fy = fl.y - fl.age * 55;
      ctx.strokeText(fl.text, fx, fy);
      ctx.fillText(fl.text, fx, fy);
    }
    ctx.globalAlpha = 1;

    // Upscale
    ctx = disp;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, D.VIEW_W, D.VIEW_H);
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
        { text: "🔄 شروع دوباره", ghost: true, onClick: function () { paused = false; startGame(); } }
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
    "نسخهٔ کامل با <b>۳ مرحله</b><br>" +
    "بدو، بپر، سکه جمع کن و به پرچم برس!<br>" +
    "دکمهٔ <b>A</b> پرش — نگهش دار تا <b>بلندتر</b> بپری.<br>" +
    "دکمهٔ <b>B</b> دویدن تند است.<br>" +
    "قارچ بخور تا بزرگ شوی و آجرها را بشکنی!",
    [{ text: "▶ شروع بازی", onClick: startGame }]
  );
  requestAnimationFrame(frame);
})();
