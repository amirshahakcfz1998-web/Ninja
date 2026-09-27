(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const comboEl = document.getElementById("combo");
  const livesEl = document.getElementById("lives");
  const message = document.getElementById("message");
  const messageText = document.getElementById("messageText");
  const startButton = document.getElementById("startButton");
  const pauseButton = document.getElementById("pauseButton");
  const pause = document.getElementById("pause");
  const resumeButton = document.getElementById("resumeButton");

  const tg = window.Telegram?.WebApp;
  try { tg?.expand(); tg?.ready(); } catch {}

  let W = 0, H = 0, dpr = 1;
  let running = false, paused = false, last = 0, spawnTimer = 0;
  let score = 0, best = Number(localStorage.getItem("ninjaFruitBest") || 0);
  let lives = 3, combo = 0, level = 1;
  let objects = [], particles = [], trails = [];
  let pointerDown = false, lastPointer = null;
  let gameStart = 0;
  let shake = 0;

  // ---------- Simple procedural audio ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function playTone(freq, duration, type = "sine", vol = 0.15, slide = 0) {
    ensureAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t0 + duration);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function sfxSlice() {
    playTone(880 + Math.random() * 200, 0.07, "triangle", 0.12, -400);
    playTone(440 + Math.random() * 100, 0.05, "sine", 0.08, -200);
  }
  function sfxBomb() {
    playTone(120, 0.25, "sawtooth", 0.2, -80);
    playTone(60, 0.35, "sine", 0.18, -40);
  }
  function sfxCombo() {
    playTone(660, 0.08, "sine", 0.1);
    setTimeout(() => playTone(880, 0.1, "sine", 0.12), 60);
  }
  function sfxStart() {
    playTone(523, 0.12, "sine", 0.1);
    setTimeout(() => playTone(659, 0.12, "sine", 0.1), 100);
    setTimeout(() => playTone(784, 0.18, "sine", 0.12), 200);
  }
  function sfxGameOver() {
    playTone(392, 0.2, "triangle", 0.12, -100);
    setTimeout(() => playTone(311, 0.35, "triangle", 0.14, -80), 150);
  }

  const fruitDefs = [
    {name:"apple", color:"#ef4056", inner:"#ffb1ba", leaf:"#3dcf77", points:10},
    {name:"orange", color:"#ff9e2c", inner:"#ffd59a", leaf:"#73b85b", points:12},
    {name:"lemon", color:"#ffd34d", inner:"#fff2a8", leaf:"#8bc34a", points:14},
    {name:"watermelon", color:"#3dcf77", inner:"#ff6674", leaf:"#2e7d32", points:16},
    {name:"plum", color:"#8e62d7", inner:"#d5b9ff", leaf:"#66bb6a", points:18},
    {name:"kiwi", color:"#73b85b", inner:"#e9ffad", leaf:"#558b2f", points:20}
  ];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, innerWidth);
    H = Math.max(520, innerHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", resize, { passive: true });
  resize();

  bestEl.textContent = best;

  function vibrate(ms = 12) {
    try { tg?.HapticFeedback?.impactOccurred("light"); } catch {}
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function spawn() {
    const count = Math.random() < Math.min(0.45, level * 0.035) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const bomb = Math.random() < Math.min(0.13 + level * 0.006, 0.24);
      const r = rand(27, 42);
      const def = fruitDefs[Math.floor(Math.random() * fruitDefs.length)];
      objects.push({
        type: bomb ? "bomb" : "fruit",
        def,
        x: rand(r + 8, W - r - 8),
        y: H + r + rand(0, 35),
        r,
        vx: rand(-100, 100) * (0.7 + level * 0.025),
        vy: -rand(850, 1050) * (0.88 + level * 0.035),
        gravity: 1500 + level * 35,
        rot: rand(0, Math.PI * 2),
        vr: rand(-5, 5),
        sliced: false,
        born: performance.now()
      });
    }
  }

  function drawBackground() {
    // Deep night sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a2a4a");
    g.addColorStop(0.4, "#121c32");
    g.addColorStop(1, "#070b14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(60,120,180,0.08)");
    vg.addColorStop(0.6, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Subtle floating particles (dust)
    ctx.save();
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 18; i++) {
      const px = (Math.sin(performance.now() * 0.0003 + i * 1.7) * 0.5 + 0.5) * W;
      const py = (Math.cos(performance.now() * 0.00025 + i * 2.1) * 0.5 + 0.5) * H;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFruit(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);

    if (o.type === "bomb") {
      // Glow
      ctx.shadowColor = "rgba(255,60,60,0.4)";
      ctx.shadowBlur = 22;
      // Body
      ctx.fillStyle = "#1a1e28";
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Highlight
      ctx.fillStyle = "#2f3545";
      ctx.beginPath();
      ctx.arc(-o.r * 0.28, -o.r * 0.28, o.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      // Fuse
      ctx.strokeStyle = "#e8a84a";
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(o.r * 0.3, -o.r * 0.65);
      ctx.quadraticCurveTo(o.r * 0.7, -o.r * 1.15, o.r * 0.95, -o.r * 0.7);
      ctx.stroke();
      // Spark
      const sparkPulse = 0.7 + Math.sin(performance.now() * 0.02) * 0.3;
      ctx.fillStyle = `rgba(255,${120 + 80 * sparkPulse|0},50,${sparkPulse})`;
      ctx.beginPath();
      ctx.arc(o.r * 0.95, -o.r * 0.7, 5.5 * sparkPulse, 0, Math.PI * 2);
      ctx.fill();
      // Skull mark (simple)
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(0, 2, o.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const d = o.def;
    // Outer glow
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 16;
    // Main body
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(0, 0, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner flesh
    ctx.fillStyle = d.inner;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(-o.r * 0.18, -o.r * 0.18, o.r * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Highlight shine
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-o.r * 0.32, -o.r * 0.38, o.r * 0.22, o.r * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // Small secondary shine
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(o.r * 0.25, o.r * 0.15, o.r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // Stem
    ctx.fillStyle = "#5b3a21";
    ctx.fillRect(-2.2, -o.r * 0.98, 4.4, 10);

    // Leaf
    if (d.leaf) {
      ctx.fillStyle = d.leaf;
      ctx.beginPath();
      ctx.ellipse(6, -o.r * 0.9, 7, 3.5, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawTrail() {
    ctx.save();
    for (let i = 0; i < trails.length; i++) {
      const p = trails[i];
      const alpha = Math.max(0, p.life / 0.14);
      ctx.globalAlpha = alpha * 0.85;
      const grd = ctx.createLinearGradient(p.x1, p.y1, p.x2, p.y2);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(0.5, "#fff");
      grd.addColorStop(1, "rgba(255,220,150,0.9)");
      ctx.strokeStyle = grd;
      ctx.lineWidth = 3 + alpha * 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function sliceAt(x, y) {
    let hit = false;
    for (const o of objects) {
      if (o.sliced) continue;
      const dx = x - o.x, dy = y - o.y;
      if (dx * dx + dy * dy <= (o.r + 20) * (o.r + 20)) {
        o.sliced = true;
        hit = true;
        if (o.type === "bomb") {
          lives--;
          combo = 0;
          shake = 12;
          vibrate(50);
          sfxBomb();
          burst(o.x, o.y, "#ff5757", 32);
          burst(o.x, o.y, "#ffaa00", 12);
          updateLives();
          if (lives <= 0) endGame();
        } else {
          combo++;
          const multiplier = Math.min(1 + Math.floor(combo / 5), 5);
          score += o.def.points * multiplier;
          sfxSlice();
          if (combo > 0 && combo % 5 === 0) sfxCombo();
          burst(o.x, o.y, o.def.color, 22);
          if (combo >= 5) burst(o.x, o.y, "#ffd166", 10);
          vibrate(8);
          updateHud();
        }
      }
    }
    return hit;
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(100, 480);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.35, 0.75),
        max: 0.75,
        color,
        size: rand(2.5, 7)
      });
    }
  }

  function updateLives() {
    livesEl.innerHTML = [0, 1, 2].map(i =>
      `<span style="opacity:${i < lives ? 1 : 0.18}">❤</span>`
    ).join("");
  }

  function updateHud() {
    scoreEl.textContent = score;
    comboEl.textContent = "x" + combo;
  }

  function startGame() {
    ensureAudio();
    sfxStart();
    score = 0; lives = 3; combo = 0; level = 1;
    objects = []; particles = []; trails = [];
    gameStart = performance.now();
    running = true; paused = false;
    last = performance.now(); spawnTimer = 0; shake = 0;
    message.classList.add("hidden");
    pause.classList.add("hidden");
    pauseButton.textContent = "Ⅱ";
    updateLives(); updateHud();
    requestAnimationFrame(loop);
  }

  function endGame() {
    running = false;
    sfxGameOver();
    if (score > best) {
      best = score;
      localStorage.setItem("ninjaFruitBest", best);
      bestEl.textContent = best;
    }
    messageText.innerHTML = `Score: <b>${score}</b><br>Best: <b>${best}</b>`;
    startButton.textContent = "PLAY AGAIN";
    message.classList.remove("hidden");
    submitScore(score);
  }

  async function submitScore(value) {
    // 1. Official Telegram proxy (share sheet)
    try {
      if (window.TelegramGameProxy?.shareScore) {
        window.TelegramGameProxy.shareScore(value);
      } else if (window.TelegramGameProxy?.setScore) {
        window.TelegramGameProxy.setScore(value);
      }
    } catch {}

    // 2. Our Worker for group Top Players
    try {
      const params = new URLSearchParams(window.location.search);
      const uid = params.get("uid");
      const cid = params.get("cid");
      const mid = params.get("mid");
      const imid = params.get("imid");

      if (uid && ((cid && mid) || imid)) {
        await fetch("/api/submit-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            score: value,
            uid: Number(uid),
            cid: cid || undefined,
            mid: mid || undefined,
            imid: imid || undefined
          })
        });
      }
    } catch {}
  }

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pointerStart(e) {
    pointerDown = true;
    lastPointer = setPointer(e);
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }
  function pointerMove(e) {
    if (!pointerDown || !running || paused) return;
    const p = setPointer(e);
    const a = lastPointer || p;
    const dx = p.x - a.x, dy = p.y - a.y;
    if (dx * dx + dy * dy > 9) {
      trails.push({ x1: a.x, y1: a.y, x2: p.x, y2: p.y, life: 0.14 });
      sliceAt(p.x, p.y);
      lastPointer = p;
    }
  }
  function pointerEnd() { pointerDown = false; lastPointer = null; }

  canvas.addEventListener("pointerdown", pointerStart);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);
  canvas.addEventListener("pointerleave", pointerEnd);

  pauseButton.addEventListener("click", () => {
    if (!running) return;
    paused = !paused;
    pause.classList.toggle("hidden", !paused);
    pauseButton.textContent = paused ? "▶" : "Ⅱ";
    if (!paused) { last = performance.now(); requestAnimationFrame(loop); }
  });
  resumeButton.addEventListener("click", () => {
    paused = false;
    pause.classList.add("hidden");
    pauseButton.textContent = "Ⅱ";
    last = performance.now();
    requestAnimationFrame(loop);
  });
  startButton.addEventListener("click", startGame);

  function loop(now) {
    if (!running || paused) return;
    let dt = Math.min(0.032, (now - last) / 1000 || 0);
    last = now;
    const elapsed = (now - gameStart) / 1000;
    level = 1 + Math.floor(elapsed / 20);
    spawnTimer -= dt;
    const spawnEvery = Math.max(0.27, 0.72 - level * 0.028);
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = spawnEvery * Math.max(0.45, 1 - Math.min(0.35, combo * 0.008));
    }

    // Screen shake
    let sx = 0, sy = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake;
      sy = (Math.random() - 0.5) * shake;
      shake *= 0.88;
      if (shake < 0.5) shake = 0;
    }

    ctx.save();
    ctx.translate(sx, sy);

    drawBackground();

    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      o.vy += o.gravity * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rot += o.vr * dt;

      if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); }
      if (o.x > W - o.r) { o.x = W - o.r; o.vx = -Math.abs(o.vx); }

      if (!o.sliced) drawFruit(o);
      if (o.sliced) objects.splice(i, 1);
      else if (o.y > H + o.r * 2) {
        if (o.type === "fruit") {
          combo = 0;
          updateHud();
        }
        objects.splice(i, 1);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 700 * dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (let i = trails.length - 1; i >= 0; i--) {
      trails[i].life -= dt;
      if (trails[i].life <= 0) trails.splice(i, 1);
    }
    drawTrail();

    // Level indicator
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "700 12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("LV " + level, W / 2, H - 18);

    ctx.restore();

    requestAnimationFrame(loop);
  }

  // Initial screen
  updateLives();
  updateHud();
  message.classList.remove("hidden");
})();
    
