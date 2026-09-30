"use strict";
/* Drive — 2D top-down 3-lane racer for the Gameifyr Telegram bot.
   Vanilla JS + Canvas, no build step.
   Controls: phone tilt (gyroscope), touch drag, or arrow keys.
   Difficulty formula: level = 1 + floor(score/500); speed, spawn rate and
   double-spawn chance all scale with level.
   Telegram context arrives via URL params (added by the worker):
   uid, cid, mid, imid, game. */

// ================= PURE LOGIC (no DOM — unit testable) =================
var Drive = (function () {
  var W = 420, H = 720;
  var ROAD_X = 60, ROAD_W = 300, LANES = 3;
  var LANE_W = ROAD_W / LANES; // 100
  var PLAYER_Y = H - 150;
  var CAR_W = 56, CAR_H = 96;

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

  return {
    W: W, H: H,
    ROAD_X: ROAD_X, ROAD_W: ROAD_W, LANES: LANES, LANE_W: LANE_W,
    PLAYER_Y: PLAYER_Y, CAR_W: CAR_W, CAR_H: CAR_H,
    laneCenter: laneCenter,
    clamp: clamp,
    levelForScore: levelForScore,
    speedForLevel: speedForLevel,
    spawnIntervalForLevel: spawnIntervalForLevel,
    doubleSpawnChance: doubleSpawnChance,
    rectsOverlap: rectsOverlap,
    carRect: carRect,
    hitRect: hitRect,
    pickSpawnLanes: pickSpawnLanes
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
  var scoreEl = document.getElementById("score");
  var levelEl = document.getElementById("level");
  var speedEl = document.getElementById("speed");
  var pauseButton = document.getElementById("pauseButton");
  var muteButton = document.getElementById("muteButton");
  var message = document.getElementById("message");
  var messageTitle = document.getElementById("messageTitle");
  var messageText = document.getElementById("messageText");
  var cardButtons = document.getElementById("cardButtons");

  function fa(n) {
    return String(n).replace(/[0-9]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹"[+d]; });
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = D.clamp((n >> 16) + amt, 0, 255);
    var g = D.clamp(((n >> 8) & 255) + amt, 0, 255);
    var b = D.clamp((n & 255) + amt, 0, 255);
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
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
  var enemies = [];   // {lane,x,y,color,rel,passed,counted}
  var coinsArr = [];  // {lane,x,y,phase}
  var parts = [];     // particles {x,y,vx,vy,life,max,size,color,grav}
  var floaters = [];  // {x,y,text,life,color}
  var decor = [];     // roadside {x,y,kind,phase}
  var decorTimer = 0;
  var shake = 0;      // crash screen shake

  var ENEMY_COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399", "#fb7185", "#facc15"];
  var PLAYER_COLOR = "#e11d48";

  function reset() {
    score = 0; level = 1; coinCount = 0; overtakeCount = 0;
    isRecord = false; serverBest = NaN;
    speed = 0; roadOffset = 0; spawnTimer = 0.8;
    player.lane = 1; player.x = D.laneCenter(1); player.tilt = 0;
    enemies = []; coinsArr = []; parts = []; floaters = []; decor = [];
    decorTimer = 0; shake = 0;
    gyro.base = null; gyro.armed = true;
    updateHUD();
  }

  function updateHUD() {
    if (scoreEl) scoreEl.textContent = fa(Math.floor(score));
    if (levelEl) levelEl.textContent = fa(level);
    if (speedEl) speedEl.textContent = fa(Math.round(speed * 0.35));
  }

  // ---------- INPUT ----------
  var gyro = { active: false, base: null, armed: true };

  window.addEventListener("deviceorientation", function (e) {
    if (e.gamma == null) return;
    gyro.active = true;
    if (gyro.base == null) { gyro.base = e.gamma; return; }
    if (state !== "playing") return;
    var d = e.gamma - gyro.base;
    if (gyro.armed && d > 14) { changeLane(1); gyro.armed = false; }
    else if (gyro.armed && d < -14) { changeLane(-1); gyro.armed = false; }
    else if (!gyro.armed && Math.abs(d) < 7) { gyro.armed = true; }
  });

  function requestGyroPermission() {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().catch(function () {});
      }
    } catch (_) {}
  }

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

  function spawnDecor() {
    var side = Math.random() < 0.5 ? 0 : 1;
    var x = side === 0
      ? 8 + Math.random() * (D.ROAD_X - 24)
      : D.ROAD_X + D.ROAD_W + 8 + Math.random() * (D.W - D.ROAD_X - D.ROAD_W - 24);
    decor.push({ x: x, y: -40, kind: Math.floor(Math.random() * 3), phase: Math.random() * 6.28 });
  }

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
    roadOffset = (roadOffset + speed * dt) % 56;

    // Player lateral motion (smooth, with tilt for juice).
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
          floater(player.x, D.PLAYER_Y - 80, "+۱۰ سبقت!", "#7dd3fc");
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
        burst(c.x, c.y, 10, ["#fde047", "#fbbf24", "#fff7cc"], 160);
        floater(c.x, c.y - 20, "+۲۵", "#fde047");
      }
    }

    // Decor + particles + floaters.
    for (var k = decor.length - 1; k >= 0; k--) {
      decor[k].y += speed * dt;
      if (decor[k].y > D.H + 40) decor.splice(k, 1);
    }
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

    // Exhaust puffs while driving.
    if (Math.random() < dt * 14) {
      parts.push({
        x: player.x + (Math.random() - 0.5) * 14,
        y: D.PLAYER_Y + D.CAR_H / 2,
        vx: (Math.random() - 0.5) * 30, vy: 120 + Math.random() * 60,
        life: 0, max: 0.4 + Math.random() * 0.3,
        size: 3 + Math.random() * 3, color: "rgba(148,163,184,0.5)", grav: -60
      });
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    Sound.engineSet(speed / 950);
    updateHUD();
  }

  function crash() {
    state = "over";
    shake = 14;
    Sound.crash();
    Sound.engineStop();
    burst(player.x, D.PLAYER_Y, 46, ["#f97316", "#ef4444", "#fbbf24", "#78716c"], 340);
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

  // ---------- RENDER ----------
  function drawCar(x, y, color, isPlayer, tilt) {
    var w = D.CAR_W, h = D.CAR_H;
    ctx.save();
    ctx.translate(x, y);
    if (tilt) ctx.rotate(tilt);

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRectPath(-w / 2 + 4, -h / 2 + 7, w, h, 13);
    ctx.fill();

    // Headlight beams (player only, shining up the road).
    if (isPlayer) {
      var beam = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 - 190);
      beam.addColorStop(0, "rgba(253,224,71,0.30)");
      beam.addColorStop(1, "rgba(253,224,71,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 6, -h / 2);
      ctx.lineTo(w / 2 - 6, -h / 2);
      ctx.lineTo(w / 2 + 26, -h / 2 - 190);
      ctx.lineTo(-w / 2 - 26, -h / 2 - 190);
      ctx.closePath();
      ctx.fill();
    }

    // Body.
    var g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, shade(color, -46));
    g.addColorStop(0.5, color);
    g.addColorStop(1, shade(color, -46));
    ctx.fillStyle = g;
    roundRectPath(-w / 2, -h / 2, w, h, 13);
    ctx.fill();

    // Hood + trunk shading.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRectPath(-w / 2 + 5, -h / 2 + 5, w - 10, 20, 8);
    ctx.fill();
    roundRectPath(-w / 2 + 5, h / 2 - 25, w - 10, 20, 8);
    ctx.fill();

    // Windshield + roof + rear window.
    ctx.fillStyle = "#0f172a";
