"use strict";
/* Tetris for the Gameifyr Telegram bot.
   Vanilla JS + Canvas, no build step.
   Telegram context arrives via URL params (added by the worker):
   uid, cid, mid, imid, game. */

// ---------- DOM ----------
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const levelEl = document.getElementById("level");
const messageEl = document.getElementById("message");
const messageTitleEl = document.getElementById("messageTitle");
const messageTextEl = document.getElementById("messageText");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const muteButton = document.getElementById("muteButton");
const pauseActions = document.getElementById("pauseActions");
const restartButton = document.getElementById("restartButton");
const quitButton = document.getElementById("quitButton");

// ---------- Config ----------
const COLS = 10;
const ROWS = 20;
const CELL = 26;
const BOARD_W = COLS * CELL;      // 260
const BOARD_H = ROWS * CELL;      // 520
const PANEL_W = 5 * CELL;         // 130
const LOCK_DELAY = 500;           // ms before a grounded piece locks
const MAX_LOCK_RESETS = 15;

canvas.width = BOARD_W + PANEL_W;
canvas.height = BOARD_H;

// ---------- Pieces ----------
const PIECES = {
  I: { color: "#22d3ee", dark: "#0e7490", matrix: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
  O: { color: "#facc15", dark: "#a16207", matrix: [[1,1],[1,1]] },
  T: { color: "#c084fc", dark: "#7e22ce", matrix: [[0,1,0],[1,1,1],[0,0,0]] },
  S: { color: "#4ade80", dark: "#15803d", matrix: [[0,1,1],[1,1,0],[0,0,0]] },
  Z: { color: "#f87171", dark: "#b91c1c", matrix: [[1,1,0],[0,1,1],[0,0,0]] },
  J: { color: "#60a5fa", dark: "#1d4ed8", matrix: [[1,0,0],[1,1,1],[0,0,0]] },
  L: { color: "#fb923c", dark: "#c2410c", matrix: [[0,0,1],[1,1,1],[0,0,0]] }
};
const TYPES = Object.keys(PIECES);
const LINE_SCORES = [0, 100, 300, 500, 800];
const KICKS = [[0,0],[-1,0],[1,0],[0,-1],[-2,0],[2,0],[-1,1],[1,1]];

// ---------- Sound (Web Audio, no external files) ----------
const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem("tetrisMuted") === "1"; } catch (e) {}

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (muted || !ensure()) return;
    type = type || "square";
    vol = vol == null ? 0.35 : vol;
    when = when || 0;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    unlock() { try { ensure(); } catch (e) {} },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem("tetrisMuted", muted ? "1" : "0"); } catch (e) {}
      return muted;
    },
    isMuted() { return muted; },
    move() { tone(210, 0.045, "square", 0.22); },
    rotate() { tone(330, 0.06, "square", 0.28); },
    lock() { tone(150, 0.07, "triangle", 0.45); },
    hardDrop() { tone(95, 0.16, "sawtooth", 0.5, 0, 45); },
    clear(n) {
      const steps = [523, 659, 784, 1047];
      const base = steps[Math.min(Math.max(n, 1), 4) - 1];
      tone(base, 0.09, "square", 0.32);
      tone(base * 1.25, 0.09, "square", 0.32, 0.09);
      tone(base * 1.5, 0.16, "square", 0.38, 0.18);
      if (n >= 4) tone(base * 2, 0.28, "square", 0.42, 0.34); // tetris fanfare
    },
    levelUp() {
      tone(440, 0.1, "square", 0.32);
      tone(554, 0.1, "square", 0.32, 0.1);
      tone(659, 0.2, "square", 0.38, 0.2);
    },
    gameOver() {
      tone(392, 0.16, "sawtooth", 0.4);
      tone(311, 0.16, "sawtooth", 0.4, 0.16);
      tone(233, 0.34, "sawtooth", 0.45, 0.32);
    },
    start() {
      tone(262, 0.08, "square", 0.3);
      tone(392, 0.08, "square", 0.3, 0.08);
      tone(523, 0.14, "square", 0.35, 0.16);
    },
    pause() { tone(330, 0.08, "square", 0.28); }
  };
})();

// ---------- State ----------
let board = [];
let bag = [];
let active = null;
let score = 0;
let lines = 0;
let level = 1;
let best = 0;
let serverBest = NaN;
let dropAcc = 0;
let lockAcc = 0;
let lockResets = 0;
let softDropHeld = false;
let running = false;
let paused = false;
let gameStarted = false;
let lastTime = 0;

try {
  best = Number(localStorage.getItem("tetrisBest") || 0) || 0;
} catch (e) { /* storage unavailable */ }

// ---------- Board helpers ----------
function newBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

function shuffledBag() {
  const b = TYPES.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function rotateMatrix(m, dir) {
  const t = m[0].map((_, i) => m.map(row => row[i]));
  return dir > 0 ? t.map(row => row.reverse()) : t.reverse();
}

function collides(matrix, px, py) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue;
      const bx = px + x;
      const by = py + y;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

function spawnPiece() {
  if (bag.length === 0) bag = shuffledBag();
  const type = bag.pop();
  const def = PIECES[type];
  active = {
    type,
    color: def.color,
    dark: def.dark,
    matrix: def.matrix.map(row => row.slice()),
    x: 3,
    y: 0
  };
  lockAcc = 0;
  lockResets = 0;
}

function nextType() {
  if (bag.length === 0) bag = shuffledBag();
  return bag[bag.length - 1];
}

// ---------- Actions ----------
function resetLock() {
  if (lockResets < MAX_LOCK_RESETS) {
    lockAcc = 0;
    lockResets++;
  }
}

function move(dx, dy) {
  if (!active || !running || paused) return false;
  if (!collides(active.matrix, active.x + dx, active.y + dy)) {
    active.x += dx;
    active.y += dy;
    if (dx !== 0) resetLock();
    return true;
  }
  return false;
}

function rotatePiece(dir) {
  if (!active || !running || paused) return false;
  const m = rotateMatrix(active.matrix, dir);
  for (const [kx, ky] of KICKS) {
    if (!collides(m, active.x + kx, active.y + ky)) {
      active.matrix = m;
      active.x += kx;
      active.y += ky;
      resetLock();
      return true;
    }
  }
  return false;
}

function ghostY() {
  let y = active.y;
  while (!collides(active.matrix, active.x, y + 1)) y++;
  return y;
}

function hardDrop() {
  if (!active || !running || paused) return;
  Sound.hardDrop();
  let dist = 0;
  while (!collides(active.matrix, active.x, active.y + 1)) {
    active.y++;
    dist++;
  }
  score += dist * 2;
  updateHUD();
  lockPiece();
}

function lockPiece() {
  const m = active.matrix;
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      if (!m[y][x]) continue;
      const by = active.y + y;
      if (by >= 0) board[by][active.x + x] = { color: active.color, dark: active.dark };
    }
  }
  clearLines();
  spawnPiece();
  dropAcc = 0;
  lockAcc = 0;
  if (collides(active.matrix, active.x, active.y)) endGame();
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every(c => c)) {
      board.splice(y, 1);
      board.unshift(new Array(COLS).fill(null));
      cleared++;
      y++;
    }
  }
  if (cleared > 0) {
    score += LINE_SCORES[cleared] * level;
    lines += cleared;
    Sound.clear(cleared);
    const newLevel = Math.floor(lines / 10) + 1;
    if (newLevel > level) {
      level = newLevel;
      Sound.levelUp();
    }
    updateHUD();
  }
}

function dropInterval() {
  return Math.max(60, 800 * Math.pow(0.82, level - 1));
}

// ---------- Game loop ----------
function tick(dt) {
  const interval = softDropHeld ? 40 : dropInterval();
  dropAcc += dt;
  let guard = 0;
  let gained = 0;
  while (dropAcc >= interval && guard++ < 40) {
    dropAcc -= interval;
    if (move(0, 1)) {
      if (softDropHeld) gained++;
    } else {
      dropAcc = 0;
      break;
    }
  }
  if (gained > 0) {
    score += gained;
    updateHUD();
  }
  if (active && collides(active.matrix, active.x, active.y + 1)) {
    lockAcc += dt;
    if (lockAcc >= LOCK_DELAY) {
      lockPiece();
      Sound.lock();
    }
  } else {
    lockAcc = 0;
    lockResets = 0;
  }
}

function loop(now) {
  if (!running) return;
  const dt = Math.min(100, now - lastTime);
  lastTime = now;
  if (!paused) tick(dt);
  draw();
  requestAnimationFrame(loop);
}

// ---------- Flow ----------
function updateHUD() {
  scoreEl.textContent = score;
  bestEl.textContent = Math.max(best, score);
  levelEl.textContent = level;
}

function showCard(title, html, buttonText) {
  messageTitleEl.textContent = title;
  messageTextEl.innerHTML = html;
  startButton.textContent = buttonText;
  pauseActions.classList.add("hidden");
  messageEl.classList.remove("hidden");
}

function startGame() {
  board = newBoard();
  bag = [];
  score = 0;
  lines = 0;
  level = 1;
  dropAcc = 0;
  lockAcc = 0;
  lockResets = 0;
  softDropHeld = false;
  serverBest = NaN;
  updateHUD();
  spawnPiece();
  running = true;
  paused = false;
  gameStarted = true;
  messageEl.classList.add("hidden");
  pauseButton.classList.remove("hidden");
  Sound.unlock();
  Sound.start();
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function endGame() {
  running = false;
  paused = false;
  softDropHeld = false;
  pauseButton.classList.add("hidden");
  if (score > best) {
    best = score;
    try { localStorage.setItem("tetrisBest", String(best)); } catch (e) {}
  }
  updateHUD();
  Sound.gameOver();
  submitScore(score);
}

function togglePause() {
  if (!gameStarted || !running) return;
  paused = !paused;
  Sound.pause();
  if (paused) {
    showCard("مکث", "برای ادامه دکمه را بزن.", "ادامه");
    pauseActions.classList.remove("hidden");
  } else {
    messageEl.classList.add("hidden");
  }
  lastTime = performance.now();
}

startButton.addEventListener("click", () => {
  if (!gameStarted || !running) startGame();
  else if (paused) togglePause();
});

pauseButton.addEventListener("click", togglePause);

// Pause menu actions: restart starts a fresh run, quit ends the run
// (submits the score) and shows the game-over card.
restartButton.addEventListener("click", () => {
  if (gameStarted && running) startGame();
});

quitButton.addEventListener("click", () => {
  if (gameStarted && running) endGame();
});

// Mute toggle (persisted in localStorage)
function refreshMuteIcon() {
  muteButton.textContent = Sound.isMuted() ? "🔇" : "🔊";
}
muteButton.addEventListener("click", () => {
  Sound.unlock();
  Sound.toggleMute();
  refreshMuteIcon();
});
refreshMuteIcon();

document.addEventListener("visibilitychange", () => {
  if (document.hidden && running && !paused) togglePause();
});

// ---------- Score submit (same protocol as the other games) ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function submitScore(value) {
  let status = "no-context";
  let isRecord = false;

  if (value <= 0) {
    // A zero score is never a record; skip the server round-trip.
    showGameOver(value, false, "skip-zero");
    return;
  }

  try {
    if (window.TelegramGameProxy && window.TelegramGameProxy.shareScore) {
      window.TelegramGameProxy.shareScore(value);
      status = "proxy-ok";
    } else if (window.TelegramGameProxy && window.TelegramGameProxy.setScore) {
      window.TelegramGameProxy.setScore(value);
      status = "proxy-ok";
    }
  } catch (e) { /* legacy proxy is best-effort */ }

  try {
    const params = new URLSearchParams(window.location.search);
    let uid = params.get("uid");
    const cid = params.get("cid");
    const mid = params.get("mid");
    const imid = params.get("imid");
    const game = params.get("game");

    if (!uid && window.Telegram && window.Telegram.WebApp &&
        window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
      uid = String(window.Telegram.WebApp.initDataUnsafe.user.id);
    }

    if (uid && (imid || (cid && mid))) {
      const body = { score: value, uid: Number(uid) };
      if (game) body.game = game;
      if (imid) body.imid = imid;
      if (cid) body.cid = cid;
      if (mid) body.mid = mid;

      const res = await fetch("/api/submit-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (Number.isFinite(Number(data.best))) serverBest = Number(data.best);
      isRecord = data.ok === true && data.isRecord === true;
      status = data.ok
        ? (isRecord ? "server-ok-record" : "server-ok")
        : ("server-fail:" + (data.error || res.status));
    } else {
      status = "missing-params uid=" + (uid || "null") + " imid=" + (imid || "null");
    }
  } catch (e) {
    status = "error:" + (e.message || "unknown");
  }

  showGameOver(value, isRecord, status);
}

function showGameOver(value, isRecord, status) {
  const shownBest = Number.isFinite(serverBest) ? serverBest : best;
  const recordLine = isRecord ? "🎉 <b>رکورد جدید!</b><br>" : "";
  const small = '<br><small style="opacity:.65;font-size:11px">' + escapeHtml(status) + "</small>";
  showCard(
    "بازی تمام شد",
    "امتیاز: <b>" + value + "</b><br>رکورد: <b>" + shownBest + "</b><br>" +
    "مرحله: <b>" + level + "</b> — خط‌ها: <b>" + lines + "</b><br>" + recordLine + small,
    "دوباره بازی"
  );
}

// ---------- Rendering ----------
function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCell(bx, by, color, dark, ghost) {
  const x = bx * CELL;
  const y = by * CELL;
  ctx.save();
  if (ghost) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
  } else {
    const g = ctx.createLinearGradient(x, y, x, y + CELL);
    g.addColorStop(0, color);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    roundRectPath(x + 1, y + 1, CELL - 2, CELL - 2, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    roundRectPath(x + 5, y + 4, CELL - 10, 5, 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPiece(matrix, px, py, color, dark, ghost) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (matrix[y][x] && py + y >= 0) drawCell(px + x, py + y, color, dark, ghost);
    }
  }
}

function drawMiniCell(x, y, size, color, dark) {
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, color);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  roundRectPath(x + 1, y + 1, size - 2, size - 2, 3);
  ctx.fill();
}

function drawPanel() {
  const px0 = BOARD_W;
  ctx.fillStyle = "#111c33";
  ctx.fillRect(px0, 0, PANEL_W, BOARD_H);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(px0, 0, 2, BOARD_H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px system-ui, Tahoma, sans-serif";
  ctx.fillText("بعدی", px0 + PANEL_W / 2, 26);

  const type = nextType();
  if (type) {
    const def = PIECES[type];
    const m = def.matrix;
    const s = 17;
    const w = m[0].length * s;
    const h = m.length * s;
    const ox = px0 + (PANEL_W - w) / 2;
    const oy = 40 + (4 * s - h) / 2;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) drawMiniCell(ox + x * s, oy + y * s, s, def.color, def.dark);
      }
    }
  }

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px system-ui, Tahoma, sans-serif";
  ctx.fillText("خط‌ها", px0 + PANEL_W / 2, 150);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 22px system-ui, Tahoma, sans-serif";
  ctx.fillText(String(lines), px0 + PANEL_W / 2, 178);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  ctx.strokeStyle = "rgba(148,163,184,0.09)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) {
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, BOARD_H);
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(BOARD_W, y * CELL + 0.5);
  }
  ctx.stroke();

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = board[y][x];
      if (c) drawCell(x, y, c.color, c.dark, false);
    }
  }

  if (active && running) {
    const gy = ghostY();
    if (gy !== active.y) drawPiece(active.matrix, active.x, gy, active.color, active.dark, true);
    drawPiece(active.matrix, active.x, active.y, active.color, active.dark, false);
  }

  drawPanel();
}

// ---------- Input: keyboard ----------
document.addEventListener("keydown", (e) => {
  if (e.code === "KeyP") {
    e.preventDefault();
    togglePause();
    return;
  }
  const actions = {
    ArrowLeft: () => { if (move(-1, 0)) Sound.move(); },
    ArrowRight: () => { if (move(1, 0)) Sound.move(); },
    ArrowDown: () => { softDropHeld = true; },
    ArrowUp: () => { if (rotatePiece(1)) Sound.rotate(); },
    KeyX: () => { if (rotatePiece(1)) Sound.rotate(); },
    KeyZ: () => { if (rotatePiece(-1)) Sound.rotate(); },
    Space: () => hardDrop()
  };
  const fn = actions[e.code];
  if (fn) {
    e.preventDefault();
    Sound.unlock();
    if (running && !paused && !e.repeat) fn();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "ArrowDown") softDropHeld = false;
});

// ---------- Input: touch buttons ----------
function bindHoldButton(el, onPress) {
  let delayTimer = null;
  let repeatTimer = null;
  const start = (e) => {
    e.preventDefault();
    Sound.unlock();
    if (!running || paused) return;
    onPress();
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => { if (running && !paused) onPress(); }, 90);
    }, 240);
  };
  const end = (e) => {
    if (e) e.preventDefault();
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    delayTimer = repeatTimer = null;
  };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("pointerleave", end);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

function bindTapButton(el, onTap) {
  const handler = (e) => {
    e.preventDefault();
    Sound.unlock();
    if (!running || paused) return;
    onTap();
  };
  el.addEventListener("pointerdown", handler);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

document.querySelectorAll("#controls button").forEach((btn) => {
  const act = btn.getAttribute("data-act");
  if (act === "left") bindHoldButton(btn, () => { if (move(-1, 0)) Sound.move(); });
  else if (act === "right") bindHoldButton(btn, () => { if (move(1, 0)) Sound.move(); });
  else if (act === "rotate") bindTapButton(btn, () => { if (rotatePiece(1)) Sound.rotate(); });
  else if (act === "drop") bindTapButton(btn, har
