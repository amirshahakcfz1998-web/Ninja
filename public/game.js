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

  const fruitDefs = [
    {name:"apple", color:"#ef4056", inner:"#ffb1ba", emoji:"🍎", points:10},
    {name:"orange", color:"#ff9e2c", inner:"#ffd59a", emoji:"🍊", points:12},
    {name:"lemon", color:"#ffd34d", inner:"#fff2a8", emoji:"🍋", points:14},
    {name:"watermelon", color:"#3dcf77", inner:"#ff6674", emoji:"🍉", points:16},
    {name:"plum", color:"#8e62d7", inner:"#d5b9ff", emoji:"🟣", points:18},
    {name:"kiwi", color:"#73b85b", inner:"#e9ffad", emoji:"🥝", points:20}
  ];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, innerWidth);
    H = Math.max(520, innerHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  addEventListener("resize", resize, {passive:true});
  resize();

  bestEl.textContent = best;

  function vibrate(ms=12) {
    try { tg?.HapticFeedback?.impactOccurred("light"); } catch {}
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function rand(a,b){ return a + Math.random()*(b-a); }

  function spawn() {
    const count = Math.random() < Math.min(.45, level*.035) ? 2 : 1;
    for(let i=0;i<count;i++){
      const bomb = Math.random() < Math.min(.13 + level*.006, .24);
      const r = rand(27, 42);
      const def = fruitDefs[Math.floor(Math.random()*fruitDefs.length)];
      objects.push({
        type: bomb ? "bomb" : "fruit",
        def,
        x: rand(r+8,W-r-8),
        y: H + r + rand(0,35),
        r,
        vx: rand(-100,100) * (0.7 + level*.025),
        vy: -rand(850,1050) * (0.88 + level*.035),
        gravity: 1500 + level*35,
        rot: rand(0,Math.PI*2),
        vr: rand(-5,5),
        sliced:false,
        born:performance.now()
      });
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,"#172642"); g.addColorStop(.55,"#101b30"); g.addColorStop(1,"#080d18");
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

    // subtle dojo-like grid
    ctx.save();
    ctx.globalAlpha=.07;
    ctx.strokeStyle="#fff";
    ctx.lineWidth=1;
    const gap=44;
    for(let x=0;x<W;x+=gap){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
    for(let y=0;y<H;y+=gap){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
    ctx.restore();

    const rg=ctx.createRadialGradient(W/2,H*.5,10,W/2,H*.5,Math.max(W,H)*.55);
    rg.addColorStop(0,"rgba(55,116,165,.10)");
    rg.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=rg;ctx.fillRect(0,0,W,H);
  }

  function drawFruit(o) {
    ctx.save();
    ctx.translate(o.x,o.y);
    ctx.rotate(o.rot);

    if(o.type==="bomb"){
      ctx.shadowColor="rgba(255,75,75,.25)";ctx.shadowBlur=20;
      ctx.fillStyle="#171a22";ctx.beginPath();ctx.arc(0,0,o.r,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;
      ctx.fillStyle="#3b414d";ctx.beginPath();ctx.arc(-o.r*.25,-o.r*.25,o.r*.65,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#ffb347";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(o.r*.35,-o.r*.72);ctx.quadraticCurveTo(o.r*.85,-o.r*1.15,o.r*1.05,-o.r*.75);ctx.stroke();
      ctx.fillStyle="#ff5c5c";ctx.beginPath();ctx.arc(o.r*.78,-o.r*.78,5,0,Math.PI*2);ctx.fill();
      ctx.restore();return;
    }

    const d=o.def;
    ctx.shadowColor=d.color;ctx.shadowBlur=18;
    ctx.fillStyle=d.color;
    ctx.beginPath();ctx.arc(0,0,o.r,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle=d.inner;
    ctx.globalAlpha=.9;
    ctx.beginPath();ctx.arc(-o.r*.22,-o.r*.22,o.r*.56,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle="rgba(255,255,255,.55)";
    ctx.beginPath();ctx.arc(-o.r*.36,-o.r*.42,o.r*.16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#5b3a21";
    ctx.fillRect(-2,-o.r*.95,4,9);
    ctx.restore();
  }

  function drawTrail() {
    ctx.save();
    for(let i=0;i<trails.length;i++){
      const p=trails[i];
      ctx.globalAlpha=(i/trails.length)*.65;
      ctx.strokeStyle="#fff";
      ctx.lineWidth=2+i/trails.length*5;
      ctx.lineCap="round";
      ctx.beginPath();ctx.moveTo(p.x1,p.y1);ctx.lineTo(p.x2,p.y2);ctx.stroke();
    }
    ctx.restore();
  }

  function sliceAt(x,y) {
    let hit=false;
    for(const o of objects){
      if(o.sliced) continue;
      const dx=x-o.x,dy=y-o.y;
      if(dx*dx+dy*dy <= (o.r+18)*(o.r+18)){
        o.sliced=true;
        hit=true;
        if(o.type==="bomb"){
          lives--;
          combo=0;
          vibrate(45);
          burst(o.x,o.y,"#ff5757",24);
          updateLives();
          if(lives<=0) endGame();
        } else {
          combo++;
          const multiplier=Math.min(1+Math.floor(combo/5),5);
          score += o.def.points * multiplier;
          burst(o.x,o.y,o.def.color,18);
          vibrate(8);
          if(combo>=5) burst(o.x,o.y,"#ffd166",8);
          updateHud();
        }
      }
    }
    return hit;
  }

  function burst(x,y,color,n) {
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2, s=rand(90,420);
      particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.3,.65),max:.65,color,size:rand(2,6)});
    }
  }

  function updateLives(){
    livesEl.innerHTML = [0,1,2].map(i=>`<span style="opacity:${i<lives?1:.18}">❤</span>`).join("");
  }

  function updateHud(){
    scoreEl.textContent=score;
    comboEl.textContent="x"+combo;
  }

  function startGame(){
    score=0;lives=3;combo=0;level=1;objects=[];particles=[];trails=[];
    gameStart=performance.now();running=true;paused=false;last=performance.now();spawnTimer=0;
    message.classList.add("hidden");pause.classList.add("hidden");pauseButton.textContent="Ⅱ";
    updateLives();updateHud();
    requestAnimationFrame(loop);
  }

  function endGame(){
    running=false;
    if(score>best){
      best=score;localStorage.setItem("ninjaFruitBest",best);
      bestEl.textContent=best;
    }
    messageText.innerHTML=`Score: <b>${score}</b><br>Best: <b>${best}</b>`;
    startButton.textContent="PLAY AGAIN";
    message.classList.remove("hidden");
    submitScore(score);
  }

  async function submitScore(value){
    // 1. Try official TelegramGameProxy (opens share sheet)
    try{
      if(window.TelegramGameProxy?.shareScore){
        window.TelegramGameProxy.shareScore(value);
      } else if(window.TelegramGameProxy?.setScore){
        window.TelegramGameProxy.setScore(value);
      }
    }catch{}

    // 2. Also send to our Worker for group leaderboard (Top Players)
    try {
      const params = new URLSearchParams(window.location.search);
      const uid = params.get("uid");
      const cid = params.get("cid");
      const mid = params.get("mid");
      const imid = params.get("imid");

      if (uid && (cid && mid || imid)) {
        const body = {
          score: value,
          uid: Number(uid),
          cid: cid || undefined,
          mid: mid || undefined,
          imid: imid || undefined
        };
        await fetch("/api/submit-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
      }
    } catch {}
  }

  function setPointer(e){
    const rect=canvas.getBoundingClientRect();
    return {x:e.clientX-rect.left,y:e.clientY-rect.top};
  }

  function pointerStart(e){
    pointerDown=true;lastPointer=setPointer(e);
    try{canvas.setPointerCapture(e.pointerId)}catch{}
  }
  function pointerMove(e){
    if(!pointerDown||!running||paused)return;
    const p=setPointer(e);
    const a=lastPointer||p;
    const dx=p.x-a.x,dy=p.y-a.y;
    if(dx*dx+dy*dy>9){
      trails.push({x1:a.x,y1:a.y,x2:p.x,y2:p.y,life:.12});
      sliceAt(p.x,p.y);
      lastPointer=p;
    }
  }
  function pointerEnd(){pointerDown=false;lastPointer=null;}

  canvas.addEventListener("pointerdown",pointerStart);
  canvas.addEventListener("pointermove",pointerMove);
  canvas.addEventListener("pointerup",pointerEnd);
  canvas.addEventListener("pointercancel",pointerEnd);
  canvas.addEventListener("pointerleave",pointerEnd);

  pauseButton.addEventListener("click",()=>{
    if(!running)return;
    paused=!paused;
    pause.classList.toggle("hidden",!paused);
    pauseButton.textContent=paused?"▶":"Ⅱ";
    if(!paused){last=performance.now();requestAnimationFrame(loop)}
  });
  resumeButton.addEventListener("click",()=>{
    paused=false;pause.classList.add("hidden");pauseButton.textContent="Ⅱ";last=performance.now();requestAnimationFrame(loop);
  });
  startButton.addEventListener("click",startGame);

  function loop(now){
    if(!running||paused)return;
    let dt=Math.min(.032,(now-last)/1000||0);last=now;
    const elapsed=(now-gameStart)/1000;
    level=1+Math.floor(elapsed/20);
    spawnTimer-=dt;
    const spawnEvery=Math.max(.27,.72-level*.028);
    if(spawnTimer<=0){spawn();spawnTimer=spawnEvery*Math.max(.45,1-Math.min(.35,combo*.008))}

    drawBackground();

    for(let i=objects.length-1;i>=0;i--){
      const o=objects[i];
      o.vy += o.gravity*dt;
      o.x += o.vx*dt;
      o.y += o.vy*dt;
      o.rot += o.vr*dt;

      if(o.x<o.r){o.x=o.r;o.vx=Math.abs(o.vx)}
      if(o.x>W-o.r){o.x=W-o.r;o.vx=-Math.abs(o.vx)}

      if(!o.sliced) drawFruit(o);
      if(o.sliced) objects.splice(i,1);
      else if(o.y>H+o.r*2){
        if(o.type==="fruit"){
          combo=0;updateHud();
        }
        objects.splice(i,1);
      }
    }

    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=700*dt;
      if(p.life<=0){particles.splice(i,1);continue}
      ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;
      ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    }

    for(let i=trails.length-1;i>=0;i--){trails[i].life-=dt;if(trails[i].life<=0)trails.splice(i,1)}
    drawTrail();

    ctx.fillStyle="rgba(255,255,255,.55)";
    ctx.font="700 12px system-ui";
    ctx.textAlign="center";
    ctx.fillText("LV "+level,W/2,H-18);

    requestAnimationFrame(loop);
  }

  // Initial screen
  updateLives();
  updateHud();
  message.classList.remove("hidden");
})();
    
