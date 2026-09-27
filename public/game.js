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

  // ---------- Real audio files ----------
  const sounds = {
    slice: new Audio("/sounds/slice.mp3"),
    bomb: new Audio("/sounds/bomb.mp3"),
    combo: new Audio("/sounds/combo.mp3"),
    start: new Audio("/sounds/start.mp3")
  };

  // Preload and set volume
  Object.values(sounds).forEach(a => {
    a.preload = "auto";
    a.volume = 0.7;
  });
  sounds.bomb.volume = 0.9;

  function playSound(name) {
    const a = sounds[name];
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch {}
  }

  const fruitDefs = [
    { name: "apple", color: "#e8364e", inner: "#ff9eab", leaf: "#3dcf77", points: 10 },
    { name: "orange", color: "#ff8c1a", inner: "#ffd080", leaf: "#6ab04c", points: 12 },
    { name: "lemon", color: "#ffd23f", inner: "#fff3a0", leaf: "#8bc34a", points: 14 },
    { name: "watermelon", color: "#2ecc71", inner: "#ff5c6c", leaf: "#27ae60", points: 16 },
    { name: "plum", color: "#9b59b6", inner: "#d7bde2", leaf: "#58d68d", points: 18 },
    { name: "kiwi", color: "#6ab04c", inner: "#f9e79f", leaf: "#1e8449", points: 20 }
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

  function vibrate(pattern = 12) {
    try { tg?.HapticFeedback?.impactOccurred("medium"); } catch {}
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function spawn() {
    const count = Math.random() < Math.min(0.45, level * 0.035) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const bomb = Math.random() < Math.min(0.13 + level * 0.006, 0.24);
      const r = rand(28, 44);
      const def = fruitDefs[Math.floor(Math.random() * fruitDefs.length)];
      objects.push({
        type: bomb ? "bomb" : "fruit",
        def,
        x: rand(r + 10, W - r - 10),
        y: H + r + rand(0, 40),
        r,
        vx: rand(-110, 110) * (0.7 + level * 0.025),
        vy: -rand(860, 1080) * (0.88 + level * 0.035),
        gravity: 1520 + level * 38,
        rot: rand(0, Math.PI * 2),
        vr: rand(-5.5, 5.5),
        sliced: false,
        born: performance.now()
      });
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1c2d4f");
    g.addColorStop(0.45, "#121d35");
    g.addColorStop(1, "#060a12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft light in center
    const rg = ctx.createRadialGradient(W / 2, H * 0.35, 10, W / 2, H * 0.5, Math.max(W, H) * 0.7);
    rg.addColorStop(0, "rgba(70,130,190,0.09)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Floating dust
    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 20; i++) {
      const t = performance.now() * 0.00025;
      const px = (Math.sin(t + i * 1.9) * 0.5 + 0.5) * W;
      const py = (Math.cos(t * 0.9 + i * 2.3) * 0.5 + 0.5) * H;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(px, py, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFruit(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);

    if (o.type === "bomb") {
      // Outer glow
      ctx.shadowColor = "rgba(255,50,50,0.45)";
      ctx.shadowBlur = 24;

      // Main body
      ctx.fillStyle = "#161a24";
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Top highlight
      ctx.fillStyle = "#2a3040";
      ctx.beginPath();
      ctx.arc(-o.r * 0.25, -o.r * 0.28, o.r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Metal ring
      ctx.strokeStyle = "#4a5160";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.78, 0, Math.PI * 2);
      ctx.stroke();

      // Fuse
      ctx.strokeStyle = "#e8a040";
      ctx.lineWidth = 4.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(o.r * 0.28, -o.r * 0.68);
      ctx.quadraticCurveTo(o.r * 0.75, -o.r * 1.2, o.r * 1.0, -o.r * 0.72);
      ctx.stroke();

      // Spark (animated)
      const pulse = 0.65 + Math.sin(performance.now() * 0.025) * 0.35;
      ctx.fillStyle = `rgba(255,${140 + 90 * pulse | 0},40,${0.7 + 0.3 * pulse})`;
      ctx.beginPath();
      ctx.arc(o.r * 1.0, -o.r * 0.72, 6 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Warning mark
      ctx.fillStyle = "rgba(255,80,80,0.25)";
      ctx.beginPath();
      ctx.arc(0, 3, o.r * 0.32, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return;
    }

    const d = o.def;

    // Soft outer glow
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 18;

    // Main body
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(0, 0, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner flesh (offset for 3D feel)
    ctx.fillStyle = d.inner;
    ctx.globalAlpha = 0.93;
    ctx.beginPath();
    ctx.arc(-o.r * 0.16, -o.r * 0.16, o.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Watermelon stripes (only for watermelon)
    if (d.name === "watermelon") {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#1e8449";
      ctx.lineWidth = 3.5;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, o.r * 0.85, o.r * 0.35, i * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Kiwi seeds (only for kiwi)
    if (d.name === "kiwi") {
      ctx.fillStyle = "#3e2723";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * o.r * 0.35, Math.sin(a) * o.r * 0.35, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Main highlight (shiny look)
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-o.r * 0.3, -o.r * 0.35, o.r * 0.24, o.r * 0.15, -0.55, 0, Math.PI * 2);
    ctx.fill();

    // Secondary smaller shine
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(o.r * 0.28, o.r * 0.18, o.r * 0.11, 0, Math.PI * 2);
    ctx.fill();

    // Stem
    ctx.fillStyle = "#4e342e";
    ctx.fillRect(-2.4, -o.r * 1.02, 4.8, 11);

    // Leaf
    if (d.leaf) {
      ctx.fillStyle = d.leaf;
      ctx.beginPath();
      ctx.ellipse(7, -o.r * 0.92, 8, 3.8, 0.55, 0, Math.PI * 2);
      ctx.fill();
      // Leaf vein
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(3, -o.r * 0.92);
      ctx.lineTo(11, -o.r * 0.92);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTrail() {
    ctx.save();
    for (let i = 0; i < trails.length; i++) {
      const p = trails[i];
      const alpha = Math.max(0, p.life / 0.15);
      ctx.globalAlpha = alpha * 0.9;
      const grd = ctx.createLinearGradient(p.x1, p.y1, p.x2, p.y2);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(0.4, "#ffffff");
      grd.addColorStop(1, "rgba(255,210,120,0.95)");
      ctx.strokeStyle = grd;
      ctx.lineWidth = 3.5 + alpha * 7;
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
      if (dx * dx + dy * dy <= (o.r + 22) * (o.r + 22)) {
        o.sliced = true;
        hit = true;

        if (o.type === "bomb") {
          lives--;
          combo = 0;
          shake = 16;
          // Strong vibration pattern
          vibrate([40, 30, 60, 30, 90]);
          playSound("bomb");
          burst(o.x, o.y, "#ff4d4d", 36);
          burst(o.x, o.y, "#ffaa00", 16);
          burst(o.x, o.y, "#ffffff", 8);
          updateLives();
          if (lives <= 0) endGame();
        } else {
          combo++;
          const multiplier = Math.min(1 + Math.floor(combo / 5), 5);
          score += o.def.points * multiplier;
          playSound("slice");
          if (combo > 0 && combo % 5 === 0) playSound("combo");
          burst(o.x, o.y, o.def.color, 24);
          if (combo >= 5) burst(o.x, o.y, "#ffd166", 12);
          vibrate(10);
          updateHud();
        }
      }
    }
    return hit;
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(110, 520);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.4, 0.85),
        max: 0.85,
        color,
        size: rand(2.8, 7.5)
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
    playSound("start");
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
    try {
      if (window.TelegramGameProxy?.shareScore) {
        window.TelegramGameProxy.shareScore(value);
      } else if (window.TelegramGameProxy?.setScore) {
        window.TelegramGameProxy.setScore(value);
      }
    } catch {}

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
      trails.push({ x1: a.x, y1: a.y, x2: p.x, y2: p.y, life: 0.15 });
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
      shake *= 0.86;
      if (shake < 0.4) shake = 0;
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
      p.vy += 720 * dt;
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
    
