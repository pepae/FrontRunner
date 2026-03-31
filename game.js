// FRONTRUNNER — Tactical Projectile System

(function () {
  'use strict';

  // ── Palette ───────────────────────────────────────────────────────────────────
  const BG       = '#eaeaee';
  const PANEL_BG = '#ffffff';
  const INK      = '#1a1a2e';
  const INK2     = 'rgba(26,26,46,0.38)';

  const COLORS = {
    RED:    { hex: '#e8203a', name: 'RED',    cost: 10 },
    BLUE:   { hex: '#1a5cff', name: 'BLUE',   cost: 10 },
    GREEN:  { hex: '#0dbe5c', name: 'GREEN',  cost: 10 },
    YELLOW: { hex: '#f5900a', name: 'AMBER',  cost: 10 },
  };
  const COLOR_KEYS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

  const RPS_BEATS = { RED: 'BLUE', BLUE: 'GREEN', GREEN: 'RED', YELLOW: null };
  const RPS_LABEL = { RED: 'R>B', BLUE: 'B>G', GREEN: 'G>R', YELLOW: 'WILD' };

  const SHIELD_COST_EXTRA = 8;

  // ── Tuning ────────────────────────────────────────────────────────────────────
  const SUN_R        = 32;
  const PROJ_R       = 14;
  const MAX_PULL     = 130;
  const PLAYER_SPD   = 160;   // px/s at full pull
  const AI_SPD_MIN   = 65;
  const AI_SPD_MAX   = 95;
  const AI_INT_MIN   = 2800;
  const AI_INT_MAX   = 5500;
  const HOMING       = 14;    // px/s² gentle curve toward sun

  const ECONOMY = {
    shotCost: 10, shotCostYellow: 10,
    hitSun: 15, killEnemy: 30, tieEnemy: 5,
    shieldBonus: 15,   // extra reward on kill when shield was active
    start: 100,
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  const S = {
    coins: ECONOMY.start, score: 0,
    color: 'RED', shieldOn: false,
    projs: [], aiProjs: [],
    dragging: false, dragCur: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    phase: 'loading', loadPct: 0,
    msg: '', msgTtl: 0, msgColor: INK,
    particles: [],
    sunFlash: 0, frame: 0, lastTs: 0,
    nextShot: [],   // one timer per edge zone (3 zones)
  };

  // ── Canvas ────────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx    = canvas.getContext('2d');

  // Layout constants
  const PANEL_H    = 180;   // bottom white panel height
  const BTN_H      = 40;
  const BTN_PAD    = 10;
  const SHIELD_H   = 38;
  const ROWS_H     = BTN_H + SHIELD_H + BTN_PAD * 3;  // buttons + shield row + gaps

  function resize() {
    canvas.width  = Math.min(window.innerWidth,  480);
    canvas.height = Math.min(window.innerHeight, 854);
    // Anchor sits in the middle of the slingshot zone (panel minus rows)
    const slingshotZoneH = PANEL_H - ROWS_H;
    S.anchor = {
      x: canvas.width / 2,
      y: canvas.height - ROWS_H - slingshotZoneH / 2,
    };
    S.nextShot = [0, 1, 2].map(() =>
      Date.now() + AI_INT_MIN + Math.random() * (AI_INT_MAX - AI_INT_MIN));
  }
  window.addEventListener('resize', resize);
  resize();

  function sunPos() {
    const playH = canvas.height - PANEL_H;
    return { x: canvas.width / 2, y: playH * 0.40 };
  }

  // ── Spawn from edge ───────────────────────────────────────────────────────────
  function edgeSpawn(zone) {
    const playH = canvas.height - PANEL_H;
    const pad = PROJ_R + 4;
    if (zone === 0) return { x: -pad,              y: pad + Math.random() * (playH * 0.85) };
    if (zone === 1) return { x: canvas.width + pad, y: pad + Math.random() * (playH * 0.85) };
    return              { x: pad + Math.random() * (canvas.width - pad*2), y: -pad };
  }

  function makeProj(x, y, vx, vy, col, isAI, shielded) {
    return { x, y, vx, vy, color: col, r: PROJ_R, isAI, alive: true,
             trail: [], shielded: !!shielded };
  }

  // ── Input helpers ─────────────────────────────────────────────────────────────
  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
  }
  function d2(ax, ay, bx, by) { const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }

  // ── Button layout ─────────────────────────────────────────────────────────────
  const BTN_MARGIN = 8;
  function colorBtns() {
    const total = COLOR_KEYS.length;
    const w = (canvas.width - BTN_MARGIN * (total + 1)) / total;
    const y = canvas.height - BTN_PAD - BTN_H;
    return COLOR_KEYS.map((k, i) => ({
      key: k, x: BTN_MARGIN + i * (w + BTN_MARGIN), y, w, h: BTN_H,
    }));
  }
  function shieldBtn() {
    const y = canvas.height - BTN_PAD - BTN_H - BTN_PAD - SHIELD_H;
    return { x: BTN_MARGIN, y, w: canvas.width - BTN_MARGIN * 2, h: SHIELD_H };
  }

  // ── Input events ─────────────────────────────────────────────────────────────
  function onDown(e) {
    if (S.phase === 'gameover') { restart(); return; }
    if (S.phase !== 'playing') return;
    e.preventDefault();
    const pos = canvasXY(e);

    // Check color buttons
    for (const btn of colorBtns()) {
      if (pos.x >= btn.x && pos.x < btn.x+btn.w && pos.y >= btn.y && pos.y < btn.y+btn.h) {
        S.color = btn.key; return;
      }
    }
    // Check shield toggle
    const sb = shieldBtn();
    if (pos.x >= sb.x && pos.x < sb.x+sb.w && pos.y >= sb.y && pos.y < sb.y+sb.h) {
      S.shieldOn = !S.shieldOn; return;
    }
    // Slingshot zone — above button rows
    if (pos.y < canvas.height - ROWS_H + 20) {
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
    const cost = ECONOMY.shotCost + (S.shieldOn ? SHIELD_COST_EXTRA : 0);
    if (S.coins < cost) { toast('NOT ENOUGH COINS', '#e8203a'); return; }
    S.coins -= cost;
    const spd = (d / MAX_PULL) * PLAYER_SPD;
    S.projs.push(makeProj(S.anchor.x, S.anchor.y,
      -(dx/d)*spd, -(dy/d)*spd, col, false, S.shieldOn));
    burst(S.anchor.x, S.anchor.y, COLORS[col].hex, 4);
    checkOver();
  }

  // ── AI ────────────────────────────────────────────────────────────────────────
  function tickAI(now) {
    for (let zone = 0; zone < 3; zone++) {
      if (now < S.nextShot[zone]) continue;
      const sp  = edgeSpawn(zone);
      const sun = sunPos();
      const dx  = sun.x - sp.x + (Math.random()-.5)*50;
      const dy  = sun.y - sp.y + (Math.random()-.5)*50;
      const d   = Math.sqrt(dx*dx+dy*dy) || 1;
      const spd = AI_SPD_MIN + Math.random()*(AI_SPD_MAX - AI_SPD_MIN);
      const col = COLOR_KEYS[Math.floor(Math.random()*COLOR_KEYS.length)];
      S.aiProjs.push(makeProj(sp.x, sp.y, dx/d*spd, dy/d*spd, col, true, false));
      S.nextShot[zone] = now + AI_INT_MIN + Math.random()*(AI_INT_MAX - AI_INT_MIN);
    }
  }

  // ── Physics ───────────────────────────────────────────────────────────────────
  function tickProjs(dt) {
    const sun = sunPos();

    function move(p) {
      if (!p.alive) return;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 8) p.trail.shift();
      const dx = sun.x - p.x, dy = sun.y - p.y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      p.vx += dx/d * HOMING * dt;
      p.vy += dy/d * HOMING * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      const pad = 80;
      if (p.x < -pad || p.x > canvas.width+pad || p.y < -pad || p.y > canvas.height+pad)
        p.alive = false;
    }

    S.projs.forEach(move);
    S.aiProjs.forEach(move);

    // Player hits sun
    S.projs.forEach(p => {
      if (!p.alive) return;
      if (d2(p.x,p.y,sun.x,sun.y) < (SUN_R+p.r)**2) {
        p.alive = false;
        S.coins += ECONOMY.hitSun; S.score += 10;
        toast('+' + ECONOMY.hitSun + '  SOLAR HIT', COLORS[p.color].hex);
        burst(sun.x, sun.y, '#f5900a', 16);
        S.sunFlash = 1;
      }
    });

    // AI hits sun
    S.aiProjs.forEach(p => {
      if (!p.alive) return;
      if (d2(p.x,p.y,sun.x,sun.y) < (SUN_R+p.r)**2) {
        p.alive = false;
        burst(sun.x, sun.y, COLORS[p.color].hex, 6);
      }
    });

    // Player vs AI — RPS
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
    const shieldBonus = player.shielded ? ECONOMY.shieldBonus : 0;
    if (pc === 'YELLOW' || RPS_BEATS[pc] === ac) {
      const reward = ECONOMY.killEnemy + shieldBonus;
      S.coins += reward; S.score += 30;
      const label = shieldBonus ? `+${reward}  SHIELD BREAK` : `+${reward}  DESTROYED`;
      toast(label, COLORS[pc].hex);
      burst(ai.x, ai.y, COLORS[ac].hex, 14);
    } else if (ac === 'YELLOW' || RPS_BEATS[ac] === pc) {
      burst(player.x, player.y, COLORS[pc].hex, 8);
    } else {
      S.coins += ECONOMY.tieEnemy; S.score += 5;
      toast('+' + ECONOMY.tieEnemy + '  TIE', INK2);
      burst((player.x+ai.x)/2, (player.y+ai.y)/2, '#999', 6);
    }
  }

  // ── Particles ─────────────────────────────────────────────────────────────────
  function burst(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, spd = 50+Math.random()*160;
      S.particles.push({ x, y,
        vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
        color: col, life: 1, decay: 1.1+Math.random()*1.0, size: 3+Math.random()*4 });
    }
  }
  function tickParticles(dt) {
    S.particles.forEach(p => { p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=p.decay*dt; });
    S.particles = S.particles.filter(p => p.life > 0);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────────
  function toast(txt, col) { S.msg = txt; S.msgTtl = 1.8; S.msgColor = col || INK; }

  // ── Over / restart ────────────────────────────────────────────────────────────
  function checkOver() { if (S.coins < ECONOMY.shotCost) S.phase = 'gameover'; }
  function restart() {
    Object.assign(S, {
      coins: ECONOMY.start, score: 0, color: 'RED', shieldOn: false,
      projs: [], aiProjs: [], particles: [],
      dragging: false, phase: 'playing', msg: '', msgTtl: 0, sunFlash: 0,
    });
    S.nextShot = [0,1,2].map(() =>
      Date.now() + AI_INT_MIN + Math.random()*(AI_INT_MAX - AI_INT_MIN));
  }

  // ── Draw helpers ──────────────────────────────────────────────────────────────
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  // ── Background + panel ────────────────────────────────────────────────────────
  function drawBG() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bottom white panel
    ctx.fillStyle = PANEL_BG;
    roundRect(0, canvas.height - PANEL_H, canvas.width, PANEL_H, [16, 16, 0, 0]);
    ctx.fill();
  }

  // ── Sun ───────────────────────────────────────────────────────────────────────
  function drawSun() {
    const { x, y } = sunPos();
    const fl = S.sunFlash;

    // Target rings
    [SUN_R * 3.8, SUN_R * 2.6, SUN_R * 1.7].forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(x, y, r + fl*6, 0, Math.PI*2);
      ctx.strokeStyle = fl > 0.3 ? `rgba(245,144,10,${0.15 + i*0.06})` : `rgba(26,26,46,${0.06 + i*0.04})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Core circle
    ctx.beginPath();
    ctx.arc(x, y, SUN_R + fl*5, 0, Math.PI*2);
    ctx.fillStyle = fl > 0.4 ? '#ffffff' : '#f5900a';
    ctx.fill();

    // Dark sector marks (rotating)
    const t = S.frame * 0.013;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t);
    ctx.strokeStyle = fl > 0.4 ? 'rgba(245,144,10,0.6)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, SUN_R * 0.45);
      ctx.lineTo(0, SUN_R * 0.78);
      ctx.stroke();
    }
    ctx.restore();

    S.sunFlash = Math.max(0, S.sunFlash - 0.035);
  }

  // ── Projectile ────────────────────────────────────────────────────────────────
  function drawProj(p) {
    const isShielded = p.shielded && !p.isAI;
    const drawColor  = isShielded ? '#c0c0cc' : COLORS[p.color].hex;

    // Trail
    for (let i = 0; i < p.trail.length; i++) {
      const a = (i / p.trail.length) * 0.22;
      ctx.beginPath();
      ctx.arc(p.trail[i].x, p.trail[i].y, p.r * (i/p.trail.length) * 0.65, 0, Math.PI*2);
      ctx.fillStyle = drawColor + Math.round(a*255).toString(16).padStart(2,'0');
      ctx.fill();
    }

    // Body
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = p.isAI ? drawColor + 'bb' : drawColor;
    ctx.fill();

    // White shine dot
    ctx.beginPath();
    ctx.arc(p.x - p.r*0.3, p.y - p.r*0.3, p.r * 0.3, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();

    // Label — hidden when shielded
    if (!isShielded) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${p.r * 0.75}px -apple-system, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.color[0], p.x, p.y + 0.5);
      ctx.textBaseline = 'alphabetic';
    } else {
      // Lock icon indicator
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `${p.r * 0.8}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', p.x, p.y + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // ── Slingshot ─────────────────────────────────────────────────────────────────
  function drawSlingshot() {
    const { x, y } = S.anchor;
    const col = COLORS[S.color];

    if (S.dragging) {
      const { x: cx, y: cy } = S.dragCur;
      const dx = cx - x, dy = cy - y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      const pwr = Math.round(d / MAX_PULL * 100);

      // Elastic bands
      ctx.strokeStyle = col.hex;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(x - 14, y - 6); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 14, y - 6); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.globalAlpha = 1;

      // Ball at pull point
      ctx.beginPath();
      ctx.arc(cx, cy, PROJ_R, 0, Math.PI*2);
      ctx.fillStyle = S.shieldOn ? '#c0c0cc' : col.hex;
      ctx.fill();
      if (S.shieldOn) {
        ctx.font = `${PROJ_R * 0.9}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', cx, cy + 0.5);
        ctx.textBaseline = 'alphabetic';
      }

      // Trajectory preview
      const tvx = -(dx/d)*(d/MAX_PULL)*PLAYER_SPD;
      const tvy = -(dy/d)*(d/MAX_PULL)*PLAYER_SPD;
      const sun = sunPos();
      let tx = x, ty = y, tvxx = tvx, tvyy = tvy;
      for (let i = 1; i <= 10; i++) {
        const dt2 = 0.09;
        const sdx = sun.x-tx, sdy = sun.y-ty, sd = Math.sqrt(sdx*sdx+sdy*sdy)||1;
        tvxx += sdx/sd*HOMING*dt2; tvyy += sdy/sd*HOMING*dt2;
        tx += tvxx*dt2; ty += tvyy*dt2;
        ctx.globalAlpha = 0.12 + 0.05*(1 - i/10);
        ctx.beginPath();
        ctx.arc(tx, ty, PROJ_R*(1 - i/12), 0, Math.PI*2);
        ctx.fillStyle = S.shieldOn ? '#808090' : col.hex;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Power pill
      ctx.fillStyle = INK;
      ctx.font = 'bold 12px -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${pwr}%`, x, y + 34);
    } else {
      // Anchor dot
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI*2);
      ctx.fillStyle = col.hex;
      ctx.fill();
      // Prong arms
      ctx.strokeStyle = col.hex;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.moveTo(x-14, y-6); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+14, y-6); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ── Particles ─────────────────────────────────────────────────────────────────
  function drawParticles() {
    S.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life * 0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────
  function drawHUD() {
    const pad = 14;

    ctx.font = 'bold 14px -apple-system, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(`COINS  ${S.coins}`, pad, pad + 14);

    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.fillText(`SCORE  ${S.score}`, canvas.width - pad, pad + 14);

    // Shield toggle button
    const sb = shieldBtn();
    const shActive = S.shieldOn;
    ctx.fillStyle = shActive ? INK : PANEL_BG;
    roundRect(sb.x, sb.y, sb.w, sb.h, 10);
    ctx.fill();
    // Border
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    roundRect(sb.x, sb.y, sb.w, sb.h, 10);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `bold 13px -apple-system, Arial, sans-serif`;
    ctx.fillStyle = shActive ? PANEL_BG : INK;
    const shCost = ECONOMY.shotCost + SHIELD_COST_EXTRA;
    ctx.fillText(
      `🔒  ENCRYPT SHIELD  +${SHIELD_COST_EXTRA}¢   (${shCost}¢/SHOT)  ${shActive ? '— ON' : ''}`,
      sb.x + sb.w/2, sb.y + sb.h/2 + 5
    );

    // Color buttons
    const btns = colorBtns();
    for (const btn of btns) {
      const col = COLORS[btn.key];
      const sel = btn.key === S.color;

      ctx.fillStyle = sel ? col.hex : PANEL_BG;
      roundRect(btn.x, btn.y, btn.w, btn.h, 8);
      ctx.fill();

      if (!sel) {
        ctx.strokeStyle = col.hex;
        ctx.lineWidth = 1.5;
        roundRect(btn.x, btn.y, btn.w, btn.h, 8);
        ctx.stroke();
      }

      ctx.fillStyle = sel ? '#ffffff' : col.hex;
      ctx.font = `bold 11px -apple-system, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(col.name, btn.x + btn.w/2, btn.y + btn.h/2 - 5);
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.75)' : 'rgba(26,26,46,0.4)';
      ctx.font = `10px -apple-system, Arial, sans-serif`;
      ctx.fillText(RPS_LABEL[btn.key], btn.x + btn.w/2, btn.y + btn.h/2 + 9);
    }

    // Toast message
    if (S.msgTtl > 0) {
      const a = Math.min(1, S.msgTtl * 3);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 15px -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      // Pill background
      const tw = ctx.measureText(S.msg).width + 28;
      const tx = canvas.width/2 - tw/2;
      const ty = sunPos().y + SUN_R + 22;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      roundRect(tx, ty, tw, 32, 16);
      ctx.fill();
      ctx.fillStyle = S.msgColor;
      ctx.fillText(S.msg, canvas.width/2, ty + 21);
      ctx.restore();
    }
  }

  // ── Game over ─────────────────────────────────────────────────────────────────
  function drawGameOver() {
    ctx.fillStyle = 'rgba(234,234,238,0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width/2, cy = canvas.height/2 - 50;

    // Card
    const cw = 300, ch = 200;
    ctx.fillStyle = PANEL_BG;
    roundRect(cx - cw/2, cy - ch/2, cw, ch, 20);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px -apple-system, Arial, sans-serif';
    ctx.fillStyle = '#e8203a';
    ctx.fillText('MISSION FAILED', cx, cy - 30);

    ctx.font = 'bold 28px -apple-system, Arial, sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(S.score, cx, cy + 10);

    ctx.font = '13px -apple-system, Arial, sans-serif';
    ctx.fillStyle = INK2;
    ctx.fillText('FINAL SCORE', cx, cy + 32);

    // Tap to restart button
    if (Math.floor(S.frame/30) % 2 === 0) {
      ctx.fillStyle = INK;
      roundRect(cx - 100, cy + 54, 200, 40, 10);
      ctx.fill();
      ctx.font = 'bold 13px -apple-system, Arial, sans-serif';
      ctx.fillStyle = PANEL_BG;
      ctx.fillText('TAP TO RESTART', cx, cy + 80);
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
    S.aiProjs.forEach(drawProj);
    S.projs.forEach(drawProj);
    drawParticles();
    drawSlingshot();
    drawHUD();
    if (S.phase === 'gameover') drawGameOver();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__gameState = S;
  window.__fire      = fire;
  window.__restart   = restart;

})();
