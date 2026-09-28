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
  let objects = [], particles = [], trails = [], halves = [];
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
        born: performance.now(),
        seed: (Math.random() * 1e9) | 0
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


  // ---------- 3D fruit rendering ----------
  // Deterministic RNG so peel textures don't shimmer between frames
  function mulberry32(a) {
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Spherical light: bright top-left, mid tone, dark at the far side
  function sphereGrad(r, cLight, cMid, cDark) {
    const g = ctx.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.08, 0, 0, r * 1.08);
    g.addColorStop(0, cLight);
    g.addColorStop(0.42, cMid);
    g.addColorStop(1, cDark);
    return g;
  }

  // Curvature falloff: edges fall into shadow like a real ball
  function rimGrad(r) {
    const g = ctx.createRadialGradient(0, 0, r * 0.58, 0, 0, r);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.34)");
    return g;
  }

  function gloss(x, y, w, h, rot, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
    g.addColorStop(0, "rgba(255,255,255," + alpha + ")");
    g.addColorStop(0.55, "rgba(255,255,255," + (alpha * 0.35) + ")");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function blob(x, y, rad, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(" + rgb + "," + alpha + ")");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Deterministic peel texture (orange pores, lemon bumps, kiwi grain)
  function speckles(seed, r, n, color, aMax, sMin, sMax) {
    const rnd = mulberry32(seed);
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.9;
      const s = sMin + rnd() * (sMax - sMin);
      const fade = Math.max(0.1, 1 - d / (r * 0.95));
      ctx.globalAlpha = aMax * fade;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawStemLeaf(r, d) {
    // ambient occlusion where the stem meets the fruit
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(0, -r * 0.96, r * 0.13, r * 0.055, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.rotate(0.18);
    const sg = ctx.createLinearGradient(0, 0, 5, 0);
    sg.addColorStop(0, "#6d4c41");
    sg.addColorStop(1, "#2e1c12");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.roundRect(-2.4, -r * 1.04, 5.4, r * 0.32, 2.4);
    ctx.fill();
    ctx.restore();
    if (d.leaf) {
      ctx.save();
      ctx.translate(r * 0.17, -r * 0.94);
      ctx.rotate(0.5);
      const lg = ctx.createLinearGradient(0, -r * 0.12, 0, r * 0.12);
      lg.addColorStop(0, d.leaf);
      lg.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.26, r * 0.115, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.21, 0);
      ctx.quadraticCurveTo(0, -r * 0.03, r * 0.21, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Cool rim light on the shadow side for extra depth
  function rimLight(r, rgb, alpha) {
    ctx.save();
    ctx.strokeStyle = "rgba(" + rgb + "," + alpha + ")";
    ctx.lineWidth = r * 0.07;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(" + rgb + "," + alpha + ")";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.93, Math.PI * 0.12, Math.PI * 0.62);
    ctx.stroke();
    ctx.restore();
  }

  // Tight bright specular core inside the soft gloss
  function specCore(x, y, w, h, rot) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, rot, 0, Math.PI * 2);
    ctx.fill();
  }

  // Classic apple silhouette: shoulders + stem dimple
  function applePath(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.84);
    ctx.bezierCurveTo(-r * 0.55, -r * 0.99, -r * 0.95, -r * 0.72, -r * 0.98, -r * 0.08);
    ctx.bezierCurveTo(-r * 1.0, r * 0.55, -r * 0.6, r * 0.96, 0, r * 0.96);
    ctx.bezierCurveTo(r * 0.6, r * 0.96, r * 1.0, r * 0.55, r * 0.98, -r * 0.08);
    ctx.bezierCurveTo(r * 0.95, -r * 0.72, r * 0.55, -r * 0.99, 0, -r * 0.84);
    ctx.closePath();
  }

  function paintApple(o, r, d) {
    applePath(r);
    ctx.fillStyle = sphereGrad(r, "#ff9d8a", "#e8364e", "#7d0e1e");
    ctx.fill();
    // natural red striping, clipped to the fruit
    ctx.save();
    applePath(r);
    ctx.clip();
    const rnd = mulberry32(o.seed + 3);
    ctx.strokeStyle = "rgba(140,8,22,0.20)";
    ctx.lineCap = "round";
    for (let i = -3; i <= 3; i++) {
      ctx.lineWidth = r * (0.05 + rnd() * 0.05);
      const x0 = i * r * 0.26 + (rnd() - 0.5) * r * 0.08;
      ctx.beginPath();
      ctx.moveTo(x0, -r);
      ctx.quadraticCurveTo(x0 + (rnd() - 0.5) * r * 0.2, 0, x0 + (rnd() - 0.5) * r * 0.12, r);
      ctx.stroke();
    }
    ctx.restore();
    // blush patches
    ctx.save();
    applePath(r);
    ctx.clip();
    blob(-r * 0.35, r * 0.28, r * 0.52, "255,210,63", 0.30);
    blob(r * 0.42, -r * 0.12, r * 0.44, "255,244,200", 0.20);
    ctx.restore();
    applePath(r);
    ctx.fillStyle = rimGrad(r);
    ctx.fill();
    // dimple shading under the stem
    ctx.fillStyle = "rgba(90,10,20,0.45)";
    ctx.beginPath(); ctx.ellipse(0, -r * 0.82, r * 0.2, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    gloss(-r * 0.34, -r * 0.38, r * 0.3, r * 0.18, -0.5, 0.75);
    specCore(-r * 0.37, -r * 0.41, r * 0.1, r * 0.06, -0.5);
    rimLight(r, "150,190,255", 0.30);
    drawStemLeaf(r, d);
  }

  // Slightly bumpy silhouette like a real orange peel
  function bumpyPath(r, seed, amp) {
    const rnd = mulberry32(seed);
    const n = 26, bumps = [];
    for (let i = 0; i < n; i++) bumps.push(1 + (rnd() - 0.5) * amp);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * bumps[i % n];
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function paintOrange(o, r, d) {
    bumpyPath(r, o.seed, 0.035);
    ctx.fillStyle = sphereGrad(r, "#ffc46b", "#ff8c1a", "#9c4a06");
    ctx.fill();
    ctx.save();
    bumpyPath(r, o.seed, 0.035);
    ctx.clip();
    speckles(o.seed, r, 80, "#b95a08", 0.45, 0.8, 2.4);
    speckles(o.seed + 13, r, 30, "#ffe1ad", 0.35, 0.8, 1.8);
    ctx.restore();
    bumpyPath(r, o.seed, 0.035);
    ctx.fillStyle = rimGrad(r);
    ctx.fill();
    gloss(-r * 0.3, -r * 0.36, r * 0.52, r * 0.3, -0.5, 0.4);
    rimLight(r, "150,190,255", 0.28);
    drawStemLeaf(r, d);
  }

  function lemonPath(r) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.98, -r * 0.1);
    ctx.quadraticCurveTo(-r * 1.14, -r * 0.06, -r * 1.14, 0);
    ctx.quadraticCurveTo(-r * 1.14, r * 0.06, -r * 0.98, r * 0.1);
    ctx.bezierCurveTo(-r * 0.7, r * 0.8, -r * 0.25, r * 0.72, 0, r * 0.72);
    ctx.bezierCurveTo(r * 0.25, r * 0.72, r * 0.7, r * 0.8, r * 0.98, r * 0.1);
    ctx.quadraticCurveTo(r * 1.14, r * 0.06, r * 1.14, 0);
    ctx.quadraticCurveTo(r * 1.14, -r * 0.06, r * 0.98, -r * 0.1);
    ctx.bezierCurveTo(r * 0.7, -r * 0.8, r * 0.25, -r * 0.72, 0, -r * 0.72);
    ctx.bezierCurveTo(-r * 0.25, -r * 0.72, -r * 0.7, -r * 0.8, -r * 0.98, -r * 0.1);
    ctx.closePath();
  }

  function paintLemon(o, r, d) {
    lemonPath(r);
    ctx.fillStyle = sphereGrad(r, "#fff3a0", "#ffd23f", "#a97e0a");
    ctx.fill();
    speckles(o.seed, r, 55, "#c99a16", 0.4, 0.8, 2.0);
    lemonPath(r);
    ctx.fillStyle = rimGrad(r);
    ctx.fill();
    gloss(-r * 0.32, -r * 0.34, r * 0.3, r * 0.17, -0.5, 0.7);
    specCore(-r * 0.35, -r * 0.37, r * 0.09, r * 0.055, -0.5);
    rimLight(r, "150,190,255", 0.28);
    drawStemLeaf(r, d);
  }

  function paintWatermelon(o, r, d) {
    ctx.fillStyle = sphereGrad(r, "#8fd694", "#2f9e44", "#0e3d1f");
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // wavy dark stripes, clipped to the fruit
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    const rnd = mulberry32(o.seed + 7);
    ctx.strokeStyle = "rgba(13,58,26,0.55)";
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * (0.1 + rnd() * 0.08);
      const x0 = i * r * 0.36 + (rnd() - 0.5) * r * 0.12;
      ctx.beginPath();
      ctx.moveTo(x0, -r);
      ctx.bezierCurveTo(x0 + r * 0.14, -r * 0.4, x0 - r * 0.14, r * 0.4, x0 + (rnd() - 0.5) * r * 0.1, r);
      ctx.stroke();
    }
    // pale field spot where it rested on the ground
    blob(r * 0.25, r * 0.62, r * 0.42, "235,205,90", 0.28);
    ctx.restore();
    ctx.fillStyle = rimGrad(r);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    gloss(-r * 0.34, -r * 0.4, r * 0.32, r * 0.18, -0.5, 0.7);
    specCore(-r * 0.37, -r * 0.43, r * 0.1, r * 0.06, -0.5);
    rimLight(r, "150,190,255", 0.30);
    drawStemLeaf(r, d);
  }

  function paintPlum(o, r, d) {
    ctx.fillStyle = sphereGrad(r, "#c58ad9", "#7d3c98", "#2c0f42");
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // dusty natural bloom
    blob(-r * 0.2, -r * 0.25, r * 0.7, "220,200,255", 0.16);
    // characteristic cleft
    ctx.strokeStyle = "rgba(20,5,30,0.45)";
    ctx.lineWidth = Math.max(1.5, r * 0.045);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.92);
    ctx.quadraticCurveTo(r * 0.34, 0, r * 0.08, r * 0.94);
    ctx.stroke();
    ctx.fillStyle = rimGrad(r);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    gloss(-r * 0.34, -r * 0.4, r * 0.26, r * 0.15, -0.5, 0.8);
    specCore(-r * 0.37, -r * 0.43, r * 0.09, r * 0.055, -0.5);
    rimLight(r, "170,190,255", 0.30);
    drawStemLeaf(r, d);
  }

  function paintKiwi(o, r, d) {
    ctx.fillStyle = sphereGrad(r, "#b08a5e", "#7a5c3e", "#3a2817");
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    speckles(o.seed, r, 60, "#4e3822", 0.5, 0.8, 2.2);
    // fuzzy skin: fine hairs around the rim
    const rnd = mulberry32(o.seed + 29);
    ctx.strokeStyle = "rgba(190,150,105,0.55)";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const len = r * 0.06 + rnd() * r * 0.07;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93);
      ctx.lineTo(Math.cos(a) * (r * 0.93 + len), Math.sin(a) * (r * 0.93 + len));
      ctx.stroke();
    }
    ctx.fillStyle = rimGrad(r);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    gloss(-r * 0.3, -r * 0.36, r * 0.4, r * 0.24, -0.5, 0.28);
    rimLight(r, "170,190,255", 0.25);
    // stem scar
    ctx.fillStyle = "rgba(40,25,12,0.7)";
    ctx.beginPath(); ctx.arc(0, -r * 0.86, r * 0.07, 0, Math.PI * 2); ctx.fill();
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
    const r = o.r;

    // Soft colored glow behind the fruit
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (d.name === "apple") paintApple(o, r, d);
    else if (d.name === "orange") paintOrange(o, r, d);
    else if (d.name === "lemon") paintLemon(o, r, d);
    else if (d.name === "watermelon") paintWatermelon(o, r, d);
    else if (d.name === "plum") paintPlum(o, r, d);
    else if (d.name === "kiwi") paintKiwi(o, r, d);

    ctx.restore();
  }

  // ---------- Sliced halves with juicy interiors ----------
  function spawnHalves(o) {
    for (const dir of [-1, 1]) {
      halves.push({
        x: o.x, y: o.y,
        vx: o.vx * 0.35 + rand(-170, 170) + dir * rand(40, 140),
        vy: o.vy * 0.3 - rand(80, 260),
        rot: o.rot, vr: rand(-8, 8) * dir,
        r: o.r, def: o.def, dir,
        seed: o.seed + (dir > 0 ? 101 : 202),
        life: 1.15, max: 1.15
      });
    }
    burst(o.x, o.y, o.def.inner, 10);
  }

  function drawHalf(h) {
    const r = h.r, d = h.def;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, h.life / h.max * 1.6));

    // clip to a semicircle
    ctx.beginPath();
    if (h.dir > 0) ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    else ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.clip();

    // peel
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // flesh
    const flesh = {
      apple: "#fff6e3", orange: "#ffcf8f", lemon: "#fff3a0",
      watermelon: "#ff5c6c", plum: "#ffcf7d", kiwi: "#d7e36b"
    }[d.name] || "#fff";
    ctx.fillStyle = flesh;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fill();

    // depth: richer color toward the center of the cut
    const dg = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 0.8);
    dg.addColorStop(0, "rgba(0,0,0,0.10)");
    dg.addColorStop(0.7, "rgba(0,0,0,0)");
    dg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fill();

    const rnd = mulberry32(h.seed);
    if (d.name === "orange" || d.name === "lemon") {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = r * 0.06;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = r * 0.035;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 0.76, Math.sin(a) * r * 0.76);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
    } else if (d.name === "watermelon") {
      ctx.strokeStyle = "#e8f5e9";
      ctx.lineWidth = r * 0.07;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#3e2723";
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2, dd = Math.sqrt(rnd()) * r * 0.55;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * dd, Math.sin(a) * dd, r * 0.045, r * 0.07, a, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.name === "apple") {
      ctx.fillStyle = "#8d5a2b";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25, r * 0.05, r * 0.08, a, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.name === "plum") {
      ctx.fillStyle = "#7a4a21";
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.22, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath(); ctx.ellipse(-r * 0.06, -r * 0.08, r * 0.08, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    } else if (d.name === "kiwi") {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3e2723";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.035, r * 0.02, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // juice droplets on the cut face
    const jrnd = mulberry32(h.seed + 5);
    for (let i = 0; i < 9; i++) {
      const a = jrnd() * Math.PI * 2, dd = Math.sqrt(jrnd()) * r * 0.62;
      ctx.fillStyle = "rgba(255,255,255," + (0.25 + jrnd() * 0.3).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(Math.cos(a) * dd, Math.sin(a) * dd, 1.5 + jrnd() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // juicy gloss on the cut face
    gloss(-r * 0.2, -r * 0.25, r * 0.4, r * 0.25, -0.4, 0.35);
    // soft shadow along the flat cut edge
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    if (h.dir > 0) ctx.fillRect(-r * 0.08, -r, r * 0.08, r * 2);
    else ctx.fillRect(0, -r, r * 0.08, r * 2);

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
        if (o.type === "fruit") spawnHalves(o);

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
    objects = []; particles = []; trails = []; halves = [];
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
    let isRecord = false;
    let serverBest = NaN;

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
      const game = params.get("game");

      if (!uid && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
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
        status = data.ok ? (isRecord ? "server-ok-record" : "server-ok") : ("server-fail:" + (data.error || res.status));
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
        const shownBest = Number.isFinite(serverBest) ? serverBest : best;
        const recordLine = isRecord ? `🎉 <b>رکورد جدید!</b><br>` : "";
        p.innerHTML = `Score: <b>${value}</b><br>Best: <b>${shownBest}</b><br>${recordLine}<br><small style="opacity:.65;font-size:11px;word-break:break-all">${status}</small>`;
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

    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i];
      h.vy += 1500 * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      h.life -= dt;
      if (h.life <= 0 || h.y > H + h.r * 2) { halves.splice(i, 1); continue; }
      drawHalf(h);
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
          
