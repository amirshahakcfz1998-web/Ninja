(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const comboEl = document.getElementById("combo");
  const levelEl = document.getElementById("levelText");
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


  // Background ninja image
  const bgImg = new Image();
  bgImg.src = "/ninja-bg.png";
  let bgReady = false;
  bgImg.onload = () => { bgReady = true; };

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

    // Ninja background image (centered, faded)
    if (bgReady && bgImg.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      const maxSize = Math.min(W * 0.75, H * 0.55);
      const scale = Math.min(maxSize / bgImg.naturalWidth, maxSize / bgImg.naturalHeight);
      const iw = bgImg.naturalWidth * scale;
      const ih = bgImg.naturalHeight * scale;
      const ix = (W - iw) / 2;
      const iy = (H - ih) / 2 - H * 0.05;
      ctx.drawImage(bgImg, ix, iy, iw, ih);
      ctx.restore();
    }

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
      ctx.shadowColor = "rgba(255,50,50,0.5)";
      ctx.shadowBlur = 26;

      // Main body
      ctx.fillStyle = "#151920";
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Top highlight
      ctx.fillStyle = "#2a3140";
      ctx.beginPath();
      ctx.arc(-o.r * 0.28, -o.r * 0.3, o.r * 0.52, 0, Math.PI * 2);
      ctx.fill();

      // Metal band
      ctx.strokeStyle = "#555e70";
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.76, 0, Math.PI * 2);
      ctx.stroke();

      // Fuse
      ctx.strokeStyle = "#e8a040";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(o.r * 0.3, -o.r * 0.7);
      ctx.quadraticCurveTo(o.r * 0.8, -o.r * 1.25, o.r * 1.05, -o.r * 0.75);
      ctx.stroke();

      // Animated spark
      const pulse = 0.6 + Math.sin(performance.now() * 0.028) * 0.4;
      ctx.fillStyle = `rgba(255,${130 + 100 * pulse | 0},30,${0.75 + 0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(o.r * 1.05, -o.r * 0.75, 6.5 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return;
    }

    const d = o.def;

    // Soft outer glow
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 20;

    // Main body with slight gradient feel
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(0, 0, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner lighter part (3D volume)
    ctx.fillStyle = d.inner;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(-o.r * 0.18, -o.r * 0.2, o.r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Watermelon stripes
    if (d.name === "watermelon") {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "#1b5e20";
      ctx.lineWidth = 4;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, o.r * 0.88, o.r * 0.32, i * 0.38, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Kiwi seeds + center
    if (d.name === "kiwi") {
      // White center ring
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      // Seeds
      ctx.fillStyle = "#3e2723";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * o.r * 0.38, Math.sin(a) * o.r * 0.38, 2.2, 1.2, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Big glossy highlight
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.ellipse(-o.r * 0.32, -o.r * 0.38, o.r * 0.26, o.r * 0.16, -0.55, 0, Math.PI * 2);
    ctx.fill();

    // Smaller secondary shine
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.arc(o.r * 0.3, o.r * 0.2, o.r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Stem
    ctx.fillStyle = "#4e342e";
    ctx.beginPath();
    ctx.roundRect(-2.6, -o.r * 1.05, 5.2, 12, 2);
    ctx.fill();

    // Leaf
    if (d.leaf) {
      ctx.fillStyle = d.leaf;
      ctx.beginPath();
      ctx.ellipse(8, -o.r * 0.95, 9, 4.2, 0.5, 0, Math.PI * 2);
      ctx.fill();
      // Vein
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(2, -o.r * 0.95);
      ctx.lineTo(14, -o.r * 0.95);
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
    if (levelEl) levelEl.textContent = "LV " + level;
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
    let status = "no-context";

    // 1. Official Telegram share
    try {
      if (window.TelegramGameProxy?.shareScore) {
        window.TelegramGameProxy.shareScore(value);
        status = "proxy-ok";
      } else if (window.TelegramGameProxy?.setScore) {
        window.TelegramGameProxy.setScore(value);
        status = "proxy-ok";
      }
    } catch {}

    // 2. Send to our Worker
    try {
      const params = new URLSearchParams(window.location.search);
      let uid = params.get("uid");
      let cid = params.get("cid");
      let mid = params.get("mid");
      let imid = params.get("imid");

      if (!uid && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
        uid = String(window.Telegram.WebApp.initDataUnsafe.user.id);
      }

      if (uid && (imid || (cid && mid))) {
        const body = { score: value, uid: Number(uid) };
        if (imid) body.imid = imid;
        if (cid) body.cid = cid;
        if (mid) body.mid = mid;

        const res = await fetch("/api/submit-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        status = data.ok ? "server-ok" : ("server-fail:" + (data.error || res.status));
      } else {
        status = "missing-params uid=" + (uid||"null") + " imid=" + (imid||"null");
      }
    } catch (e) {
      status = "error:" + (e.message || "unknown");
    }

    // Show status on end screen
    try {
      const p = document.getElementById("messageText");
      if (p) {
        p.innerHTML = `Score: <b>${value}</b><br>Best: <b>${best}</b><br><br><small style="opacity:.65;font-size:11px;word-break:break-all">${status}</small>`;
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

    ctx.restore();
    requestAnimationFrame(loop);
  }

  // Initial screen + debug params
  updateLives();
  updateHud();
  message.classList.remove("hidden");

  // Temporary debug: show URL params
  try {
    const params = new URLSearchParams(window.location.search);
    const debugInfo = [
      "uid=" + (params.get("uid") || "null"),
      "cid=" + (params.get("cid") || "null"),
      "mid=" + (params.get("mid") || "null"),
      "imid=" + (params.get("imid") || "null")
    ].join(" | ");
    const p = document.getElementById("messageText");
    if (p) {
      p.innerHTML = "Slice fruit. Avoid bombs.<br><br><small style=\"opacity:.6;font-size:11px;word-break:break-all\">" + debugInfo + "</small>";
    }
  } catch {}
})();
          
