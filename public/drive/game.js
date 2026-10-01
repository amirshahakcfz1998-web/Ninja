"use strict";
/* Drive — pseudo-3D pixel-art racer (behind-the-car view, Sega/OutRun style)
   for the Gameifyr Telegram bot. Vanilla JS + Canvas, no build step.
   Controls: on-screen buttons, touch drag, or arrow keys.
   GAME LOGIC IS UNCHANGED (3 lanes, traffic, coins, overtakes, levels):
   level = 1 + floor(score/500); speed, spawn rate and double-spawn chance
   all scale with level. Only the rendering was replaced: the logic world
   (x, y, hitboxes) is projected onto a perspective road.
   Telegram context arrives via URL params (added by the worker):
   uid, cid, mid, imid, game. */

// ================= PURE LOGIC (no DOM — unit testable) =================
var Drive = (function () {
  var W = 420, H = 720;
  var ROAD_X = 60, ROAD_W = 300, LANES = 3;
  var LANE_W = ROAD_W / LANES; // 100
  var PLAYER_Y = H - 150;
  var CAR_W = 56, CAR_H = 96;

  // Camera (visual only): horizon line and camera distance in logic units.
  var HORIZON = 300, CAM_D = 400;

  function laneCenter(lane) {
    return ROAD_X + LANE_W * (lane + 0.5);
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  // ---- Difficulty formula ----
  // Every 500 points -> +1 level. Speed, traffic density and the chance of
  // two cars spawning at once all grow with the level.
  function levelForScore(score) {
    return 1 + Math.floor(Math.max(0, score) / 500);
  }
  function speedForLevel(level) {
    return Math.min(950, 430 * (1 + 0.085 * (level - 1)));
  }
  function spawnIntervalForLevel(level) {
    return Math.max(0.42, 1.35 - 0.085 * (level - 1));
  }
  function doubleSpawnChance(level) {
    return Math.min(0.55, 0.08 * Math.max(0, level - 1));
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function carRect(x, y) {
    return { x: x - CAR_W / 2, y: y - CAR_H / 2, w: CAR_W, h: CAR_H };
  }

  // Slightly forgiving hitbox (92% of the sprite).
  function hitRect(x, y) {
    var r = carRect(x, y);
    var sx = r.w * 0.04, sy = r.h * 0.04;
    return { x: r.x + sx, y: r.y + sy, w: r.w - sx * 2, h: r.h - sy * 2 };
  }

  // Pick 1 or 2 spawn lanes, never blocking all 3 at once.
  function pickSpawnLanes(rand, level) {
    var two = rand() < doubleSpawnChance(level);
    var i = Math.floor(rand() * 3);
    if (!two) return [i];
    var j = Math.floor(rand() * 3);
    if (j === i) j = (j + 1) % 3;
    return [i, j];
  }

  // ---- Projection (visual only, never used for collisions) ----
  // Logic y -> perspective scale (1 at the player's row, smaller far away).
  function scaleAt(y) {
    var d = PLAYER_Y - y;
    return d >= 0 ? CAM_D / (CAM_D + d) : 1 + (-d) / CAM_D;
  }
  function screenY(y) {
    return HORIZON + scaleAt(y) * (PLAYER_Y - HORIZON);
  }
  function screenX(x, y) {
    return W / 2 + (x - W / 2) * scaleAt(y);
  }

  return {
    W: W, H: H,
    ROAD_X: ROAD_X, ROAD_W: ROAD_W, LANES: LANES, LANE_W: LANE_W,
    PLAYER_Y: PLAYER_Y, CAR_W: CAR_W, CAR_H: CAR_H,
    HORIZON: HORIZON, CAM_D: CAM_D,
    laneCenter: laneCenter,
    clamp: clamp,
    levelForScore: levelForScore,
    speedForLevel: speedForLevel,
    spawnIntervalForLevel: spawnIntervalForLevel,
    doubleSpawnChance: doubleSpawnChance,
    rectsOverlap: rectsOverlap,
    carRect: carRect,
    hitRect: hitRect,
    pickSpawnLanes: pickSpawnLanes,
    scaleAt: scaleAt,
    screenY: screenY,
    screenX: screenX
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Drive;
} else {
  browserBoot(Drive);
}

/* ================= BROWSER GAME ================= */
function browserBoot(D) {
  // Show any script error on the message card (debug aid; invisible when healthy).
  // Registered first so load-time failures are visible too.
  window.addEventListener("error", function (e) {
    try {
      var mel = document.getElementById("message");
      var mtel = document.getElementById("messageText");
      if (mel && mtel) {
        mel.classList.remove("hidden");
        var small = document.createElement("small");
        small.style.color = "#f87171";
        small.textContent = "خطا: " + (e.message || e.type || "unknown");
        mtel.appendChild(document.createElement("br"));
        mtel.appendChild(small);
      }
    } catch (_) { /* never break the game */ }
  });

  // ---------- DOM ----------
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  // Pixel-art look: the whole scene is drawn to a low-res buffer
  // (210x360), then upscaled with smoothing off so pixels stay chunky.
  var PIX = 2;
  var LW = Math.floor(D.W / PIX), LH = Math.floor(D.H / PIX);
  var low = document.createElement("canvas");
  low.width = LW;
  low.height = LH;
  var lctx = low.getContext("2d");
  lctx.imageSmoothingEnabled = false;

  var CX = D.W / 2, HZ = D.HORIZON, PSY = D.PLAYER_Y, CAM = D.CAM_D;

  var scoreEl = document.getElementById("score");
  var levelEl = document.getElementById("level");
  var speedEl = document.getElementById("speed");
  var pauseButton = document.getElementById("pauseButton");
  var muteButton = document.getElementById("muteButton");
  var message = document.getElementById("message");
  var messageTitle = document.getElementById("messageTitle");
  var messageText = document.getElementById("messageText");
  var cardButtons = document.getElementById("cardButtons");
  var leftBtn = document.getElementById("leftBtn");
  var rightBtn = document.getElementById("rightBtn");

  function fa(n) {
    return String(n).replace(/[0-9]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹"[+d]; });
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = D.clamp((n >> 16) + amt, 0, 255);
    var g = D.clamp(((n >> 8) & 255) + amt, 0, 255);
    var b = D.clamp((n & 255) + amt, 0, 255);
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- AUDIO (Web Audio, no files) ----------
  var Sound = {
    ctx: null,
    muted: load("driveMuted") === "1",
    engOsc: null, engGain: null, engFilter: null,
    ensure: function () {
      try {
        if (!this.ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      } catch (_) { this.ctx = null; }
    },
    tone: function (freq, dur, type, vol, delay) {
      if (this.muted) return;
      try {
        this.ensure();
        if (!this.ctx) return;
        var t0 = this.ctx.currentTime + (delay || 0);
        var o = this.ctx.createOscillator();
        var g = this.ctx.createGain();
        o.type = type || "sine";
        o.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t0); o.stop(t0 + dur + 0.05);
      } catch (_) {}
    },
    noise: function (dur, vol) {
      if (this.muted) return;
      try {
        this.ensure();
        if (!this.ctx) return;
        var t0 = this.ctx.currentTime;
        var len = Math.floor(this.ctx.sampleRate * dur);
        var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        var src = this.ctx.createBufferSource();
        src.buffer = buf;
        var g = this.ctx.createGain();
        g.gain.setValueAtTime(vol || 0.3, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        var f = this.ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 900;
        src.connect(f); f.connect(g); g.connect(this.ctx.destination);
        src.start(t0);
      } catch (_) {}
    },
    click: function () { this.tone(600, 0.06, "square", 0.06); },
    coin: function () {
      this.tone(988, 0.09, "sine", 0.16);
      this.tone(1319, 0.14, "sine", 0.16, 0.08);
    },
    nearMiss: function () { this.tone(740, 0.08, "triangle", 0.1); },
    crash: function () {
      this.noise(0.5, 0.4);
      this.tone(90, 0.5, "sawtooth", 0.25);
      this.tone(55, 0.7, "sine", 0.3, 0.05);
    },
    levelUp: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) {
        self.tone(f, 0.12, "triangle", 0.14, i * 0.09);
      });
    },
    start: function () {
      this.tone(392, 0.1, "triangle", 0.14);
      this.tone(523, 0.1, "triangle", 0.14, 0.1);
      this.tone(659, 0.18, "triangle", 0.14, 0.2);
    },
    engineStart: function () {
      if (this.muted) return;
      try {
        this.ensure();
        if (!this.ctx || this.engOsc) return;
        var o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = 55;
        var f = this.ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 320;
        var g = this.ctx.createGain();
        g.gain.value = 0.045;
        o.connect(f); f.connect(g); g.connect(this.ctx.destination);
        o.start();
        this.engOsc = o; this.engGain = g; this.engFilter = f;
      } catch (_) {}
    },
    engineSet: function (ratio) {
      try {
        if (!this.engOsc || !this.ctx) return;
        var t = this.ctx.currentTime;
        this.engOsc.frequency.setTargetAtTime(55 + ratio * 90, t, 0.1);
        this.engFilter.frequency.setTargetAtTime(300 + ratio * 700, t, 0.1);
      } catch (_) {}
    },
    engineStop: function () {
      try {
        if (this.engOsc) { this.engOsc.stop(); }
      } catch (_) {}
      this.engOsc = null; this.engGain = null; this.engFilter = null;
    },
    setMuted: function (m) {
      this.muted = m;
      store("driveMuted", m ? "1" : "0");
      if (m) this.engineStop();
      else if (state === "playing") this.engineStart();
      if (muteButton) muteButton.textContent = m ? "🔇" : "🔊";
    }
  };


  // ---------- STATE ----------
  var state = "menu"; // menu | playing | paused | over
  var score = 0, level = 1, coinCount = 0, overtakeCount = 0;
  var best = parseInt(load("driveBest") || "0", 10) || 0;
  var serverBest = NaN, isRecord = false;
  var speed = 0; // px/s, ramps toward target
  var roadOffset = 0;
  var spawnTimer = 0;
  var player = { lane: 1, x: D.laneCenter(1), tilt: 0 };
  var enemies = [];   // {lane,x,y,color,rel,passed}
  var coinsArr = [];  // {lane,x,y,phase}
  var parts = [];     // particles in SCREEN space {x,y,vx,vy,life,max,size,color,grav}
  var floaters = [];  // SCREEN space {x,y,text,life,color}
  var decor = [];     // roadside {off,y,kind}  (off = lateral offset from road centre)
  var decorTimer = 0;
  var shake = 0;      // crash screen shake
  var animT = 0;      // global animation clock

  var ENEMY_COLORS = ["#2f6fe0", "#f5c518", "#22a55a", "#8b5cf6", "#f97316", "#e5e7eb"];
  var PLAYER_COLOR = "#e3202e";

  function populateDecor() {
    decor = [];
    for (var y = -1500; y < 760; y += 150 + Math.random() * 120) {
      spawnDecor(y);
    }
  }

  function reset() {
    score = 0; level = 1; coinCount = 0; overtakeCount = 0;
    isRecord = false; serverBest = NaN;
    speed = 0; roadOffset = 0; spawnTimer = 0.8;
    player.lane = 1; player.x = D.laneCenter(1); player.tilt = 0;
    enemies = []; coinsArr = []; parts = []; floaters = [];
    populateDecor();
    decorTimer = 0; shake = 0;
    updateHUD();
  }

  function updateHUD() {
    if (scoreEl) scoreEl.textContent = fa(Math.floor(score));
    if (levelEl) levelEl.textContent = fa(level);
    if (speedEl) speedEl.textContent = fa(Math.round(speed * 0.35));
  }

  // ---------- INPUT ----------

  // Touch / mouse drag on the canvas: swipe sideways to change lane.
  var dragX = null;
  function ptrX(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientX;
    return e.clientX;
  }
  canvas.addEventListener("pointerdown", function (e) {
    dragX = ptrX(e);
    Sound.ensure();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragX == null || state !== "playing") return;
    var dx = ptrX(e) - dragX;
    if (Math.abs(dx) > 34) {
      changeLane(dx > 0 ? 1 : -1);
      dragX = ptrX(e);
    }
  });
  window.addEventListener("pointerup", function () { dragX = null; });

  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      if (state === "playing") changeLane(-1);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      if (state === "playing") changeLane(1);
      e.preventDefault();
    } else if (e.key === "p" || e.key === "P" || e.key === "Escape") {
      if (state === "playing") pauseGame();
      else if (state === "paused") resumeGame();
    } else if (e.key === "m" || e.key === "M") {
      Sound.setMuted(!Sound.muted);
    }
  });

  function changeLane(dir) {
    var nl = D.clamp(player.lane + dir, 0, D.LANES - 1);
    if (nl !== player.lane) {
      player.lane = nl;
      Sound.click();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") pauseGame();
  });

  // ---------- SPAWN ----------
  function spawnTraffic() {
    var lanes = D.pickSpawnLanes(Math.random, level);
    for (var k = 0; k < lanes.length; k++) {
      var lane = lanes[k];
      enemies.push({
        lane: lane,
        x: D.laneCenter(lane),
        y: -D.CAR_H,
        color: ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)],
        rel: 0.34 + Math.random() * 0.28, // fraction of player speed
        passed: false
      });
    }
    // Coin in a free lane (keeps the game rewarding at high density).
    var free = [0, 1, 2].filter(function (l) { return lanes.indexOf(l) < 0; });
    if (free.length && Math.random() < 0.55) {
      var cl = free[Math.floor(Math.random() * free.length)];
      coinsArr.push({ lane: cl, x: D.laneCenter(cl), y: -30, phase: Math.random() * 6.28 });
    }
  }

  // Roadside scenery. Left = beach side (lamps + palms), right = trees/bushes.
  // kind: 0 lamp, 1 tree, 2 palm, 3 bush
  function spawnDecor(y) {
    var side = Math.random() < 0.45 ? -1 : 1;
    var kind, off;
    if (side < 0) {
      kind = Math.random() < 0.5 ? 0 : 2;
      off = kind === 0 ? -(188 + Math.random() * 6) : -(215 + Math.random() * 80);
    } else {
      kind = Math.random() < 0.75 ? 1 : 3;
      off = 192 + Math.random() * 240;
    }
    decor.push({ off: off, y: y == null ? -1500 : y, kind: kind });
  }

  // Screen-space particle burst.
  function burst(x, y, n, colors, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283;
      var s = spd * (0.3 + Math.random() * 0.7);
      parts.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, max: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        grav: 300
      });
    }
  }

  function floater(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, life: 0, max: 1.1, color: color || "#fde047" });
  }

  // Particles, floaters and shake (also runs after a crash).
  function updateFx(dt) {
    for (var p = parts.length - 1; p >= 0; p--) {
      var pt = parts[p];
      pt.life += dt;
      if (pt.life >= pt.max) { parts.splice(p, 1); continue; }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += pt.grav * dt;
    }
    for (var f = floaters.length - 1; f >= 0; f--) {
      var fl = floaters[f];
      fl.life += dt;
      fl.y -= 46 * dt;
      if (fl.life >= fl.max) floaters.splice(f, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
  }

  // ---------- UPDATE ----------
  function update(dt) {
    var newLevel = D.levelForScore(score);
    if (newLevel !== level) {
      level = newLevel;
      Sound.levelUp();
      floater(D.W / 2, D.H * 0.35, "لول " + fa(level) + " 🔥", "#fb923c");
    }

    var targetSpeed = D.speedForLevel(level);
    speed += (targetSpeed - speed) * Math.min(1, dt * 1.6);
    score += speed * dt * 0.025;
    roadOffset = (roadOffset + speed * dt) % 280;

    // Player lateral motion (smooth, with lean for juice).
    var tx = D.laneCenter(player.lane);
    var px = player.x;
    player.x += (tx - player.x) * Math.min(1, dt * 9);
    player.tilt = D.clamp((player.x - px) * 0.06, -0.35, 0.35);

    // Traffic spawn.
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = D.spawnIntervalForLevel(level) * (0.85 + Math.random() * 0.3);
      spawnTraffic();
    }

    // Roadside decor.
    decorTimer -= dt;
    if (decorTimer <= 0) {
      decorTimer = 0.25 + Math.random() * 0.5;
      spawnDecor();
    }

    var pHit = D.hitRect(player.x, D.PLAYER_Y);

    // Enemies.
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      e.y += speed * e.rel * dt;
      if (e.y > D.H + D.CAR_H) { enemies.splice(i, 1); continue; }
      if (!e.passed && e.y - D.CAR_H / 2 > D.PLAYER_Y + D.CAR_H / 2) {
        e.passed = true;
        var gap = Math.abs(e.x - player.x);
        if (gap < D.LANE_W + 20) {
          score += 10;
          overtakeCount++;
          Sound.nearMiss();
          floater(player.x, D.PLAYER_Y - 90, "+۱۰ سبقت!", "#7dd3fc");
        }
      }
      if (D.rectsOverlap(pHit, D.hitRect(e.x, e.y))) {
        crash();
        return;
      }
    }

    // Coins.
    for (var j = coinsArr.length - 1; j >= 0; j--) {
      var c = coinsArr[j];
      c.y += speed * dt;
      c.phase += dt * 6;
      if (c.y > D.H + 30) { coinsArr.splice(j, 1); continue; }
      var dx = c.x - player.x, dy = c.y - D.PLAYER_Y;
      if (dx * dx + dy * dy < 42 * 42) {
        coinsArr.splice(j, 1);
        coinCount++;
        score += 25;
        Sound.coin();
        var csx = D.screenX(c.x, c.y), csy = D.screenY(c.y) - 14;
        burst(csx, csy, 10, ["#fde047", "#fbbf24", "#fff7cc"], 160);
        floater(csx, csy - 20, "+۲۵", "#fde047");
      }
    }

    // Decor.
    for (var k = decor.length - 1; k >= 0; k--) {
      decor[k].y += speed * dt;
      if (decor[k].y > D.H + 200) decor.splice(k, 1);
    }

    updateFx(dt);

    // Exhaust puffs while driving (screen space, rise behind the car).
    if (Math.random() < dt * 14) {
      parts.push({
        x: player.x + (Math.random() - 0.5) * 40,
        y: PSY - 6,
        vx: (Math.random() - 0.5) * 24, vy: -10 - Math.random() * 30,
        life: 0, max: 0.35 + Math.random() * 0.3,
        size: 3 + Math.random() * 4, color: "#dfe4ee", grav: 0, smoke: true
      });
    }

    Sound.engineSet(speed / 950);
    updateHUD();
  }

  function crash() {
    state = "over";
    shake = 14;
    Sound.crash();
    Sound.engineStop();
    burst(player.x, PSY - 28, 46, ["#f97316", "#ef4444", "#fbbf24", "#78716c"], 340);
    if (pauseButton) pauseButton.classList.add("hidden");
    var finalScore = Math.floor(score);
    setTimeout(function () { finishRace(finalScore); }, 650);
  }

  function quitToGameOver() {
    state = "over";
    Sound.engineStop();
    if (pauseButton) pauseButton.classList.add("hidden");
    finishRace(Math.floor(score));
  }

  // ---------- PIXEL-ART ASSETS (all generated in code, no image files) ----------
  function mk(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  // Rear view of a sports car, 40x28 sprite pixels (1 sprite px = 1 low-res px).
  var carCache = {};
  function carSprite(color, sporty) {
    var key = color + (sporty ? "S" : "N");
    if (carCache[key]) return carCache[key];
    var c = mk(40, 28), g = c.getContext("2d");
    function R(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
    var hi = shade(color, 42), mid = color, lo = shade(color, -42), dk = shade(color, -85);

    // Cabin (trapezoid) + rear window.
    for (var y = 1; y < 10; y++) {
      var inset = Math.floor((y - 1) * 0.55);
      R(13 - inset, y, 14 + inset * 2, 1, y < 3 ? hi : mid);
    }
    for (var gy = 3; gy < 9; gy++) {
      var gi = Math.floor((gy - 3) * 0.55);
      R(15 - gi, gy, 10 + gi * 2, 1, "#16233f");
    }
    R(17, 4, 4, 1, "#3a5a8e"); R(16, 5, 3, 1, "#2c4777"); // glass glint
    // Trunk lid.
    R(4, 10, 32, 2, hi);
    // Spoiler (player car).
    if (sporty) {
      R(3, 9, 34, 2, lo); R(3, 9, 34, 1, mid);
      R(7, 11, 2, 3, dk); R(31, 11, 2, 3, dk);
      R(2, 10, 3, 3, mid); R(35, 10, 3, 3, mid); // mirrors / wing tips
    }
    // Rear panel.
    R(4, 12, 32, 9, mid);
    R(4, 12, 2, 9, lo); R(34, 12, 2, 9, lo);
    R(6, 12, 28, 1, hi);
    // Tail lights + dark strip between.
    R(6, 13, 10, 4, "#6e0d10"); R(24, 13, 10, 4, "#6e0d10");
    R(7, 14, 8, 2, "#ff3b2e"); R(25, 14, 8, 2, "#ff3b2e");
    R(8, 14, 3, 1, "#ffb48a"); R(26, 14, 3, 1, "#ffb48a");
    R(16, 14, 8, 2, dk);
    // Plate.
    R(16, 17, 8, 3, "#2b2d3a"); R(17, 18, 6, 1, "#555a70");
    // Lower bumper.
    R(5, 20, 30, 4, lo); R(5, 23, 30, 1, dk);
    if (sporty) {
      R(7, 21, 6, 3, "#14141c"); R(8, 22, 4, 1, "#8a92a6");
      R(27, 21, 6, 3, "#14141c"); R(28, 22, 4, 1, "#8a92a6");
    }
    // Tires.
    R(1, 18, 6, 10, "#0e0e14"); R(33, 18, 6, 10, "#0e0e14");
    R(2, 18, 4, 1, "#343440"); R(34, 18, 4, 1, "#343440");
    carCache[key] = c;
    return c;
  }

  var propCache = {};
  function treeSprite() {
    if (propCache.tree) return propCache.tree;
    var c = mk(32, 42), g = c.getContext("2d"), r = rng(7);
    g.fillStyle = "#5a3a1e"; g.fillRect(14, 28, 4, 14);
    g.fillStyle = "#7d552b"; g.fillRect(14, 28, 2, 14);
    var cols = ["#1d6a2c", "#2a8a3a", "#3fae4a", "#74d66c"];
    for (var y = 0; y < 31; y++) {
      for (var x = 0; x < 32; x++) {
        var dx = (x - 16) / 15, dy = (y - 15) / 14.5;
        if (dx * dx + dy * dy <= 1 + (r() - 0.5) * 0.14) {
          var l = -dx * 0.5 - dy * 0.75 + (r() - 0.5) * 0.45;
          g.fillStyle = cols[l > 0.55 ? 3 : l > 0.1 ? 2 : l > -0.4 ? 1 : 0];
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    propCache.tree = c;
    return c;
  }
  function palmSprite() {
    if (propCache.palm) return propCache.palm;
    var c = mk(36, 48), g = c.getContext("2d");
    for (var y = 12; y < 48; y++) {
      var x = 17 + Math.round(Math.sin((48 - y) / 48 * 1.3) * 3);
      g.fillStyle = (y % 4 < 2) ? "#8a6234" : "#6e4a26";
      g.fillRect(x, y, 3, 1);
    }
    var tx = 17 + Math.round(Math.sin(1.3) * 3) + 1, ty = 12;
    var angs = [-0.2, 0.35, 0.9, 2.25, 2.8, 3.35, -1.0, 4.1];
    for (var i = 0; i < angs.length; i++) {
      for (var t = 0; t < 15; t++) {
        var fx = tx + Math.cos(angs[i]) * t * 1.15;
        var fy = ty + Math.sin(angs[i]) * t * 0.55 + t * t * 0.04;
        g.fillStyle = (t % 5 < 2) ? "#2f9a3d" : "#1f7a30";
        g.fillRect(Math.round(fx), Math.round(fy), 2, 2);
      }
    }
    g.fillStyle = "#6b4a22"; g.fillRect(tx - 2, ty + 1, 3, 3);
    propCache.palm = c;
    return c;
  }
  function lampSprite() {
    if (propCache.lamp) return propCache.lamp;
    var c = mk(12, 44), g = c.getContext("2d");
    g.fillStyle = "#59647a"; g.fillRect(4, 8, 2, 36);
    g.fillStyle = "#7f8aa0"; g.fillRect(4, 8, 1, 36);
    g.fillStyle = "#59647a"; g.fillRect(4, 6, 7, 2);
    g.fillStyle = "#ffe27a"; g.fillRect(8, 8, 3, 2);
    propCache.lamp = c;
    return c;
  }
  function bushSprite() {
    if (propCache.bush) return propCache.bush;
    var c = mk(22, 12), g = c.getContext("2d"), r = rng(11);
    var cols = ["#1f6f2e", "#2f9440", "#58c35a"];
    for (var y = 0; y < 12; y++) {
      for (var x = 0; x < 22; x++) {
        var dx = (x - 11) / 11, dy = (y - 7) / 6;
        if (dx * dx + dy * dy <= 1) {
          var l = -dy * 0.8 - dx * 0.3 + (r() - 0.5) * 0.5;
          g.fillStyle = cols[l > 0.35 ? 2 : l > -0.2 ? 1 : 0];
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    propCache.bush = c;
    return c;
  }

  // Static backdrop above the horizon: sky, mountains, coast, city + tower.
  var bgCanvas = (function () {
    var bw = LW, bh = Math.floor(HZ / PIX);
    var c = mk(bw, bh), g = c.getContext("2d");
    function R(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
    var r = rng(2026);

    // Banded sky.
    var sky = ["#2a7cf0", "#3688f2", "#4695f4", "#58a3f6", "#6cb2f8", "#84c2fa", "#9fd1fb", "#bde2fc"];
    var bandH = Math.ceil(bh / sky.length);
    for (var i = 0; i < sky.length; i++) R(0, i * bandH, bw, bandH + 1, sky[i]);

    // Mountains (two layers, lit from the left).
    function mountains(peaks, light, dark, snow) {
      for (var x = 0; x < bw; x++) {
        var h = 0, lit = true;
        for (var p = 0; p < peaks.length; p++) {
          var pk = peaks[p];
          var hh = pk.h * (1 - Math.abs(x - pk.x) / pk.w);
          if (hh > h) { h = hh; lit = x <= pk.x; }
        }
        h = Math.floor(h / 2) * 2; // stepped silhouette
        if (h > 0) {
          R(x, bh - h, 1, h, lit ? light : dark);
          if (snow && h > 40) R(x, bh - h, 1, 2, "#dbe6ff");
        }
      }
    }
    mountains([{ x: 20, h: 28, w: 40 }, { x: 70, h: 24, w: 48 }, { x: 118, h: 16, w: 40 }], "#8da6dc", "#7a92cc", false);
    mountains([{ x: 44, h: 54, w: 62 }, { x: 96, h: 32, w: 44 }, { x: 8, h: 30, w: 30 }], "#6f87c8", "#5469ad", true);

    // Far city strip on the left of the tower.
    var cols = ["#7f93bb", "#9aa9c9", "#8aa0c8"];
    for (var bx = 78; bx < 130; bx += 5 + Math.floor(r() * 5)) {
      var bhh = 10 + Math.floor(r() * 24);
      var bww = 4 + Math.floor(r() * 4);
      R(bx, bh - bhh, bww, bhh, cols[Math.floor(r() * 3)]);
    }
    // Main skyline.
    var pal = ["#5d7db0", "#7f93bb", "#b8a89c", "#4b6a9e", "#a2b2d0", "#6f86b6"];
    for (var bx2 = 108; bx2 < bw + 6; bx2 += 9 + Math.floor(r() * 6)) {
      var bh2 = 24 + Math.floor(r() * 46);
      var bw2 = 9 + Math.floor(r() * 7);
      var col = pal[Math.floor(r() * pal.length)];
      R(bx2, bh - bh2, bw2, bh2, col);
      R(bx2, bh - bh2, 1, bh2, shade(col, 26)); // lit edge
      for (var wy = bh - bh2 + 3; wy < bh - 3; wy += 4) {
        for (var wx = bx2 + 2; wx < bx2 + bw2 - 1; wx += 3) {
          if (r() < 0.72) R(wx, wy, 1, 2, "#d2e2f6");
        }
      }
    }
    // Tower.
    var tx = 168;
    R(tx, bh - 104, 3, 104, "#7d8fbd");
    R(tx, bh - 104, 1, 104, "#a3b2d8");
    R(tx - 4, bh - 82, 11, 5, "#8fa0c8"); R(tx - 3, bh - 77, 9, 2, "#66759f");
    R(tx - 2, bh - 106, 7, 3, "#8fa0c8");
    R(tx + 1, bh - 128, 1, 24, "#8fa0c8");

    // Tree line along the horizon (right) + distant coast (left).
    R(0, bh - 2, 62, 2, "#6e9bbf");
    for (var tx2 = 56; tx2 < bw; tx2 += 3 + Math.floor(r() * 4)) {
      var th = 3 + Math.floor(r() * 4);
      R(tx2, bh - th, 4 + Math.floor(r() * 3), th, r() < 0.5 ? "#2f7d3a" : "#3a9246");
    }
    // Soft haze at the horizon.
    g.fillStyle = "rgba(220,238,255,0.35)";
    g.fillRect(0, bh - 4, bw, 4);
    return c;
  })();

  var clouds = [
    { x: 14, y: 36, w: 26, v: 1.6 }, { x: 96, y: 22, w: 34, v: 1.1 },
    { x: 150, y: 54, w: 22, v: 1.9 }, { x: 52, y: 64, w: 18, v: 1.3 },
    { x: 182, y: 30, w: 28, v: 1.4 }
  ];

  // ---------- LOW-RES DRAW HELPERS ----------
  function lrect(x, y, w, h, col) { // low-res units
    lctx.fillStyle = col;
    lctx.fillRect(x, y, w, h);
  }
  function span(x0, x1, ry, col, h) { // x in logic units, ry = low row
    var a = Math.round(x0 / PIX), b = Math.round(x1 / PIX);
    if (a < 0) a = 0;
    if (b > LW) b = LW;
    if (b <= a) return;
    lctx.fillStyle = col;
    lctx.fillRect(a, ry, b - a, h || 1);
  }
  function ell(lx, ly, rx, ry, col) { // filled pixel ellipse (low-res units)
    lctx.fillStyle = col;
    var n = Math.max(1, Math.round(ry));
    for (var dy = -n; dy <= n; dy++) {
      var hw = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (n * n)));
      lctx.fillRect(Math.round(lx - hw), Math.round(ly + dy), Math.max(1, Math.round(hw * 2)), 1);
    }
  }

  function drawClouds() {
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      var x = Math.floor(((cl.x + animT * cl.v) % (LW + 60)) - 30);
      var y = cl.y, w = cl.w;
      lrect(x + 4, y, Math.floor(w * 0.5), 3, "#ffffff");
      lrect(x + 1, y + 2, w - 2, 3, "#ffffff");
      lrect(x, y + 4, w, 2, "#ffffff");
      lrect(x + 2, y + 6, w - 4, 1, "#cfe4fb");
    }
  }

  // ---------- GROUND / ROAD (per-scanline perspective) ----------
  function drawGround() {
    var r0 = Math.ceil(HZ / PIX);
    for (var ry = r0; ry < LH; ry++) {
      var yc = ry * PIX + PIX / 2;
      var s = (yc - HZ) / (PSY - HZ);
      var z = CAM / s;
      var band = s > 0.16 ? (Math.floor((z + roadOffset) / 70) & 1) : 0;

      var xL = CX - 150 * s, xR = CX + 150 * s;     // asphalt edges
      var rL = CX - 172 * s, rR = CX + 172 * s;     // guardrail line
      var sandL = CX - 310 * s;                     // sand -> sea boundary

      // Sea (left) + beach.
      var sea = s < 0.3 ? "#2fb0ea" : (band ? "#25a6e0" : "#2bb1e6");
      span(0, sandL, ry, sea);
      if (sandL > 0) {
        span(sandL, sandL + Math.max(PIX, 5 * s), ry, "#dff5fb"); // foam
        // sparkling waves
        if (((ry * 5 + Math.floor(animT * 2.5)) % 9) === 0) {
          var wx = (ry * 37) % Math.max(8, Math.floor(sandL - 10));
          span(wx, wx + Math.max(6, 16 * s), ry, "#7fd6f3");
        }
      }
      span(Math.max(0, sandL), rL, ry, band ? "#dcbd7c" : "#e8cc8d");
      // Grass (right).
      span(rR, D.W, ry, band ? "#3f9d3a" : "#47ab41");

      // Shoulder, asphalt, edge lines.
      span(xL - 22 * s, xL, ry, "#7a8092");
      span(xR, xR + 22 * s, ry, "#7a8092");
      span(xL, xR, ry, band ? "#464b5c" : "#3e4354");
      var ew = Math.max(PIX, 5 * s);
      span(xL, xL + ew, ry, "#f1f3f8");
      span(xR - ew, xR, ry, "#f1f3f8");

      // Lane dashes.
      if (s > 0.12 && ((z + roadOffset) % 56) < 30) {
        var dw = Math.max(PIX, 5 * s);
        span(CX - 50 * s - dw / 2, CX - 50 * s + dw / 2, ry, "#f1f3f8");
        span(CX + 50 * s - dw / 2, CX + 50 * s + dw / 2, ry, "#f1f3f8");
      }

      // Guardrails (a thin band whose height grows with perspective).
      var hh = Math.max(1, Math.round(13 * s / PIX));
      var rw = Math.max(1, Math.round(5 * s / PIX));
      var post = ((z + roadOffset) % 90) < 12;
      var topC = post ? "#6b748b" : "#e3e8f1";
      var botC = post ? "#4b5367" : "#9aa5b9";
      var lx1 = Math.round((rL - 5 * s) / PIX), rx1 = Math.round(rR / PIX);
      if (lx1 + rw > 0 && lx1 < LW) {
        lrect(lx1, ry - hh, rw, Math.max(1, Math.round(hh * 0.4)), topC);
        lrect(lx1, ry - hh + Math.round(hh * 0.4), rw, hh - Math.round(hh * 0.4) + 1, botC);
      }
      if (rx1 + rw > 0 && rx1 < LW) {
        lrect(rx1, ry - hh, rw, Math.max(1, Math.round(hh * 0.4)), topC);
        lrect(rx1, ry - hh + Math.round(hh * 0.4), rw, hh - Math.round(hh * 0.4) + 1, botC);
      }
    }
  }

  // ---------- ENTITY DRAWING ----------
  function drawSpriteAt(spr, sx, sy, s, scale, alpha, flipLean) {
    var dw = Math.round(spr.width * scale * s), dh = Math.round(spr.height * scale * s);
    if (dw < 1 || dh < 1) return;
    var dx = Math.round(sx / PIX - dw / 2), dy = Math.round(sy / PIX - dh);
    if (dx > LW || dx + dw < 0) return;
    if (alpha < 1) lctx.globalAlpha = alpha;
    lctx.drawImage(spr, dx, dy, dw, dh);
    if (alpha < 1) lctx.globalAlpha = 1;
  }

  function drawCarAt(x, y, color, sporty, lean) {
    var s = D.scaleAt(y);
    var sx = D.screenX(x, y), sy = D.screenY(y);
    if (sy < HZ || sy - 60 * s > D.H) return;
    var fade = D.clamp((s - 0.375) / 0.14, 0, 1);
    if (fade <= 0) return;
    var w = 80 * s, h = 56 * s;
    // Ground shadow.
    lctx.globalAlpha = 0.38 * fade;
    lrect(Math.round((sx - w * 0.54) / PIX), Math.round((sy - 4 * s) / PIX),
          Math.round(w * 1.08 / PIX), Math.max(1, Math.round(7 * s / PIX)), "#05060c");
    lctx.globalAlpha = 1;
    var spr = carSprite(color, sporty);
    var dw = Math.max(1, Math.round(w / PIX)), dh = Math.max(1, Math.round(h / PIX));
    var dx = Math.round(sx / PIX - dw / 2), dy = Math.round(sy / PIX - dh);
    if (fade < 1) lctx.globalAlpha = fade;
    if (lean) {
      // Lean the cabin against the steering direction (two-slice skew).
      var cut = Math.round(14 * dh / 28);
      var off = -Math.round(lean * 7);
      lctx.drawImage(spr, 0, 0, 40, 14, dx + off, dy, dw, cut);
      lctx.drawImage(spr, 0, 14, 40, 14, dx, dy + cut, dw, dh - cut);
    } else {
      lctx.drawImage(spr, dx, dy, dw, dh);
    }
    lctx.globalAlpha = 1;
  }

  function drawCoinAt(c) {
    var s = D.scaleAt(c.y);
    var sx = D.screenX(c.x, c.y), sy = D.screenY(c.y) - 15 * s;
    var fade = D.clamp((s - 0.375) / 0.14, 0, 1);
    if (fade <= 0 || sy < HZ - 10) return;
    var wob = Math.abs(Math.sin(c.phase)) * 0.6 + 0.4;
    var r = 15 * s / PIX;
    var lx = sx / PIX, ly = sy / PIX;
    lctx.globalAlpha = fade;
    lrect(Math.round(lx - r), Math.round(ly + r + 1), Math.round(r * 2), 1, "rgba(0,0,0,0.35)");
    ell(lx, ly, r * wob + 0.5, r, "#a86a0a");
    ell(lx, ly, r * wob * 0.86, r * 0.86, "#ffd21f");
    ell(lx, ly, r * wob * 0.55, r * 0.55, "#f2a900");
    lrect(Math.round(lx - r * wob * 0.5), Math.round(ly - r * 0.6), Math.max(1, Math.round(r * 0.35)), 1, "#fff6b8");
    lctx.globalAlpha = 1;
  }

  function drawDecorAt(d) {
    var s = D.scaleAt(d.y);
    var sy = D.screenY(d.y);
    var sx = CX + d.off * s;
    if (sx < -60 || sx > D.W + 60 || sy < HZ) return;
    var fade = D.clamp((s - 0.16) / 0.08, 0, 1);
    if (fade <= 0) return;
    var spr = d.kind === 0 ? lampSprite() : d.kind === 1 ? treeSprite() : d.kind === 2 ? palmSprite() : bushSprite();
    drawSpriteAt(spr, sx, sy, s, PIX, fade);
  }

  // ---------- HUD (3x5 pixel font) ----------
  var GL = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111",
    "3": "111001111001111", "4": "101101111001001", "5": "111100111001111",
    "6": "111100111101111", "7": "111001010010010", "8": "111101111101111",
    "9": "111101111001111", "P": "111101111100100", "O": "111101101101111",
    "S": "111100111001111", "K": "101101110101101", "M": "101111111101101",
    "H": "101101111101101", "/": "001001010100100"
  };
  function pixText(str, lx, ly, sc, col) {
    lctx.fillStyle = col;
    for (var k = 0; k < str.length; k++) {
      var m = GL[str.charAt(k)];
      if (m) {
        for (var i = 0; i < 15; i++) {
          if (m.charAt(i) === "1") lctx.fillRect(lx + (i % 3) * sc, ly + Math.floor(i / 3) * sc, sc, sc);
        }
      }
      lx += 4 * sc;
    }
  }
  function textW(str, sc) { return str.length * 4 * sc - sc; }
  function panel(x, y, w, h, col) {
    lrect(x + 2, y, w - 4, h, col);
    lrect(x, y + 2, w, h - 4, col);
    lrect(x + 1, y + 1, w - 2, h - 2, col);
  }

  function rankNow() {
    var n = 0;
    for (var i = 0; i < enemies.length; i++) if (enemies[i].y < D.PLAYER_Y) n++;
    return Math.min(5, n + 1);
  }

  function drawHUD() {
    var navy = "#12294f", edge = "#0b1a36";
    // Pause icon.
    panel(3, 3, 16, 14, navy);
    lrect(7, 6, 3, 8, "#ffffff"); lrect(12, 6, 3, 8, "#ffffff");
    // Position.
    panel(23, 3, 62, 14, navy);
    pixText("POS", 27, 5, 2, "#ffffff");
    pixText(String(rankNow()), 27 + 4 * 2 * 3 + 4, 5, 2, "#ffb300");
    pixText("/5", 27 + 4 * 2 * 4 + 4, 5, 2, "#ffffff");
    // Speed.
    var kmh = String(Math.round(speed * 0.35));
    var pw = 41, px = LW - 3 - pw;
    panel(px, 3, pw, 32, navy);
    pixText(kmh, px + pw - 4 - textW(kmh, 3), 6, 3, "#ffffff");
    pixText("KM/H", px + pw - 4 - textW("KM/H", 2), 23, 2, "#7ed0ff");
    lrect(px + 2, 34, pw - 4, 1, edge);
  }

  // ---------- RENDER ----------
  function render() {
    lctx.globalAlpha = 1;
    lctx.drawImage(bgCanvas, 0, 0);
    drawClouds();
    drawGround();

    // Painter's algorithm: far -> near.
    var items = [];
    var i;
    for (i = 0; i < decor.length; i++) items.push({ y: decor[i].y, t: 0, o: decor[i] });
    for (i = 0; i < coinsArr.length; i++) items.push({ y: coinsArr[i].y, t: 1, o: coinsArr[i] });
    for (i = 0; i < enemies.length; i++) items.push({ y: enemies[i].y, t: 2, o: enemies[i] });
    if (state !== "over") items.push({ y: D.PLAYER_Y, t: 3, o: player });
    items.sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.t === 0) drawDecorAt(it.o);
      else if (it.t === 1) drawCoinAt(it.o);
      else if (it.t === 2) drawCarAt(it.o.x, it.o.y, it.o.color, false, 0);
      else drawCarAt(player.x, D.PLAYER_Y, PLAYER_COLOR, true, player.tilt);
    }

    // Particles (screen space).
    for (var p = 0; p < parts.length; p++) {
      var pt = parts[p];
      var a = 1 - pt.life / pt.max;
      var sz = pt.smoke ? pt.size * (1.4 - a * 0.6) : pt.size * a + 0.5;
      lctx.globalAlpha = pt.smoke ? a * 0.55 : a;
      lrect(Math.round((pt.x - sz / 2) / PIX), Math.round((pt.y - sz / 2) / PIX),
            Math.max(1, Math.round(sz / PIX)), Math.max(1, Math.round(sz / PIX)), pt.color);
    }
    lctx.globalAlpha = 1;

    // Speed streaks at high speed.
    if (speed > 620 && state === "playing") {
      lctx.globalAlpha = 0.3;
      for (var sI = 0; sI < 6; sI++) {
        var side = Math.random() < 0.5 ? -1 : 1;
        var lx = Math.round((CX + side * (170 + Math.random() * 40)) / PIX);
        var ly = Math.round((HZ + 40 + Math.random() * (D.H - HZ - 80)) / PIX);
        lrect(lx, ly, 1, 6 + Math.floor(Math.random() * 10), "#ffffff");
      }
      lctx.globalAlpha = 1;
    }

    drawHUD();

    // Blit chunky (with crash shake), then crisp floating text on top.
    ctx.imageSmoothingEnabled = false;
    var ox = 0, oy = 0;
    if (shake > 0) { ox = (Math.random() - 0.5) * shake; oy = (Math.random() - 0.5) * shake; }
    ctx.drawImage(low, ox, oy, D.W, D.H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (var f = 0; f < floaters.length; f++) {
      var fl = floaters[f];
      ctx.globalAlpha = 1 - fl.life / fl.max;
      ctx.font = "bold 22px system-ui, Tahoma";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(10,20,50,0.85)";
      ctx.strokeText(fl.text, fl.x + ox, fl.y + oy);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x + ox, fl.y + oy);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- UI CARDS ----------
  function showCard(title, html, buttons) {
    messageTitle.textContent = title;
    messageText.innerHTML = html;
    cardButtons.innerHTML = "";
    buttons.forEach(function (b) {
      var btn = document.createElement("button");
      btn.textContent = b.text;
      if (b.secondary) btn.className = "secondary";
      btn.addEventListener("click", function () {
        Sound.ensure();
        Sound.click();
        b.onClick();
      });
      cardButtons.appendChild(btn);
    });
    message.classList.remove("hidden");
  }
  function hideCard() { message.classList.add("hidden"); }

  function startRace() {
    Sound.ensure();
    Sound.start();
    reset();
    state = "playing";
    hideCard();
    if (pauseButton) pauseButton.classList.remove("hidden");
    Sound.engineStart();
  }

  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    Sound.engineStop();
    showCard("⏸ مکث", "امتیاز فعلی: <b>" + fa(Math.floor(score)) + "</b>", [
      { text: "▶ ادامه", onClick: resumeGame },
      { text: Sound.muted ? "🔇 بی‌صدا" : "🔊 با صدا", secondary: true, onClick: function () {
          Sound.setMuted(!Sound.muted);
          pauseGameRefresh();
        } },
      { text: "🔄 شروع مجدد", secondary: true, onClick: startRace },
      { text: "🏁 پایان بازی", secondary: true, onClick: quitToGameOver }
    ]);
  }

  function pauseGameRefresh() {
    // Re-render the pause card so the mute label updates.
    if (state === "paused") {
      state = "playing"; // let pauseGame() pass its guard
      pauseGame();
    }
  }

  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    hideCard();
    Sound.engineStart();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---------- SCORE SUBMIT (same protocol as the other games) ----------
  async function reportScore(value) {
    var status = "n/a", rec = false;
    try {
      if (window.TelegramGameProxy && window.TelegramGameProxy.setScore) {
        window.TelegramGameProxy.setScore(value);
        status = "proxy-ok";
      }
    } catch (e) { /* legacy proxy is best-effort */ }

    try {
      if (value <= 0) { status = "no-submit-zero"; return { status: status, isRecord: false }; }
      var params = new URLSearchParams(window.location.search);
      var uid = params.get("uid");
      var cid = params.get("cid");
      var mid = params.get("mid");
      var imid = params.get("imid");
      var game = params.get("game");

      if (!uid && window.Telegram && window.Telegram.WebApp &&
          window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
        uid = String(window.Telegram.WebApp.initDataUnsafe.user.id);
      }

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
        status = data.ok
          ? (rec ? "server-ok-record" : "server-ok")
          : ("server-fail:" + (data.error || res.status));
      } else {
        status = "missing-params uid=" + (uid || "null") + " imid=" + (imid || "null");
      }
    } catch (e) {
      status = "error:" + (e.message || "unknown");
    }
    return { status: status, isRecord: rec };
  }

  async function finishRace(value) {
    isRecord = false;
    var status = "n/a";
    try {
      var r = await reportScore(value);
      status = r.status;
      isRecord = r.isRecord;
    } catch (e) { status = "error:" + (e.message || "unknown"); }

    if (value > best) { best = value; store("driveBest", String(best)); }
    var shownBest = Number.isFinite(serverBest) ? serverBest : best;
    var recordLine = isRecord ? "🎉 <b>رکورد جدید!</b><br>" : "";
    var small = '<br><small style="opacity:.65">' + escapeHtml(status) + "</small>";
    showCard(
      "🏁 پایان مسابقه",
      "امتیاز: <b>" + fa(value) + "</b><br>" +
      "رکورد: <b>" + fa(shownBest) + "</b><br>" +
      "لول: <b>" + fa(level) + "</b> — سکه: <b>" + fa(coinCount) + "</b> — سبقت: <b>" + fa(overtakeCount) + "</b><br>" +
      recordLine + small,
      [{ text: "🔄 دوباره بازی", onClick: startRace }]
    );
  }

  // ---------- BUTTONS ----------
  // Steering buttons: tap to change one lane, hold to keep moving.
  function bindHoldButton(btn, dir) {
    if (!btn) return;
    var timer = null;
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    btn.addEventListener("pointerdown", function (e) {
      if (e) e.preventDefault();
      Sound.ensure();
      stop();
      if (state === "playing") changeLane(dir);
      timer = setInterval(function () {
        if (state === "playing") changeLane(dir);
      }, 230);
    });
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("pointercancel", stop);
  }
  bindHoldButton(leftBtn, -1);
  bindHoldButton(rightBtn, 1);

  if (pauseButton) pauseButton.addEventListener("click", function () {
    Sound.ensure();
    if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
  });
  if (muteButton) {
    muteButton.textContent = Sound.muted ? "🔇" : "🔊";
    muteButton.addEventListener("click", function () {
      Sound.ensure();
      Sound.setMuted(!Sound.muted);
    });
  }

  // ---------- MAIN LOOP ----------
  var last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (!last) last = t;
    var dt = (t - last) / 1000;
    last = t;
    if (dt > 0.05) dt = 0.05;
    animT += dt;
    if (state === "playing") update(dt);
    else if (state === "over") updateFx(dt);
    render();
  }

  // ---------- INIT ----------
  populateDecor();
  updateHUD();
  if (muteButton) muteButton.textContent = Sound.muted ? "🔇" : "🔊";
  showCard(
    "🏎️ ماشین‌سواری",
    "با ماشینت از ترافیک فرار کن، سکه جمع کن و سبقت بگیر!<br>" +
    "با دکمه‌های <b>◀ ▶</b> لاین عوض کن<br>" +
    "هر <b>" + fa(500) + "</b> امتیاز = یک لول بالاتر = سرعت و ترافیک بیشتر 🔥<br>" +
    (best > 0 ? "رکورد تو: <b>" + fa(best) + "</b>" : "رکوردی ثبت نشده — بزن بریم!"),
    [{ text: "🏁 شروع", onClick: startRace }]
  );
  requestAnimationFrame(frame);
}
