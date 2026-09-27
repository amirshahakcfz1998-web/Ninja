(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const message = document.getElementById("message");
  const messageText = document.getElementById("messageText");
  const startButton = document.getElementById("startButton");

  const tg = window.Telegram?.WebApp;
  try { tg?.expand(); tg?.ready(); } catch {}

  let W = 0, H = 0, dpr = 1;
  let running = false, last = 0;
  let score = 0, best = Number(localStorage.getItem("flyingBirdBest") || 0);
  let bird, pipes = [], frame = 0, gravity = 0.45, flap = -7.8;
  let bgOffset = 0, groundOffset = 0;

  // Sounds
  const sfxFlap = new Audio("/sounds/slice.mp3"); // reuse or put a flap sound
  const sfxScore = new Audio("/sounds/combo.mp3");
  const sfxHit = new Audio("/sounds/bomb.mp3");
  [sfxFlap, sfxScore, sfxHit].forEach(a => { a.volume = 0.55; a.preload = "auto"; });

  function play(a) {
    try { a.currentTime = 0; a.play().catch(()=>{}); } catch {}
  }

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

  function reset() {
    bird = {
      x: W * 0.28,
      y: H * 0.45,
      r: 18,
      vy: 0,
      rot: 0
    };
    pipes = [];
    score = 0;
    frame = 0;
    bgOffset = 0;
    groundOffset = 0;
    scoreEl.textContent = "0";
  }

  function spawnPipe() {
    const gap = 150 + Math.random() * 30;
    const topH = 80 + Math.random() * (H - 260 - gap);
    pipes.push({
      x: W + 40,
      w: 62,
      top: topH,
      gap,
      passed: false
    });
  }

  function drawBackground() {
    // Sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#4ec0ca");
    g.addColorStop(0.6, "#70c5ce");
    g.addColorStop(1, "#d5f0f3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft clouds
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 180 - bgOffset * 0.3) % (W + 200)) - 50;
      const cy = 60 + i * 35;
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, Math.PI * 2);
      ctx.arc(cx + 25, cy - 8, 22, 0, Math.PI * 2);
      ctx.arc(cx + 50, cy, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ground
    const groundY = H - 90;
    ctx.fillStyle = "#ded895";
    ctx.fillRect(0, groundY, W, 90);
    ctx.fillStyle = "#c2b06e";
    ctx.fillRect(0, groundY, W, 12);

    // Grass pattern
    ctx.fillStyle = "#8bc34a";
    for (let x = -((groundOffset * 1.5) % 40); x < W; x += 40) {
      ctx.fillRect(x, groundY + 12, 20, 8);
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);

    // Body
    ctx.fillStyle = "#ffd54f";
    ctx.beginPath();
    ctx.ellipse(0, 0, bird.r + 2, bird.r - 1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.fillStyle = "#ffb300";
    ctx.beginPath();
    ctx.ellipse(-4, 4, 12, 8, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(8, -5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(10, -5, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#ff7043";
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(26, 3);
    ctx.lineTo(14, 7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawPipes() {
    for (const p of pipes) {
      // Top pipe
      ctx.fillStyle = "#2e7d32";
      ctx.fillRect(p.x, 0, p.w, p.top);
      ctx.fillStyle = "#43a047";
      ctx.fillRect(p.x - 4, p.top - 28, p.w + 8, 28);

      // Bottom pipe
      const bottomY = p.top + p.gap;
      ctx.fillStyle = "#2e7d32";
      ctx.fillRect(p.x, bottomY, p.w, H - bottomY - 90);
      ctx.fillStyle = "#43a047";
      ctx.fillRect(p.x - 4, bottomY, p.w + 8, 28);

      // Highlights
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(p.x + 6, 0, 8, p.top - 28);
      ctx.fillRect(p.x + 6, bottomY + 28, 8, H - bottomY - 118);
    }
  }

  function flapBird() {
    if (!running) return;
    bird.vy = flap;
    play(sfxFlap);
    try { tg?.HapticFeedback?.impactOccurred("light"); } catch {}
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function startGame() {
    reset();
    running = true;
    last = performance.now();
    message.classList.add("hidden");
    requestAnimationFrame(loop);
  }

  function endGame() {
    running = false;
    play(sfxHit);
    if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    if (score > best) {
      best = score;
      localStorage.setItem("flyingBirdBest", best);
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
      let uid = params.get("uid");
      const cid = params.get("cid");
      const mid = params.get("mid");
      const imid = params.get("imid");

      if (!uid && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
        uid = String(window.Telegram.WebApp.initDataUnsafe.user.id);
      }

      if (uid && (imid || (cid && mid))) {
        const body = { score: value, uid: Number(uid) };
        if (imid) body.imid = imid;
        if (cid) body.cid = cid;
        if (mid) body.mid = mid;

        await fetch("/api/submit-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
      }
    } catch {}
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(32, now - last);
    last = now;
    frame++;

    // Physics
    bird.vy += gravity;
    bird.y += bird.vy;
    bird.rot = Math.min(Math.PI / 3, Math.max(-0.6, bird.vy * 0.06));

    // Pipes
    if (frame % 100 === 0) spawnPipe();
    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= 2.8;

      // Score
      if (!p.passed && p.x + p.w < bird.x) {
        p.passed = true;
        score++;
        scoreEl.textContent = score;
        play(sfxScore);
      }

      // Collision
      const inX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + p.w;
      const hitTop = bird.y - bird.r < p.top;
      const hitBottom = bird.y + bird.r > p.top + p.gap;
      if (inX && (hitTop || hitBottom)) {
        endGame();
        return;
      }

      if (p.x + p.w < -20) pipes.splice(i, 1);
    }

    // Ground / ceiling
    if (bird.y + bird.r > H - 90 || bird.y - bird.r < 0) {
      endGame();
      return;
    }

    bgOffset += 0.6;
    groundOffset += 2.8;

    // Draw
    drawBackground();
    drawPipes();
    drawBird();

    requestAnimationFrame(loop);
  }

  // Input
  function onTap(e) {
    e.preventDefault();
    if (!running) return;
    flapBird();
  }
  canvas.addEventListener("pointerdown", onTap);
  canvas.addEventListener("touchstart", onTap, { passive: false });

  startButton.addEventListener("click", startGame);

  // Show start screen
  message.classList.remove("hidden");
})();
  
