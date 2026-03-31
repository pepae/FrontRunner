// FRONTRUNNER — Tactical Projectile System

(function () {
  'use strict';

  // ── Colors ────────────────────────────────────────────────────────────────────
  const COLORS = {
    RED:    { hex: '#ff2244', name: 'RED',    cost: 10 },
    BLUE:   { hex: '#2277ff', name: 'BLUE',   cost: 10 },
    GREEN:  { hex: '#22ee77', name: 'GREEN',  cost: 10 },
    YELLOW: { hex: '#ffcc00', name: 'YELLOW', cost: 15 },
  };
  const COLOR_KEYS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

  // RPS: key beats value
  const RPS_BEATS = { RED: 'BLUE', BLUE: 'GREEN', GREEN: 'RED', YELLOW: null };
  const RPS_HINT  = { RED: 'R > B', BLUE: 'B > G', GREEN: 'G > R', YELLOW: 'WILD' };

  // ── Tuning ────────────────────────────────────────────────────────────────────
  const SUN_RADIUS        = 30;
  const PROJ_RADIUS       = 9;
  const MAX_PULL          = 130;
  const LAUNCH_SPEED      = 320;   // px/s at full pull
  const HOMING            = 18;    // px/s² toward sun
  const AI_SPEED_MIN      = 110;
  const AI_SPEED_MAX      = 160;
  const AI_SHOOT_MIN      = 2500;
  const AI_SHOOT_MAX      = 5000;

  const ECONOMY = {
    shotCost: 10, shotCostYellow: 15,
    hitSun: 15, killEnemy: 30, tieEnemy: 5, start: 100,
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  const S = {
    coins: ECONOMY.start, score: 0,
    color: 'RED',
    projs: [], aiProjs: [],
    dragging: false, dragCur: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    phase: 'loading', loadPct: 0,
    msg: '', msgTtl: 0,
    particles: [],
    sunFlash: 0, frame: 0, lastTs: 0,
    aiShooters: [], nextShot: [],
  };

  // ── Canvas ────────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx    = canvas.getContext('2d');

  // Bottom zone heights (px from bottom)
  const BTN_H       = 36;
  const BTN_ZONE_H  = BTN_H + 16;         // buttons + padding below
  const SLING_H     = 140;                 // slingshot zone height above buttons
  const BOTTOM_PAD  = BTN_ZONE_H + SLING_H;

  function resize() {
    canvas.width  = Math.min(window.innerWidth,  480);
    canvas.height = Math.min(window.innerHeight, 854);
    S.anchor = { x: canvas.width / 2, y: canvas.height - BTN_ZONE_H - SLING_H / 2 };
    initAI();
  }
  window.addEventListener('resize', resize);
  resize();

  function sunPos() {
    return { x: canvas.width / 2, y: (canvas.height - BOTTOM_PAD) * 0.42 };
  }

  // ── AI ────────────────────────────────────────────────────────────────────────
  function initAI() {
    S.aiShooters = [
      { x: 36, y: 52 },
      { x: canvas.width - 36, y: 52 },
      { x: 36, y: (canvas.height - BOTTOM_PAD) / 2 },
    ];
    S.nextShot = S.aiShooters.map(() =>
      Date.now() + AI_SHOOT_MIN + Math.random() * (AI_SHOOT_MAX - AI_SHOOT_MIN));
  }

  function makeProj(x, y, vx, vy, col, isAI) {
    return { x, y, vx, vy, color: col, r: PROJ_RADIUS, isAI, alive: true, trail: [] };
  }

  // ── Input helpers ─────────────────────────────────────────────────────────────
  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
  }
  function d2(ax, ay, bx, by) { const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy; }

  // ── Color button layout ───────────────────────────────────────────────────────
  const BTN_W = 72;
  function btnX(i) { return canvas.width/2 - COLOR_KEYS.length*BTN_W/2 + i*BTN_W; }
  function btnY()  { return canvas.height - BTN_ZONE_H + 8; }

  function colorHitTest(pos) {
    const y = btnY();
    for (let i = 0; i < COLOR_KEYS.length; i++) {
      const x = btnX(i);
      if (pos.x >= x && pos.x < x + BTN_W - 4 && pos.y >= y && pos.y < y + BTN_H) {
        S.color = COLOR_KEYS[i]; return true;
      }
    }
    return false;
  }

  // ── Input events ─────────────────────────────────────────────────────────────
  function onDown(e) {
    if (S.phase === 'gameover') { restart(); return; }
    if (S.phase !== 'playing') return;
    e.preventDefault();
    const pos = canvasXY(e);
    if (colorHitTest(pos)) return;
    // Large slingshot zone — whole bottom area
    if (pos.y >= canvas.height - BOTTOM_PAD - 20) {
      S.dragging = true;
      S.dragCur  = clampPull(pos);
    }
  }
  function onMove(e) {
    if (!S.dragging) return;
    e.preventDefault();
    S.dragCur = clampPull(canvasXY(e));
  }
  function onUp(e) {
    if (!S.dragging) return;
    e.preventDefault();
    S.dragging = false;
    fire();
  }

  function clampPull(pos) {
    const dx = pos.x - S.anchor.x, dy = pos.y - S.anchor.y;
    const d  = Math.sqrt(dx*dx + dy*dy);
    if (d > MAX_PULL) return { x: S.anchor.x + dx/d*MAX_PULL, y: S.anchor.y + dy/d*MAX_PULL };
    return { x: pos.x, y: pos.y };
  }

  canvas.addEventListener('mousedown',  onDown);
  canvas.addEventListener('mousemove',  onMove);
  canvas.addEventListener('mouseup',    onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove',  onMove, { passive: false });
  canvas.addEventListener('touchend',   onUp,   { passive: false });

  // ── Fire ──────────────────────────────────────────────────────────────────────
  function fire() {
    const dx = S.dragCur.x - S.anchor.x, dy = S.dragCur.y - S.anchor.y;
    const d  = Math.sqrt(dx*dx + dy*dy);
    if (d < 8) return;
    const col  = S.color;
    const cost = col === 'YELLOW' ? ECONOMY.shotCostYellow : ECONOMY.shotCost;
    if (S.coins < cost) { flash('NOT ENOUGH COINS'); return; }
    S.coins -= cost;
    const spd = (d / MAX_PULL) * LAUNCH_SPEED;
    S.projs.push(makeProj(S.anchor.x, S.anchor.y, -(dx/d)*spd, -(dy/d)*spd, col, false));
    burst(S.anchor.x, S.anchor.y, COLORS[col].hex, 5);
    checkOver();
  }

  // ── AI ────────────────────────────────────────────────────────────────────────
  function tickAI(now) {
    for (let i = 0; i < S.aiShooters.length; i++) {
      if (now < S.nextShot[i]) continue;
      const sh = S.aiShooters[i], sun = sunPos();
      const dx = sun.x - sh.x + (Math.random()-.5)*60;
      const dy = sun.y - sh.y + (Math.random()-.5)*60;
      const d  = Math.sqrt(dx*dx + dy*dy);
      const spd = AI_SPEED_MIN + Math.random()*(AI_SPEED_MAX - AI_SPEED_MIN);
      const col = COLOR_KEYS[Math.floor(Math.random()*COLOR_KEYS.length)];
      S.aiProjs.push(makeProj(sh.x, sh.y, dx/d*spd, dy/d*spd, col, true));
      S.nextShot[i] = now + AI_SHOOT_MIN + Math.random()*(AI_SHOOT_MAX - AI_SHOOT_MIN);
    }
  }

  // ── Physics ───────────────────────────────────────────────────────────────────
  function tickProjs(dt) {
    const sun = sunPos();

    function move(p) {
      if (!p.alive) return;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 10) p.trail.shift();
      const dx = sun.x - p.x, dy = sun.y - p.y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      p.vx += dx/d * HOMING * dt;
      p.vy += dy/d * HOMING * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      const pad = 60;
      if (p.x < -pad || p.x > canvas.width+pad || p.y < -pad || p.y > canvas.height+pad)
        p.alive = false;
    }

    S.projs.forEach(move);
    S.aiProjs.forEach(move);

    // Player hits sun
    S.projs.forEach(p => {
      if (!p.alive) return;
      if (d2(p.x,p.y,sun.x,sun.y) < (SUN_RADIUS+p.r)**2) {
        p.alive = false;
        S.coins += ECONOMY.hitSun;
        S.score += 10;
        flash('+' + ECONOMY.hitSun + ' SOLAR HIT');
        burst(sun.x, sun.y, '#ffcc00', 18);
        S.sunFlash = 1;
      }
    });

    // AI hits sun
    S.aiProjs.forEach(p => {
      if (!p.alive) return;
      if (d2(p.x,p.y,sun.x,sun.y) < (SUN_RADIUS+p.r)**2) {
        p.alive = false;
        burst(sun.x, sun.y, COLORS[p.color].hex, 6);
      }
    });

    // Player vs AI (RPS)
    S.projs.forEach(pp => {
      if (!pp.alive) return;
      S.aiProjs.forEach(ap => {
        if (!ap.alive) return;
        if (d2(pp.x,pp.y,ap.x,ap.y) < (pp.r+ap.r)**2) rps(pp, ap);
      });
    });

    S.projs   = S.projs.filter(p => p.alive);
    S.aiProjs = S.aiProjs.filter(p => p.alive);
  }

  function rps(player, ai) {
    const pc = player.color, ac = ai.color;
    player.alive = ai.alive = false;
    if (pc === 'YELLOW' || RPS_BEATS[pc] === ac) {
      S.coins += ECONOMY.killEnemy; S.score += 30;
      flash('+' + ECONOMY.killEnemy + ' DESTROYED');
      burst(ai.x, ai.y, COLORS[ac].hex, 16);
    } else if (ac === 'YELLOW' || RPS_BEATS[ac] === pc) {
      burst(player.x, player.y, COLORS[pc].hex, 10);
    } else {
      S.coins += ECONOMY.tieEnemy; S.score += 5;
      flash('+' + ECONOMY.tieEnemy + ' TIE');
      burst((player.x+ai.x)/2, (player.y+ai.y)/2, '#ffffff', 8);
    }
  }

  // ── Particles ─────────────────────────────────────────────────────────────────
  function burst(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, spd = 60 + Math.random()*180;
      S.particles.push({ x, y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
        color: col, life: 1, decay: 1.0 + Math.random()*1.2, size: 2+Math.random()*3 });
    }
  }
  function tickParticles(dt) {
    S.particles.forEach(p => { p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=p.decay*dt; });
    S.particles = S.particles.filter(p => p.life > 0);
  }

  // ── Messages ──────────────────────────────────────────────────────────────────
  function flash(txt) { S.msg = txt; S.msgTtl = 1.8; }

  // ── Game over / restart ───────────────────────────────────────────────────────
  function checkOver() { if (S.coins < ECONOMY.shotCost) S.phase = 'gameover'; }
  function restart() {
    Object.assign(S, {
      coins: ECONOMY.start, score: 0, color: 'RED',
      projs: [], aiProjs: [], particles: [],
      dragging: false, phase: 'playing', msg: '', msgTtl: 0, sunFlash: 0,
    });
    initAI();
  }

  // ── Draw helpers ──────────────────────────────────────────────────────────────
  function hexRGB(h) {
    return `${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)}`;
  }

  // ── Draw: background ─────────────────────────────────────────────────────────
  function drawBG() {
    ctx.fillStyle = '#08080e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle dot grid
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    const gs = 32;
    for (let x = gs; x < canvas.width; x += gs)
      for (let y = gs; y < canvas.height - BOTTOM_PAD; y += gs) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI*2);
        ctx.fill();
      }

    // Divider line above button zone
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - BOTTOM_PAD);
    ctx.lineTo(canvas.width, canvas.height - BOTTOM_PAD);
    ctx.stroke();
  }

  // ── Draw: sun ─────────────────────────────────────────────────────────────────
  function drawSun() {
    const { x, y } = sunPos();
    const t = S.frame * 0.016;
    const flash = S.sunFlash;

    // Outer rings (flat concentric)
    const rings = [{ r: SUN_RADIUS*3.2, a: 0.06 }, { r: SUN_RADIUS*2.2, a: 0.12 }, { r: SUN_RADIUS*1.55, a: 0.22 }];
    rings.forEach(ring => {
      ctx.beginPath();
      ctx.arc(x, y, ring.r + flash*8, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(255,204,0,${ring.a + flash*0.2})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Core — flat filled circle
    ctx.beginPath();
    ctx.arc(x, y, SUN_RADIUS + flash*4, 0, Math.PI*2);
    ctx.fillStyle = flash > 0.3 ? '#ffffff' : '#ffcc00';
    ctx.fill();

    // Rotating tick marks
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.4);
    ctx.strokeStyle = `rgba(8,8,14,${0.6 - flash*0.3})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, SUN_RADIUS * 0.55);
      ctx.lineTo(0, SUN_RADIUS * 0.85);
      ctx.stroke();
    }
    ctx.restore();

    S.sunFlash = Math.max(0, S.sunFlash - 0.04);
  }

  // ── Draw: projectile ─────────────────────────────────────────────────────────
  function drawProj(p) {
    const col = COLORS[p.color].hex;
    const rgb = hexRGB(col);

    // Trail
    for (let i = 0; i < p.trail.length; i++) {
      const a = (i / p.trail.length) * (p.isAI ? 0.25 : 0.4);
      ctx.beginPath();
      ctx.arc(p.trail[i].x, p.trail[i].y, p.r * (i/p.trail.length) * 0.7, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${rgb},${a})`;
      ctx.fill();
    }

    // Body
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = p.isAI ? `rgba(${rgb},0.65)` : col;
    ctx.fill();

    // White inner dot for player shots
    if (!p.isAI) {
      ctx.beginPath();
      ctx.arc(p.x - p.r*0.28, p.y - p.r*0.28, p.r*0.28, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }

    // Small color letter
    ctx.fillStyle = p.isAI ? `rgba(255,255,255,0.4)` : 'rgba(255,255,255,0.85)';
    ctx.font = '7px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(p.color[0], p.x, p.y + 2.5);
  }

  // ── Draw: slingshot ───────────────────────────────────────────────────────────
  function drawSlingshot() {
    const { x, y } = S.anchor;
    const col = COLORS[S.color];

    // Zone hint circle (very faint)
    ctx.beginPath();
    ctx.arc(x, y, MAX_PULL, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (S.dragging) {
      const { x: cx, y: cy } = S.dragCur;
      const dx = cx - x, dy = cy - y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      const pwr = Math.round(d / MAX_PULL * 100);

      // Bands
      ctx.strokeStyle = col.hex;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(x - 16, y - 8); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 16, y - 8); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.globalAlpha = 1;

      // Projectile preview
      ctx.beginPath();
      ctx.arc(cx, cy, PROJ_RADIUS, 0, Math.PI*2);
      ctx.fillStyle = col.hex;
      ctx.fill();

      // Trajectory dots toward sun
      const sun = sunPos();
      const tvx = -(dx/d) * (d/MAX_PULL) * LAUNCH_SPEED;
      const tvy = -(dy/d) * (d/MAX_PULL) * LAUNCH_SPEED;
      ctx.fillStyle = `rgba(${hexRGB(col.hex)},0.25)`;
      let tx = S.anchor.x, ty = S.anchor.y, tvxx = tvx, tvyy = tvy;
      for (let i = 0; i < 12; i++) {
        const dt2 = 0.07;
        const sdx = sun.x - tx, sdy = sun.y - ty, sd = Math.sqrt(sdx*sdx+sdy*sdy)||1;
        tvxx += sdx/sd * HOMING * dt2;
        tvyy += sdy/sd * HOMING * dt2;
        tx += tvxx * dt2; ty += tvyy * dt2;
        const r = PROJ_RADIUS * (1 - i/14);
        ctx.beginPath();
        ctx.arc(tx, ty, r, 0, Math.PI*2);
        ctx.fill();
      }

      // Power label
      ctx.fillStyle = col.hex;
      ctx.font = 'bold 11px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(`${pwr}%`, x, y + 28);
    } else {
      // Anchor dot
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI*2);
      ctx.fillStyle = col.hex;
      ctx.fill();

      // Fork lines
      ctx.strokeStyle = `rgba(${hexRGB(col.hex)},0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 16, y - 8); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 16, y - 8); ctx.lineTo(x, y); ctx.stroke();
    }
  }

  // ── Draw: AI shooters ─────────────────────────────────────────────────────────
  function drawAI() {
    S.aiShooters.forEach((s, i) => {
      // Simple triangle pointing inward
      const sun = sunPos();
      const dx = sun.x - s.x, dy = sun.y - s.y;
      const d  = Math.sqrt(dx*dx+dy*dy)||1;
      const nx = dx/d, ny = dy/d;
      const size = 10;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.beginPath();
      ctx.moveTo(nx*size*1.6, ny*size*1.6);
      ctx.lineTo(-ny*size - nx*size*0.4, nx*size - ny*size*0.4);
      ctx.lineTo(ny*size - nx*size*0.4, -nx*size - ny*size*0.4);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,34,68,0.18)';
      ctx.strokeStyle = 'rgba(255,34,68,0.7)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  // ── Draw: particles ───────────────────────────────────────────────────────────
  function drawParticles() {
    S.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    });
  }

  // ── Draw: HUD ─────────────────────────────────────────────────────────────────
  function drawHUD() {
    const pad = 12;

    // COINS
    ctx.font = 'bold 13px Courier New';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffcc00';
    ctx.fillText(`COINS ${S.coins}`, pad, pad + 13);

    // SCORE
    ctx.textAlign = 'right';
    ctx.fillStyle = '#2277ff';
    ctx.fillText(`SCORE ${S.score}`, canvas.width - pad, pad + 13);

    // Color buttons
    for (let i = 0; i < COLOR_KEYS.length; i++) {
      const key = COLOR_KEYS[i];
      const col = COLORS[key];
      const x   = btnX(i), y = btnY();
      const w   = BTN_W - 6, h = BTN_H;
      const sel = key === S.color;

      ctx.fillStyle = sel ? col.hex : 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, w, h);

      if (!sel) {
        ctx.strokeStyle = `rgba(${hexRGB(col.hex)},0.5)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      }

      ctx.fillStyle = sel ? '#08080e' : col.hex;
      ctx.font = `${sel ? 'bold ' : ''}11px Courier New`;
      ctx.textAlign = 'center';
      ctx.fillText(key, x + w/2, y + h/2 + 4);
    }

    // RPS hint + cost above slingshot
    const col = COLORS[S.color];
    ctx.textAlign = 'center';
    ctx.font = '10px Courier New';
    ctx.fillStyle = `rgba(${hexRGB(col.hex)},0.9)`;
    ctx.fillText(`${col.name}  ${RPS_HINT[S.color]}  ${col.cost}¢`, S.anchor.x, S.anchor.y - MAX_PULL - 12);

    // Flash message
    if (S.msgTtl > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, S.msgTtl * 2.5);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px Courier New';
      ctx.fillStyle = '#ffcc00';
      ctx.fillText(S.msg, canvas.width/2, sunPos().y + SUN_RADIUS + 36);
      ctx.restore();
    }
  }

  // ── Draw: game over ───────────────────────────────────────────────────────────
  function drawGameOver() {
    ctx.fillStyle = 'rgba(8,8,14,0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width/2, cy = canvas.height/2 - 40;

    ctx.textAlign = 'center';
    ctx.font = 'bold 30px Courier New';
    ctx.fillStyle = '#ff2244';
    ctx.fillText('MISSION FAILED', cx, cy);

    ctx.font = '15px Courier New';
    ctx.fillStyle = '#ffcc00';
    ctx.fillText(`SCORE  ${S.score}`, cx, cy + 40);

    ctx.font = '12px Courier New';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('coins depleted', cx, cy + 66);

    if (Math.floor(S.frame/28) % 2 === 0) {
      ctx.font = 'bold 13px Courier New';
      ctx.fillStyle = '#22ee77';
      ctx.fillText('[ TAP TO RESTART ]', cx, cy + 108);
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────────
  function loop(ts) {
    const dt = Math.min((ts - (S.lastTs || ts)) / 1000, 0.05);
    S.lastTs = ts; S.frame++;

    if (S.phase === 'loading') {
      S.loadPct += dt * 0.9;
      const bar = document.getElementById('loading-bar');
      if (bar) bar.style.width = Math.min(S.loadPct * 100, 100) + '%';
      if (S.loadPct >= 1.1) {
        S.phase = 'playing';
        const ls = document.getElementById('loading-screen');
        if (ls) ls.style.display = 'none';
      }
    } else if (S.phase === 'playing') {
      tickAI(Date.now());
      tickProjs(dt);
      tickParticles(dt);
      if (S.msgTtl > 0) S.msgTtl -= dt;
      checkOver();
    }

    drawBG();
    drawSun();
    drawAI();
    S.aiProjs.forEach(drawProj);
    S.projs.forEach(drawProj);
    drawParticles();
    drawSlingshot();
    drawHUD();
    if (S.phase === 'gameover') drawGameOver();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Expose for tests
  window.__gameState  = S;
  window.__fire       = fire;
  window.__restart    = restart;

})();
