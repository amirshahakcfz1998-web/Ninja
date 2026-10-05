"use strict";
/* Bricks Breaker — Telegram game (short name: bricks_breeker).
   Drag left/right to aim, release to shoot. Numbered bricks descend one
   row after every volley; don't let them cross the red deadline.
   Pure logic lives in Bricks (testable in node); browser code in browserBoot(). */

// Error trap: surface script errors on the start card (debug aid).
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  function show(msg) {
    try {
      var t = document.getElementById("messageTitle");
      var x = document.getElementById("cardText");
      var card = document.getElementById("card");
      if (t) t.textContent = "خطا";
      if (x) x.innerHTML = '<span style="color:#f87171">خطا: ' + String(msg).slice(0, 300) + "</span>";
      if (card) card.classList.add("show");
    } catch (_) {}
  }
  window.addEventListener("error", function (e) { show(e.message || e.error); });
})();

var Bricks = (function () {
  "use strict";

  var W = 420, H = 700;
  var COLS = 6, SIDE = 14, GAP = 6;
  var BRICK_W = (W - SIDE * 2 - GAP * (COLS - 1)) / COLS;
  var BRICK_H = 46;
  var GRID_TOP = 96;
  var DEADLINE_Y = 556;
  var LAUNCH_Y = 632;
  var BALL_R = 7;
  var BALL_SPEED = 620;
  var SCORE_PER_BRICK = 5;
  var AIM_STEPS = 170, AIM_STEP = 7; // long trajectory preview

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Brick HP scales with the round number (difficulty on the same screen).
  function hpForRound(round, rand) {
    var base = 1 + Math.floor(round * 0.85);
    return base + Math.floor(rand() * (1 + round * 0.75));
  }

  function brickColor(hp) {
    if (hp <= 2) return "#34d399";
    if (hp <= 6) return "#60a5fa";
    if (hp <= 12) return "#fbbf24";
    if (hp <= 25) return "#fb7185";
    if (hp <= 50) return "#c084fc";
    return "#f0abfc";
  }

  function cellRect(row, col) {
    return {
      x: SIDE + col * (BRICK_W + GAP),
      y: GRID_TOP + row * (BRICK_H + GAP),
      w: BRICK_W, h: BRICK_H
    };
  }

  function circleHitsRect(cx, cy, r, rc) {
    var nx = clamp(cx, rc.x, rc.x + rc.w);
    var ny = clamp(cy, rc.y, rc.y + rc.h);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  // Which axis should a moving circle bounce off a rect? Uses prev position.
  function bounceAxis(px, py, cx, cy, r, rc) {
    if (py + r <= rc.y) return "y";         // was above
    if (py - r >= rc.y + rc.h) return "y";  // was below
    if (px + r <= rc.x) return "x";         // was left
    if (px - r >= rc.x + rc.w) return "x";  // was right
    var penL = (cx + r) - rc.x, penR = (rc.x + rc.w) - (cx - r);
    var penT = (cy + r) - rc.y, penB = (rc.y + rc.h) - (cy - r);
    var m = Math.min(penL, penR, penT, penB);
    return (m === penL || m === penR) ? "x" : "y";
  }

  function newRow(round, rand) {
    var row = [], bricks = 0;
    var density = Math.min(0.75, 0.40 + round * 0.022);
    for (var c = 0; c < COLS; c++) {
      var roll = rand();
      if (roll < density) {
        var hp = hpForRound(round, rand);
        row.push({ hp: hp, max: hp, orb: false, flash: 0 });
        bricks++;
      } else if (roll < density + 0.08) {
        row.push({ hp: 0, max: 0, orb: true, flash: 0 });
      } else {
        row.push(null);
      }
    }
    if (!bricks) {
      var c2 = Math.floor(rand() * COLS);
      var hp2 = hpForRound(round, rand);
      row[c2] = { hp: hp2, max: hp2, orb: false, flash: 0 };
    }
    return row;
  }

  // Trajectory preview. rects = [{x,y,w,h}]. Returns sampled points.
  function aimPath(sx, sy, dx, dy, rects) {
    var pts = [], x = sx, y = sy, vx = dx, vy = dy;
    for (var i = 0; i < AIM_STEPS; i++) {
      x += vx * AIM_STEP; y += vy * AIM_STEP;
      if (x < BALL_R) { x = BALL_R; vx = Math.abs(vx); }
      else if (x > W - BALL_R) { x = W - BALL_R; vx = -Math.abs(vx); }
      if (y < BALL_R) { y = BALL_R; vy = Math.abs(vy); }
      var hit = false;
      for (var k = 0; k < rects.length; k++) {
        if (circleHitsRect(x, y, BALL_R, rects[k])) { hit = true; break; }
      }
      if (i % 3 === 0) pts.push({ x: x, y: y });
      if (hit || y > LAUNCH_Y) break;
    }
    return pts;
  }

  function rowsBottomY(rowCount) {
    return GRID_TOP + rowCount * (BRICK_H + GAP) - GAP;
  }

  return {
    W: W, H: H, COLS: COLS, SIDE: SIDE, GAP: GAP,
    BRICK_W: BRICK_W, BRICK_H: BRICK_H, GRID_TOP: GRID_TOP,
    DEADLINE_Y: DEADLINE_Y, LAUNCH_Y: LAUNCH_Y, BALL_R: BALL_R,
    BALL_SPEED: BALL_SPEED, SCORE_PER_BRICK: SCORE_PER_BRICK,
    clamp: clamp, hpForRound: hpForRound, brickColor: brickColor,
    cellRect: cellRect, circleHitsRect: circleHitsRect,
    bounceAxis: bounceAxis, newRow: newRow, aimPath: aimPath,
    rowsBottomY: rowsBottomY
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Bricks;

/* ================= BROWSER ================= */
(function browserBoot() {
  if (typeof document === "undefined") return;
  var D = Bricks;

  // ---------- DOM ----------
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var roundEl = document.getElementById("round");
  var ballsEl = document.getElementById("balls");
  var muteBtn = document.getElementById("muteBtn");
  var pauseBtn = document.getElementById("pauseBtn");
  var card = document.getElementById("card");
  var cardTitle = document.getElementById("cardTitle");
  var cardText = document.getElementById("cardText");
  var cardButtons = document.getElementById("cardButtons");

  // ---------- HELPERS ----------
  var FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
  function fa(n) {
    return String(n).replace(/[0-9]/g, function (d) { return FA_DIGITS[+d]; });
  }
  function read(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? def : v;
    } catch (_) { return def; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- SOUND (Web Audio, no files) ----------
  var Sound = (function () {
    var ac = null, muted = read("bricksMuted", "0") === "1", lastTick = 0;
    function ensure() {
      if (ac) { if (ac.state === "suspended") ac.resume(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ac = new AC();
      } catch (_) { ac = null; }
    }
    function tone(f0, f1, dur, type, vol) {
      if (muted) return;
      ensure();
      if (!ac) return;
      try {
        var t = ac.currentTime;
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = type || "sine";
        o.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
        g.gain.setValueAtTime(vol || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (_) {}
    }
    return {
      ensure: ensure,
      shoot: function () { tone(480, 920, 0.07, "square", 0.06); },
      bounce: function () {
        var n = Date.now();
        if (n - lastTick < 45) return;
        lastTick = n;
        tone(240, 240, 0.03, "sine", 0.05);
      },
      hit: function () { tone(330, 300, 0.05, "triangle", 0.08); },
      destroy: function () { tone(523, 523, 0.07, "square", 0.07); setTimeout(function(){ tone(784, 784, 0.09, "square", 0.07); }, 60); },
      orb: function () { tone(880, 1320, 0.12, "sine", 0.1); },
      land: function () { tone(300, 200, 0.05, "sine", 0.05); },
      over: function () { tone(320, 110, 0.5, "sawtooth", 0.1); },
      click: function () { tone(600, 600, 0.05, "sine", 0.08); },
      toggleMute: function () {
        muted = !muted;
        store("bricksMuted", muted ? "1" : "0");
        return muted;
      },
      isMuted: function () { return muted; }
    };
  })();

  function refreshMuteIcon() {
    if (muteBtn) muteBtn.textContent = Sound.isMuted() ? "🔇" : "🔊";
  }

  // ---------- CARD ----------
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
  var phase = "menu";       // menu | aim | firing | flying | over
  var paused = false;
  var grid = [];            // rows of cells; rows[0] is the top row
  var balls = [];
  var particles = [];
  var floaters = [];
  var score = 0, round = 1, ballCount = 3;
  var best = parseInt(read("bricksBest", "0"), 10) || 0;
  var serverBest = NaN, isRecord = false;
  var launchX = D.W / 2;
  var aimAngle = 0;         // 0 = straight up, + = right (radians)
  var aiming = false, anchorX = 0, startAngle = 0;
  var fireLeft = 0, fireTimer = 0, fireDir = { x: 0, y: -1 };
  var landed = false;

  function updateHUD() {
    scoreEl.textContent = fa(score);
    roundEl.textContent = fa(round);
    ballsEl.textContent = fa(ballCount);
  }

  function gridRects() {
    var out = [];
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < D.COLS; c++) {
        var cell = grid[r][c];
        if (cell && !cell.orb) out.push(D.cellRect(r, c));
      }
    }
    return out;
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < (n || 10); i++) {
      var a = Math.random() * 6.283, sp = 60 + Math.random() * 220;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.5 + Math.random() * 0.4, age: 0,
        color: color, size: 2 + Math.random() * 3
      });
    }
  }

  // ---------- GAME FLOW ----------
  function startGame() {
    Sound.ensure();
    grid = [];
    grid.unshift(D.newRow(1, Math.random));
    grid.unshift(D.newRow(1, Math.random));
    balls = []; particles = []; floaters = [];
    score = 0; round = 1; ballCount = 3;
    launchX = D.W / 2; aimAngle = 0;
    aiming = false; paused = false;
    isRecord = false;
    hideCard();
    phase = "aim";
    updateHUD();
  }

  function endRound() {
    round++;
    grid.unshift(D.newRow(round, Math.random));
    while (grid.length && grid[grid.length - 1].every(function (c) { return !c; })) grid.pop();
    // Game over if any brick (not orb) crossed the deadline.
    var maxBrickRow = -1;
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < D.COLS; c++) {
        var cell = grid[r][c];
        if (cell && !cell.orb) maxBrickRow = r;
      }
    }
    if (maxBrickRow >= 0 && D.rowsBottomY(maxBrickRow + 1) > D.DEADLINE_Y) {
      gameOver();
      return;
    }
    phase = "aim";
    updateHUD();
  }

  // ---------- SCORE SUBMIT (same protocol as tetris/drive) ----------
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

  async function gameOver() {
    phase = "over";
    Sound.over();
    var status = "n/a";
    isRecord = false;
    if (score > 0) {
      try {
        var r = await reportScore(score);
        status = r.status; isRecord = r.isRecord;
      } catch (e) { status = "error:" + (e.message || "unknown"); }
    } else {
      status = "skipped (zero)";
    }
    if (score > best) { best = score; store("bricksBest", String(best)); }
    var shownBest = Number.isFinite(serverBest) ? serverBest : best;
    var recordLine = isRecord ? "🎉 <b>رکورد جدید!</b><br>" : "";
    showCard(
      "💥 بازی تمام شد",
      "امتیاز: <b>" + fa(score) + "</b><br>" +
      "رکورد: <b>" + fa(shownBest) + "</b><br>" +
      "رسیدی به راند: <b>" + fa(round) + "</b><br>" +
      recordLine +
      '<br><small style="opacity:.65">' + escapeHtml(status) + "</small>",
      [{ text: "🔄 دوباره بازی", onClick: startGame }]
    );
    updateHUD();
  }

  // ---------- INPUT (drag horizontally to aim, release to shoot) ----------
  function canvasX(e) {
    var r = canvas.getBoundingClientRect();
    return (e.clientX - r.left) * (D.W / r.width);
  }

  canvas.addEventListener("pointerdown", function (e) {
    Sound.ensure();
    if (phase !== "aim" || paused) return;
    aiming = true;
    anchorX = canvasX(e);
    startAngle = aimAngle;
    e.preventDefault();
  });
  window.addEventListener("pointermove", function (e) {
    if (!aiming || phase !== "aim" || paused) return;
    aimAngle = D.clamp(startAngle + (canvasX(e) - anchorX) * 0.0075, -1.35, 1.35);
  });
  function stopAim(fire) {
    if (!aiming) return;
    aiming = false;
    if (fire && phase === "aim" && !paused) {
      fireDir = { x: Math.sin(aimAngle), y: -Math.cos(aimAngle) };
      phase = "firing";
      fireLeft = ballCount;
      fireTimer = 0;
      landed = false;
    }
  }
  window.addEventListener("pointerup", function () { stopAim(true); });
  window.addEventListener("pointercancel", function () { stopAim(false); });

  window.addEventListener("keydown", function (e) {
    if (phase === "aim" && !paused) {
      if (e.key === "ArrowLeft") aimAngle = D.clamp(aimAngle - 0.09, -1.35, 1.35);
      else if (e.key === "ArrowRight") aimAngle = D.clamp(aimAngle + 0.09, -1.35, 1.35);
      else if (e.key === " " || e.key === "Enter") {
        Sound.ensure();
        fireDir = { x: Math.sin(aimAngle), y: -Math.cos(aimAngle) };
        phase = "firing"; fireLeft = ballCount; fireTimer = 0; landed = false;
        e.preventDefault();
      }
    }
  });

  // ---------- UPDATE ----------
  function spawnBall() {
    balls.push({
      x: launchX, y: D.LAUNCH_Y,
      vx: fireDir.x * D.BALL_SPEED, vy: fireDir.y * D.BALL_SPEED,
      age: 0
    });
    Sound.shoot();
  }

  function landBall(i) {
    var b = balls[i];
    if (!landed) {
      landed = true;
      launchX = D.clamp(b.x, D.SIDE + 12, D.W - D.SIDE - 12);
      burst(b.x, D.LAUNCH_Y, "#22d3ee", 6);
    }
    Sound.land();
    balls.splice(i, 1);
  }

  function hitBrick(r, c, b, px, py, rc) {
    var axis = D.bounceAxis(px, py, b.x, b.y, D.BALL_R, rc);
    if (axis === "x") { b.vx = -b.vx; b.x = px; }
    else { b.vy = -b.vy; b.y = py; }
    var cell = grid[r][c];
    cell.hp--;
    cell.flash = 1;
    if (cell.hp <= 0) {
      grid[r][c] = null;
      score += D.SCORE_PER_BRICK;
      burst(rc.x + rc.w / 2, rc.y + rc.h / 2, D.brickColor(cell.max), 12);
      floaters.push({ x: rc.x + rc.w / 2, y: rc.y, text: "+" + D.SCORE_PER_BRICK, life: 0.8, age: 0, color: "#fde047" });
      Sound.destroy();
      updateHUD();
    } else {
      Sound.hit();
    }
  }

  function update(dt) {
    // Firing volley one ball at a time (tight burst).
    if (phase === "firing") {
      fireTimer -= dt;
      while (fireTimer <= 0 && fireLeft > 0) {
        spawnBall();
        fireLeft--;
        fireTimer += 0.04;
      }
      if (fireLeft <= 0) phase = "flying";
    }

    // Flying balls.
    if (phase === "flying") {
      for (var i = balls.length - 1; i >= 0; i--) {
        var b = balls[i];
        b.age += dt;
        if (b.age > 30) { landBall(i); continue; } // safety: never stuck forever
        var dist = D.BALL_SPEED * dt;
        var steps = Math.max(1, Math.ceil(dist / 5));
        var sdt = dt / steps;
        var dead = false;
        for (var s = 0; s < steps && !dead; s++) {
          var px = b.x, py = b.y;
          b.x += b.vx * sdt;
          b.y += b.vy * sdt;
          if (b.x < D.BALL_R) { b.x = D.BALL_R; b.vx = Math.abs(b.vx); Sound.bounce(); }
          else if (b.x > D.W - D.BALL_R) { b.x = D.W - D.BALL_R; b.vx = -Math.abs(b.vx); Sound.bounce(); }
          if (b.y < D.BALL_R) { b.y = D.BALL_R; b.vy = Math.abs(b.vy); Sound.bounce(); }

          for (var r = 0; r < grid.length && !dead; r++) {
            for (var c = 0; c < D.COLS; c++) {
              var cell = grid[r][c];
              if (!cell) continue;
              var rc = D.cellRect(r, c);
              if (!D.circleHitsRect(b.x, b.y, D.BALL_R, rc)) continue;
              if (cell.orb) {
                grid[r][c] = null;
                ballCount++;
                floaters.push({ x: rc.x + rc.w / 2, y: rc.y, text: "+۱ توپ", life: 0.9, age: 0, color: "#4ade80" });
                burst(rc.x + rc.w / 2, rc.y + rc.h / 2, "#4ade80", 8);
                Sound.orb();
                updateHUD();
              } else {
                hitBrick(r, c, b, px, py, rc);
              }
            }
          }

          if (b.y - D.BALL_R > D.LAUNCH_Y + 20) { landBall(i); dead = true; }
        }
        // Anti-stall: never allow a (near-)horizontal endless bounce.
        if (!dead && Math.abs(b.vy) < 70) {
          b.vy = (b.vy >= 0 ? 1 : -1) * 70;
          var sp = Math.hypot(b.vx, b.vy);
          b.vx = b.vx / sp * D.BALL_SPEED;
          b.vy = b.vy / sp * D.BALL_SPEED;
        }
      }
      if (balls.length === 0) endRound();
    }

    // Particles / floaters / flash decay.
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.age += dt;
      if (pt.age >= pt.life) { particles.splice(p, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += 500 * dt;
    }
    for (var f = floaters.length - 1; f >= 0; f--) {
      var fl = floaters[f];
      fl.age += dt;
      if (fl.age >= fl.life) floaters.splice(f, 1);
    }
    for (var rr = 0; rr < grid.length; rr++) {
      for (var cc = 0; cc < D.COLS; cc++) {
        var cl = grid[rr][cc];
        if (cl && cl.flash > 0) cl.flash = Math.max(0, cl.flash - dt * 5);
      }
    }
  }

  // ---------- RENDER ----------
  function rr(x, y, w, h, rad) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad);
    else ctx.rect(x, y, w, h);
  }

  function render() {
    // Dark background.
    var bg = ctx.createLinearGradient(0, 0, 0, D.H);
    bg.addColorStop(0, "#070a16");
    bg.addColorStop(0.6, "#0b1024");
    bg.addColorStop(1, "#0e1430");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, D.W, D.H);

    // Deadline (red dashed line).
    ctx.save();
    ctx.strokeStyle = "rgba(248,113,113,0.75)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(6, D.DEADLINE_Y);
    ctx.lineTo(D.W - 6, D.DEADLINE_Y);
    ctx.stroke();
    ctx.restore();

    // Bricks & orbs.
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < D.COLS; c++) {
        var cell = grid[r][c];
        if (!cell) continue;
        var rc = D.cellRect(r, c);
        if (cell.orb) {
          var pulse = 1 + 0.12 * Math.sin(Date.now() / 240 + r + c);
          ctx.fillStyle = "#16a34a";
          ctx.beginPath();
          ctx.arc(rc.x + rc.w / 2, rc.y + rc.h / 2, 13 * pulse, 0, 6.283);
          ctx.fill();
          ctx.fillStyle = "#4ade80";
          ctx.beginPath();
          ctx.arc(rc.x + rc.w / 2, rc.y + rc.h / 2, 10 * pulse, 0, 6.283);
          ctx.fill();
          ctx.fillStyle = "#052e16";
          ctx.font = "bold 13px system-ui, Tahoma";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("+1", rc.x + rc.w / 2, rc.y + rc.h / 2 + 1);
          continue;
        }
        var col = D.brickColor(cell.hp);
        ctx.fillStyle = col;
        rr(rc.x, rc.y, rc.w, rc.h, 8);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        rr(rc.x + 3, rc.y + 3, rc.w - 6, 7, 4);
        ctx.fill();
        if (cell.flash > 0) {
          ctx.fillStyle = "rgba(255,255,255," + (cell.flash * 0.65).toFixed(2) + ")";
          rr(rc.x, rc.y, rc.w, rc.h, 8);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.font = "bold 19px system-ui, Tahoma";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(fa(cell.hp), rc.x + rc.w / 2, rc.y + rc.h / 2 + 1);
      }
    }

    // Launch pad.
    ctx.save();
    ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(launchX, D.LAUNCH_Y, 9, 0, 6.283);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#a5f3fc";
    ctx.font = "bold 14px system-ui, Tahoma";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("×" + fa(ballCount), launchX, D.LAUNCH_Y + 24);

    // Queued balls waiting to launch (visible during the firing burst).
    if (phase === "firing" && fireLeft > 0) {
      for (var q = 0; q < fireLeft; q++) {
        ctx.fillStyle = "rgba(248,250,252,0.9)";
        ctx.beginPath();
        ctx.arc(launchX - 24 - q * 15, D.LAUNCH_Y + 2, 5, 0, 6.283);
        ctx.fill();
      }
    }

    // Aim trajectory: long and bold.
    if ((phase === "aim" || aiming) && !paused) {
      var dx = Math.sin(aimAngle), dy = -Math.cos(aimAngle);
      var pts = D.aimPath(launchX, D.LAUNCH_Y - 12, dx, dy, gridRects());
      ctx.save();
      ctx.fillStyle = "rgba(241,245,249,0.92)";
      ctx.shadowColor = "#e2e8f0"; ctx.shadowBlur = 6;
      for (var i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 4.5, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
      // Direction arrow at launch.
      ctx.save();
      ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(launchX, D.LAUNCH_Y - 14);
      ctx.lineTo(launchX + dx * 34, D.LAUNCH_Y - 14 + dy * 34);
      ctx.stroke();
      ctx.restore();
    }

    // Balls with short trails.
    for (var bi = 0; bi < balls.length; bi++) {
      var b = balls[bi];
      ctx.strokeStyle = "rgba(165,243,252,0.5)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.035, b.y - b.vy * 0.035);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 10;
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(b.x, b.y, D.BALL_R, 0, 6.283);
      ctx.fill();
      ctx.restore();
    }

    // Particles.
    for (var pi = 0; pi < particles.length; pi++) {
      var pt = particles[pi];
      ctx.globalAlpha = 1 - pt.age / pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // Floaters.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var fi = 0; fi < floaters.length; fi++) {
      var fl = floaters[fi];
      ctx.globalAlpha = 1 - fl.age / fl.life;
      ctx.fillStyle = fl.color;
      ctx.font = "bold 16px system-ui, Tahoma";
      ctx.fillText(fl.text, fl.x, fl.y - fl.age * 46);
    }
    ctx.globalAlpha = 1;

    // Vignette.
    var vg = ctx.createRadialGradient(D.W / 2, D.H / 2, D.H / 4, D.W / 2, D.H / 2, D.H / 1.2);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, D.W, D.H);
  }

  // ---------- BUTTONS ----------
  if (muteBtn) muteBtn.addEventListener("click", function () {
    Sound.ensure();
    Sound.toggleMute();
    refreshMuteIcon();
  });
  if (pauseBtn) pauseBtn.addEventListener("click", function () {
    Sound.ensure(); Sound.click();
    if (phase !== "aim" && phase !== "firing" && phase !== "flying") return;
    paused = !paused;
    if (paused) {
      aiming = false;
      showCard("⏸ توقف", "بازی متوقف شد.", [
        { text: "▶ ادامه", onClick: function () { paused = false; hideCard(); } },
        { text: "🔄 شروع دوباره", ghost: true, onClick: function () { paused = false; startGame(); } }
      ]);
    } else {
      hideCard();
    }
  });

  // ---------- MAIN LOOP ----------
  var last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (!last) last = t;
    var dt = (t - last) / 1000;
    last = t;
    if (dt > 0.05) dt = 0.05;
    if (!paused && (phase === "firing" || phase === "flying")) update(dt);
    else if (!paused && phase === "aim") update(dt); // particles decay
    render();
  }

  // ---------- INIT ----------
  refreshMuteIcon();
  updateHUD();
  showCard(
    "🧱 بریکس بریکر",
    "توپ‌ها را به آجرهای شماره‌دار بکوب!<br>" +
    "انگشتت را <b>چپ و راست بکش</b> تا نشانه بگیری، رها کن تا شلیک شود.<br>" +
    "بعد از هر شلیک آجرها یک ردیف پایین می‌آیند — نگذار از خط قرمز رد شوند!<br>" +
    "هر ۳ راند، آجرها جان و تعداد بیشتری می‌گیرند.",
    [{ text: "▶ شروع بازی", onClick: startGame }]
  );
  requestAnimationFrame(frame);
})();
