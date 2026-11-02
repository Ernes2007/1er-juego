(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = {
    wave: document.getElementById("wave"),
    score: document.getElementById("score"),
    health: document.getElementById("health-value"),
    healthBar: document.getElementById("health-bar"),
    ammo: document.getElementById("ammo-value"),
    status: document.getElementById("status"),
    overlay: document.getElementById("overlay"),
    title: document.getElementById("overlay-title"),
    copy: document.getElementById("overlay-copy"),
    start: document.getElementById("start"),
    pause: document.getElementById("pause"),
    fire: document.getElementById("fire"),
    reload: document.getElementById("reload"),
    moveZone: document.getElementById("move-zone"),
    knob: document.querySelector(".stick-knob"),
    lookHint: document.getElementById("look-hint")
  };

  const arena = 15;
  const obstacles = [
    { x: -7, z: -5, w: 2.3, d: 2.3, h: 2.5 },
    { x: 6, z: -6, w: 3.2, d: 1.8, h: 2.1 },
    { x: -6, z: 5, w: 3.4, d: 1.7, h: 1.8 },
    { x: 6.5, z: 5.2, w: 2.2, d: 2.6, h: 2.5 },
    { x: 0, z: -8.5, w: 2.2, d: 1.5, h: 1.6 },
    { x: 0, z: 7.8, w: 2.8, d: 1.5, h: 1.7 }
  ];

  const game = {
    running: false, paused: false, over: false, last: 0, elapsed: 0,
    width: 0, height: 0, dpr: 1, cameraYaw: 0,
    player: { x: 0, z: 2, y: 0, yaw: 0, health: 100, ammo: 12, reload: 0, cooldown: 0, hitFlash: 0 },
    enemies: [], particles: [], wave: 0, score: 0, waveWait: 0,
    move: { x: 0, y: 0 }, keys: new Set(), firing: false, pointerLook: null,
    joystickPointer: null, audio: null
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    game.width = window.innerWidth;
    game.height = window.innerHeight;
    game.dpr = dpr;
    canvas.width = Math.round(game.width * dpr);
    canvas.height = Math.round(game.height * dpr);
    canvas.style.width = `${game.width}px`;
    canvas.style.height = `${game.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  function angleTo(a, b) { return Math.atan2(b.x - a.x, b.z - a.z); }

  function playTone(frequency, duration, volume, type = "square") {
    try {
      if (!game.audio) game.audio = new (window.AudioContext || window.webkitAudioContext)();
      if (game.audio.state === "suspended") game.audio.resume();
      const oscillator = game.audio.createOscillator();
      const gain = game.audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, game.audio.currentTime);
      gain.gain.setValueAtTime(volume, game.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, game.audio.currentTime + duration);
      oscillator.connect(gain).connect(game.audio.destination);
      oscillator.start();
      oscillator.stop(game.audio.currentTime + duration);
    } catch (error) {
      console.warn("No se pudo iniciar el audio del juego.", error);
    }
  }

  function startGame() {
    game.player = { x: 0, z: 2, y: 0, yaw: 0, health: 100, ammo: 12, reload: 0, cooldown: 0, hitFlash: 0 };
    game.enemies = [];
    game.particles = [];
    game.score = 0;
    game.wave = 0;
    game.waveWait = 0;
    game.elapsed = 0;
    game.cameraYaw = 0;
    game.running = true;
    game.paused = false;
    game.over = false;
    ui.overlay.classList.add("hidden");
    ui.pause.textContent = "Ⅱ";
    nextWave();
    updateHud();
  }

  function nextWave() {
    game.wave += 1;
    const amount = Math.min(3 + game.wave * 2, 18);
    for (let i = 0; i < amount; i++) {
      let x = 0, z = 0, attempts = 0;
      do {
        const angle = Math.random() * Math.PI * 2;
        const radius = rand(9.5, 13);
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        attempts += 1;
      } while (attempts < 20 && (distance({ x, z }, game.player) < 7 || insideObstacle(x, z, .6)));
      game.enemies.push({
        x, z, health: 2 + Math.floor((game.wave - 1) / 3), speed: rand(1.05, 1.55) + Math.min(game.wave * .035, .4),
        attack: rand(.4, 1.3), hit: 0, seed: Math.random() * 10
      });
    }
    ui.wave.textContent = String(game.wave);
    ui.status.textContent = `OLEADA ${game.wave} · ${amount} ENEMIGOS`;
    window.setTimeout(() => {
      if (game.running && !game.paused) ui.status.textContent = "ELIMINA A LOS ENEMIGOS";
    }, 1700);
  }

  function insideObstacle(x, z, padding = 0) {
    return obstacles.some(o => Math.abs(x - o.x) < o.w / 2 + padding && Math.abs(z - o.z) < o.d / 2 + padding);
  }

  function resolveCollision(entity, radius) {
    entity.x = clamp(entity.x, -arena + radius, arena - radius);
    entity.z = clamp(entity.z, -arena + radius, arena - radius);
    for (const o of obstacles) {
      const minX = o.x - o.w / 2 - radius;
      const maxX = o.x + o.w / 2 + radius;
      const minZ = o.z - o.d / 2 - radius;
      const maxZ = o.z + o.d / 2 + radius;
      if (entity.x > minX && entity.x < maxX && entity.z > minZ && entity.z < maxZ) {
        const dx = Math.min(entity.x - minX, maxX - entity.x);
        const dz = Math.min(entity.z - minZ, maxZ - entity.z);
        if (dx < dz) entity.x = entity.x - minX < maxX - entity.x ? minX : maxX;
        else entity.z = entity.z - minZ < maxZ - entity.z ? minZ : maxZ;
      }
    }
  }

  function update(dt) {
    if (!game.running || game.paused) return;
    game.elapsed += dt;
    const p = game.player;
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (p.reload > 0) {
      p.reload -= dt;
      if (p.reload <= 0) { p.ammo = 12; ui.status.textContent = "CARGADOR LISTO"; }
    }

    let mx = game.move.x, my = game.move.y;
    if (game.keys.has("w") || game.keys.has("arrowup")) my -= 1;
    if (game.keys.has("s") || game.keys.has("arrowdown")) my += 1;
    if (game.keys.has("a") || game.keys.has("arrowleft")) mx -= 1;
    if (game.keys.has("d") || game.keys.has("arrowright")) mx += 1;
    const magnitude = Math.hypot(mx, my);
    if (magnitude > 1) { mx /= magnitude; my /= magnitude; }
    const sin = Math.sin(game.cameraYaw), cos = Math.cos(game.cameraYaw);
    const moveX = mx * cos - my * sin;
    const moveZ = -mx * sin - my * cos;
    const speed = game.keys.has("shift") ? 6.2 : 4.5;
    if (Math.hypot(moveX, moveZ) > .05) {
      p.x += moveX * speed * dt;
      p.z += moveZ * speed * dt;
      p.yaw = Math.atan2(moveX, moveZ);
      resolveCollision(p, .42);
    } else if (game.firing) {
      p.yaw += angleDiff(game.cameraYaw, p.yaw) * Math.min(1, dt * 8);
    }
    p.y = Math.sin(game.elapsed * 11) * .045 * Math.min(1, magnitude);

    if (game.firing && p.cooldown <= 0 && p.reload <= 0) shoot();

    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const enemy = game.enemies[i];
      enemy.hit = Math.max(0, enemy.hit - dt);
      const dist = distance(enemy, p);
      const toward = angleTo(enemy, p);
      if (dist > 2.25) {
        enemy.x += Math.sin(toward) * enemy.speed * dt;
        enemy.z += Math.cos(toward) * enemy.speed * dt;
        resolveCollision(enemy, .45);
      } else {
        enemy.attack -= dt;
        if (enemy.attack <= 0) {
          enemy.attack = rand(1, 1.5);
          p.health = Math.max(0, p.health - (4 + Math.floor(game.wave / 4)));
          p.hitFlash = .2;
          playTone(105, .11, .035, "sawtooth");
          updateHud();
          if (p.health <= 0) endGame();
        }
      }
    }

    for (let i = game.particles.length - 1; i >= 0; i--) {
      const particle = game.particles[i];
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      particle.vy -= 3 * dt;
      if (particle.life <= 0) game.particles.splice(i, 1);
    }

    if (!game.enemies.length) {
      game.waveWait += dt;
      ui.status.textContent = "ZONA DESPEJADA";
      if (game.waveWait > 2.2) { game.waveWait = 0; nextWave(); }
    }
  }

  function shoot() {
    const p = game.player;
    p.cooldown = .24;
    if (p.ammo <= 0) {
      p.reload = 1.15;
      ui.status.textContent = "RECARGANDO...";
      playTone(170, .08, .025, "triangle");
      updateHud();
      return;
    }
    p.ammo -= 1;
    playTone(105, .065, .04);
    const origin = { x: p.x, z: p.z };
    const dx = Math.sin(game.cameraYaw), dz = Math.cos(game.cameraYaw);
    let target = null, best = Infinity;
    for (const enemy of game.enemies) {
      const ex = enemy.x - origin.x, ez = enemy.z - origin.z;
      const along = ex * dx + ez * dz;
      const side = Math.abs(ex * dz - ez * dx);
      if (along > .7 && along < 22 && side < .68 && along < best && !lineBlocked(origin.x, origin.z, enemy.x, enemy.z)) {
        best = along;
        target = enemy;
      }
    }
    const endX = target ? target.x : p.x + dx * 22;
    const endZ = target ? target.z : p.z + dz * 22;
    addTracer(p.x + dx * .8, p.z + dz * .8, endX, endZ);
    if (target) {
      target.health -= 1;
      target.hit = .12;
      playTone(410, .045, .025, "sine");
      if (target.health <= 0) {
        const index = game.enemies.indexOf(target);
        if (index >= 0) game.enemies.splice(index, 1);
        game.score += 1;
        for (let n = 0; n < 7; n++) {
          game.particles.push({ x: target.x, y: rand(.5, 1.7), z: target.z, vx: rand(-2, 2), vy: rand(.5, 3), vz: rand(-2, 2), life: rand(.25, .6), color: "#ff745b" });
        }
        ui.status.textContent = "OBJETIVO ELIMINADO";
      }
    }
    updateHud();
  }

  function lineBlocked(x1, z1, x2, z2) {
    const steps = 18;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (insideObstacle(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, 0)) return true;
    }
    return false;
  }

  function addTracer(x1, z1, x2, z2) {
    game.particles.push({ x: x1, y: 1.35, z: z1, ex: x2, ey: 1, ez: z2, life: .09, maxLife: .09, tracer: true });
  }

  function updateHud() {
    const health = game.player.health;
    ui.health.textContent = String(health);
    ui.healthBar.style.width = `${health}%`;
    ui.healthBar.style.background = health < 30 ? "#f05d51" : "linear-gradient(90deg, #5ce1c4, #a4e86d)";
    ui.ammo.textContent = game.player.reload > 0 ? "…" : String(game.player.ammo);
    ui.score.textContent = String(game.score);
  }

  function endGame() {
    game.running = false;
    game.over = true;
    game.firing = false;
    ui.title.innerHTML = "MISIÓN<br><span>TERMINADA</span>";
    ui.copy.textContent = `Has eliminado ${game.score} ${game.score === 1 ? "enemigo" : "enemigos"} y alcanzado la oleada ${game.wave}.`;
    ui.start.innerHTML = "INTENTAR DE NUEVO <span>→</span>";
    ui.overlay.classList.remove("hidden");
  }

  function togglePause() {
    if (!game.running && !game.paused) return;
    game.paused = !game.paused;
    if (game.paused) {
      ui.title.innerHTML = "PAUSA<br><span>OPERATIVA</span>";
      ui.copy.textContent = "Tómate un respiro. La arena espera.";
      ui.start.innerHTML = "VOLVER AL JUEGO <span>→</span>";
      ui.overlay.classList.remove("hidden");
      ui.pause.textContent = "▶";
    } else {
      ui.overlay.classList.add("hidden");
      ui.pause.textContent = "Ⅱ";
    }
  }

  function project(x, y, z) {
    const p = game.player;
    const forwardX = Math.sin(game.cameraYaw), forwardZ = Math.cos(game.cameraYaw);
    const camX = p.x - forwardX * 6.8, camY = 3.8, camZ = p.z - forwardZ * 6.8;
    const targetX = p.x + forwardX * 1.6, targetY = 1.25, targetZ = p.z + forwardZ * 1.6;
    let fx = targetX - camX, fy = targetY - camY, fz = targetZ - camZ;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, rz = -fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
    const vx = x - camX, vy = y - camY, vz = z - camZ;
    const depth = vx * fx + vy * fy + vz * fz;
    const focal = game.height * .93;
    const scale = focal / Math.max(.15, depth);
    return { x: game.width / 2 + (vx * rx + vz * rz) * scale, y: game.height * .47 - (vx * ux + vy * uy + vz * uz) * scale, depth, scale };
  }

  function draw() {
    const w = game.width, h = game.height;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#526b70");
    sky.addColorStop(.42, "#9aa6a0");
    sky.addColorStop(.64, "#626f69");
    sky.addColorStop(1, "#1b2829");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    drawDistantSkyline();
    drawGround();
    drawArena();

    const things = [];
    for (const obstacle of obstacles) things.push({ depth: project(obstacle.x, 0, obstacle.z).depth, type: "obstacle", object: obstacle });
    for (const enemy of game.enemies) things.push({ depth: project(enemy.x, 0, enemy.z).depth, type: "enemy", object: enemy });
    things.push({ depth: project(game.player.x, 0, game.player.z).depth, type: "player", object: game.player });
    things.sort((a, b) => b.depth - a.depth);
    for (const thing of things) {
      if (thing.type === "obstacle") drawObstacle(thing.object);
      else if (thing.type === "enemy") drawFighter(thing.object, false);
      else drawFighter(thing.object, true);
    }
    drawParticles();
    drawVignette();
  }

  function drawDistantSkyline() {
    const horizon = game.height * .48;
    ctx.fillStyle = "rgba(31,43,43,.34)";
    ctx.beginPath();
    ctx.moveTo(0, horizon + 16);
    for (let x = 0; x <= game.width + 30; x += 30) {
      const height = 16 + (Math.sin(x * .027) + 1) * 10 + Math.abs(Math.sin(x * .009)) * 28;
      ctx.lineTo(x, horizon + 15 - height);
      ctx.lineTo(x + 13, horizon + 15 - height);
      ctx.lineTo(x + 13, horizon + 17);
    }
    ctx.lineTo(game.width, horizon + 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(238,203,142,.34)";
    ctx.beginPath();
    ctx.arc(game.width * .76, game.height * .19, Math.min(game.width, game.height) * .055, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGround() {
    const ground = ctx.createLinearGradient(0, game.height * .46, 0, game.height);
    ground.addColorStop(0, "#586357");
    ground.addColorStop(1, "#253231");
    ctx.fillStyle = ground;
    ctx.fillRect(0, game.height * .45, game.width, game.height * .55);

    ctx.lineWidth = 1;
    for (let n = -arena; n <= arena; n += 2) {
      drawWorldLine(n, 0, -arena, n, 0, arena, n % 4 === 0 ? "rgba(195,204,173,.14)" : "rgba(195,204,173,.075)");
      drawWorldLine(-arena, 0, n, arena, 0, n, n % 4 === 0 ? "rgba(195,204,173,.14)" : "rgba(195,204,173,.075)");
    }
  }

  function drawWorldLine(x1, y1, z1, x2, y2, z2, color) {
    let a = project(x1, y1, z1), b = project(x2, y2, z2);
    if (a.depth < .3 && b.depth < .3) return;
    if (a.depth < .3 || b.depth < .3) {
      const t = (.3 - a.depth) / (b.depth - a.depth);
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const z = z1 + (z2 - z1) * t;
      if (a.depth < .3) a = project(x, y, z);
      else b = project(x, y, z);
    }
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  function drawArena() {
    for (const side of [-1, 1]) {
      drawWorldLine(-arena, 0, side * arena, arena, 0, side * arena, "rgba(205,211,182,.42)");
      drawWorldLine(side * arena, 0, -arena, side * arena, 0, arena, "rgba(205,211,182,.42)");
    }
    for (const o of obstacles) {
      drawWorldLine(o.x - o.w / 2, .03, o.z - o.d / 2, o.x + o.w / 2, .03, o.z - o.d / 2, "rgba(220,208,161,.3)");
    }
  }

  function polygon(points, fill, stroke) {
    ctx.beginPath();
    points.forEach((point, i) => { if (!i) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function drawObstacle(o) {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    const p = (x, y, z) => project(x, y, z);
    const b00 = p(x0, 0, z0), b10 = p(x1, 0, z0), b11 = p(x1, 0, z1), b01 = p(x0, 0, z1);
    const t00 = p(x0, o.h, z0), t10 = p(x1, o.h, z0), t11 = p(x1, o.h, z1), t01 = p(x0, o.h, z1);
    const shadow = p(o.x, .015, o.z);
    const sh = Math.max(4, Math.min(45, shadow.scale * (o.w + o.d) * .24));
    ctx.fillStyle = "rgba(10,17,16,.22)";
    ctx.beginPath(); ctx.ellipse(shadow.x + sh * .35, shadow.y + sh * .15, sh, sh * .34, -.12, 0, Math.PI * 2); ctx.fill();
    polygon([b00, b01, t01, t00], "#4c5956", "#273432");
    polygon([b01, b11, t11, t01], "#68736a", "#303c39");
    polygon([b10, b11, t11, t10], "#3e4b49", "#273432");
    polygon([t00, t01, t11, t10], "#879082", "#3b4741");
    ctx.strokeStyle = "rgba(221,220,184,.25)";
    ctx.beginPath(); ctx.moveTo(t00.x, t00.y); ctx.lineTo(t10.x, t10.y); ctx.stroke();
  }

  function drawFighter(entity, isPlayer) {
    const bob = isPlayer ? entity.y : Math.sin(game.elapsed * 7 + entity.seed) * .035;
    const base = project(entity.x, 0, entity.z);
    if (base.depth < .25) return;
    const head = project(entity.x, 1.64 + bob, entity.z);
    const chest = project(entity.x, 1.14 + bob, entity.z);
    const hip = project(entity.x, .67 + bob, entity.z);
    const foot = project(entity.x, .08, entity.z);
    const unit = Math.max(1, head.scale);
    const width = Math.max(2, 0.3 * unit);
    const facing = isPlayer ? entity.yaw : angleTo(entity, game.player);
    const fx = Math.sin(facing), fz = Math.cos(facing);
    const sx = Math.cos(facing), sz = -Math.sin(facing);
    const accent = isPlayer ? "#64dbc9" : (entity.hit > 0 ? "#fff3c1" : "#df6955");
    const dark = isPlayer ? "#203e3e" : "#432f30";

    const shadowRadius = Math.max(4, Math.min(35, unit * .35));
    ctx.fillStyle = "rgba(8,13,12,.42)";
    ctx.beginPath(); ctx.ellipse(base.x, base.y, shadowRadius, shadowRadius * .32, 0, 0, Math.PI * 2); ctx.fill();

    const leftHip = project(entity.x + sx * .13, .7 + bob, entity.z + sz * .13);
    const rightHip = project(entity.x - sx * .13, .7 + bob, entity.z - sz * .13);
    const leftFoot = project(entity.x + sx * .2 - fx * .04, .08, entity.z + sz * .2 - fz * .04);
    const rightFoot = project(entity.x - sx * .2 - fx * .04, .08, entity.z - sz * .2 - fz * .04);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, unit * .12);
    ctx.strokeStyle = isPlayer ? "#1e3434" : "#392f30";
    ctx.beginPath(); ctx.moveTo(leftHip.x, leftHip.y); ctx.lineTo(leftFoot.x, leftFoot.y); ctx.moveTo(rightHip.x, rightHip.y); ctx.lineTo(rightFoot.x, rightFoot.y); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, unit * .06);
    ctx.strokeStyle = isPlayer ? "#c0a986" : "#aa8a72";
    ctx.beginPath(); ctx.moveTo(leftFoot.x, leftFoot.y); ctx.lineTo(leftFoot.x + fx * unit * .08, leftFoot.y); ctx.moveTo(rightFoot.x, rightFoot.y); ctx.lineTo(rightFoot.x + fx * unit * .08, rightFoot.y); ctx.stroke();

    ctx.lineWidth = width;
    ctx.strokeStyle = dark;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();
    ctx.lineWidth = Math.max(2, unit * .2);
    ctx.strokeStyle = accent;
    ctx.beginPath(); ctx.moveTo(chest.x, chest.y + unit * .025); ctx.lineTo(hip.x, hip.y - unit * .01); ctx.stroke();

    const shoulderL = project(entity.x + sx * .24, 1.28 + bob, entity.z + sz * .24);
    const shoulderR = project(entity.x - sx * .24, 1.28 + bob, entity.z - sz * .24);
    const handL = project(entity.x + fx * .27 + sx * .13, 1.02 + bob, entity.z + fz * .27 + sz * .13);
    const handR = project(entity.x + fx * .43 - sx * .1, 1.08 + bob, entity.z + fz * .43 - sz * .1);
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(2, unit * .09);
    ctx.beginPath(); ctx.moveTo(shoulderL.x, shoulderL.y); ctx.lineTo(handL.x, handL.y); ctx.moveTo(shoulderR.x, shoulderR.y); ctx.lineTo(handR.x, handR.y); ctx.stroke();

    const headRadius = Math.max(2.4, unit * .115);
    ctx.fillStyle = isPlayer ? "#cbad8b" : "#b68c75";
    ctx.beginPath(); ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(head.x, head.y - headRadius * .36, headRadius * .96, Math.PI, Math.PI * 2); ctx.fill();

    const gunStart = project(entity.x + fx * .31 + sx * .06, 1.05 + bob, entity.z + fz * .31 + sz * .06);
    const gunEnd = project(entity.x + fx * .85 + sx * .06, 1.08 + bob, entity.z + fz * .85 + sz * .06);
    ctx.strokeStyle = "#182323";
    ctx.lineWidth = Math.max(2, unit * .055);
    ctx.beginPath(); ctx.moveTo(gunStart.x, gunStart.y); ctx.lineTo(gunEnd.x, gunEnd.y); ctx.stroke();

    if (!isPlayer) {
      const barW = Math.max(13, unit * .45);
      ctx.fillStyle = "rgba(8,13,13,.65)";
      ctx.fillRect(head.x - barW / 2, head.y - headRadius * 2.1, barW, 2.5);
      ctx.fillStyle = "#ff8067";
      ctx.fillRect(head.x - barW / 2, head.y - headRadius * 2.1, barW * (entity.health / (2 + Math.floor((game.wave - 1) / 3))), 2.5);
    }
  }

  function drawParticles() {
    for (const particle of game.particles) {
      if (particle.tracer) {
        const a = project(particle.x, particle.y, particle.z);
        const b = project(particle.ex, particle.ey, particle.ez);
        ctx.strokeStyle = `rgba(255,223,135,${particle.life / particle.maxLife})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else {
        const point = project(particle.x, particle.y, particle.z);
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = clamp(particle.life * 2, 0, 1);
        ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1.5, point.scale * .055), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawVignette() {
    const gradient = ctx.createRadialGradient(game.width / 2, game.height * .47, game.height * .15, game.width / 2, game.height * .47, game.height * .77);
    gradient.addColorStop(0, "rgba(5,12,13,0)");
    gradient.addColorStop(1, "rgba(5,12,13,.45)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, game.width, game.height);
    if (game.player.hitFlash > 0) {
      ctx.fillStyle = `rgba(227,61,44,${game.player.hitFlash * .8})`;
      ctx.fillRect(0, 0, game.width, game.height);
    }
  }

  function frame(time) {
    const dt = Math.min(.04, (time - (game.last || time)) / 1000);
    game.last = time;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function setStick(event) {
    const rect = ui.moveZone.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const max = 37;
    const length = Math.min(max, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const x = Math.cos(angle) * length, y = Math.sin(angle) * length;
    ui.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    game.move.x = x / max;
    game.move.y = y / max;
  }

  ui.moveZone.addEventListener("pointerdown", event => {
    event.preventDefault();
    game.joystickPointer = event.pointerId;
    ui.moveZone.setPointerCapture(event.pointerId);
    setStick(event);
  });
  ui.moveZone.addEventListener("pointermove", event => {
    if (event.pointerId === game.joystickPointer) setStick(event);
  });
  function releaseStick(event) {
    if (event.pointerId !== game.joystickPointer) return;
    game.joystickPointer = null;
    game.move.x = 0;
    game.move.y = 0;
    ui.knob.style.transform = "translate(-50%,-50%)";
  }
  ui.moveZone.addEventListener("pointerup", releaseStick);
  ui.moveZone.addEventListener("pointercancel", releaseStick);

  ui.fire.addEventListener("pointerdown", event => { event.preventDefault(); game.firing = true; ui.fire.setPointerCapture(event.pointerId); });
  ui.fire.addEventListener("pointerup", () => { game.firing = false; });
  ui.fire.addEventListener("pointercancel", () => { game.firing = false; });
  ui.reload.addEventListener("pointerdown", event => { event.preventDefault(); reload(); });

  function reload() {
    if (!game.running || game.player.reload > 0 || game.player.ammo === 12) return;
    game.player.reload = 1.15;
    ui.status.textContent = "RECARGANDO...";
    updateHud();
  }

  canvas.addEventListener("pointerdown", event => {
    game.pointerLook = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (event.pointerType === "mouse") canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!game.pointerLook || event.pointerId !== game.pointerLook.id) return;
    const delta = event.clientX - game.pointerLook.x;
    game.cameraYaw += delta * .006;
    game.pointerLook.x = event.clientX;
    game.pointerLook.y = event.clientY;
    ui.lookHint.style.opacity = "0";
  });
  function endLook(event) {
    if (game.pointerLook && event.pointerId === game.pointerLook.id) game.pointerLook = null;
  }
  canvas.addEventListener("pointerup", endLook);
  canvas.addEventListener("pointercancel", endLook);
  canvas.addEventListener("contextmenu", event => event.preventDefault());

  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    game.keys.add(key);
    if (key === " " || key === "enter") game.firing = true;
    if (key === "r") reload();
    if (key === "escape") togglePause();
  });
  window.addEventListener("keyup", event => {
    game.keys.delete(event.key.toLowerCase());
    if (event.key === " ") game.firing = false;
  });
  window.addEventListener("blur", () => { game.keys.clear(); game.firing = false; });
  ui.start.addEventListener("click", () => {
    if (game.paused) {
      game.paused = false;
      ui.overlay.classList.add("hidden");
      ui.pause.textContent = "Ⅱ";
    } else startGame();
  });
  ui.pause.addEventListener("click", togglePause);
})();