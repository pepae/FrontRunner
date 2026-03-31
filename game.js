// FRONTRUNNER — Tactical Projectile System

(function () {
  'use strict';

  // ── Palette ───────────────────────────────────────────────────────────────────
  const BG       = '#eaeaee';
  const PANEL_BG = '#ffffff';
  const INK      = '#1a1a2e';
  const INK2     = 'rgba(26,26,46,0.38)';

  const COLORS = {
    RED:    { hex: '#e8203a', name: 'RED',   cost: 10 },
    BLUE:   { hex: '#1a5cff', name: 'BLUE',  cost: 10 },
    GREEN:  { hex: '#0dbe5c', name: 'GREEN', cost: 10 },
    YELLOW: { hex: '#f5900a', name: 'AMBER', cost: 10 },
  };
  const COLOR_KEYS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

  // RPS: key beats value
  const RPS_BEATS = { RED: 'BLUE', BLUE: 'GREEN', GREEN: 'RED', YELLOW: null };
  const RPS_LABEL = { RED: 'R>B', BLUE: 'B>G', GREEN: 'G>R', YELLOW: 'WILD' };

  // ── Speed tiers ───────────────────────────────────────────────────────────────
  const SPEEDS = [
    { name: 'SLOW', spd: 85,  extra: 0  },
    { name: 'MED',  spd: 150, extra: 5  },
    { name: 'FAST', spd: 230, extra: 12 },
  ];

  const SHIELD_COST_EXTRA = 8;

  // ── Tuning ────────────────────────────────────────────────────────────────────
  const SUN_R      = 32;
  const PROJ_R     = 14;
  const MAX_PULL   = 130;
  const AI_SPD_MIN = 38;
  const AI_SPD_MAX = 55;
  const AI_INT_MIN = 2800;
  const AI_INT_MAX = 5500;
  const HOMING     = 14;

  const ECONOMY = {
    shotCost: 10,
    hitSun: 15, killEnemy: 30, tieEnemy: 5,
    shieldBonus: 15,
    start: 100,
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  const S = {
    coins: ECONOMY.start, score: 0,
    color: 'RED', shieldOn: false, speedIdx: 1,
    projs: [], aiProjs: [],
    dragging: false, dragCur: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    phase: 'loading', loadPct: 0,
    msg: '', msgTtl: 0, msgColor: INK,
    particles: [],
    sunFlash: 0, frame: 0, lastTs: 0,
    nextShot: [],
  };

  // ── Canvas ────────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx    = canvas.getContext('2d');

  const PANEL_H  = 240;
  const BTN_H    = 40;
  const SHIELD_H = 38;
  const SPEED_H  = 38;
  const PAD      = 10;
  const MARGIN   = 8;
  // rows from bottom up: color btns, shield, speed
  const ROWS_H   = BTN_H + SHIELD_H + SPEED_H + PAD * 4;

  function resize() {
    canvas.width  = Math.min(window.innerWidth,  480);
    canvas.height = Math.min(window.innerHeight, 854);
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
    return { x: canvas.width / 2, y: (canvas.height - PANEL_H) * 0.40 };
  }

  // ── Button rects ──────────────────────────────────────────────────────────────
  function colorBtns() {
    const n = COLOR_KEYS.length;
    const w = (canvas.width - MARGIN * (n + 1)) / n;
    const y = canvas.height - PAD - BTN_H;
    return COLOR_KEYS.map((k, i) => ({
      key: k, x: MARGIN + i * (w + MARGIN), y, w, h: BTN_H,
    }));
  }
  function shieldBtnRect() {
    return {
      x: MARGIN,
      y: canvas.height - PAD - BTN_H - PAD - SHIELD_H,
      w: canvas.width - MARGIN * 2,
      h: SHIELD_H,
    };
  }
  function speedBtnRect() {
    return {
      x: MARGIN,
      y: canvas.height - PAD - BTN_H - PAD - SHIELD_H - PAD - SPEED_H,
      w: canvas.width - MARGIN * 2,
      h: SPEED_H,
    };
  }

  // ── Edge spawn ────────────────────────────────────────────────────────────────
  function edgeSpawn(zone) {
    const playH = canvas.height - PANEL_H;
    const pad   = PROJ_R + 4;
    if (zone === 0) return { x: -pad,               y: pad + Math.random() * (playH * 0.85) };
    if (zone === 1) return { x: canvas.width + pad,  y: pad + Math.random() * (playH * 0.85) };
    return              { x: pad + Math.random() * (canvas.width - pad * 2), y: -pad };
  }

  function makeProj(x, y, vx, vy, col, isAI, shielded) {
    return { x, y, vx, vy, color: col, r: PROJ_R, isAI, alive: true,
             trail: [], shielded: !!shielded };
  }

  // ── AI color logic ────────────────────────────────────────────────────────────
  // Returns the key that beats `col`, or null if none
  function counterOf(col) {
    return Object.keys(RPS_BEATS).find(k => RPS_BEATS[k] === col) || null;
  }

  function aiPickColor() {
    // Observe any visible (non-shielded) player projectile
    const visible = S.projs.find(p => !p.shielded);
    // Also observe player's currently selected color if shield is off
    const knownColor = visible ? visible.color
                     : (!S.shieldOn ? S.color : null);

    if (knownColor && Math.random() < 0.72) {
      const counter = counterOf(knownColor);
      if (counter) return counter;
    }
    return COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
  }

  // ── Input helpers ─────────────────────────────────────────────────────────────
  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
  }
  function d2(ax, ay, bx, by) { const dx = ax-bx, dy = ay-by; return dx*dx + dy*dy; }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  // ── Input events ─────────────────────────────────────────────────────────────
  function onDown(e) {
    if (S.phase === 'gameover') { restart(); return; }
    if (S.phase !== 'playing') return;
    e.preventDefault();
    const pos = canvasXY(e);

    // Color buttons
    for (const btn of colorBtns()) {
      if (pos.x >= btn.x && pos.x < btn.x+btn.w && pos.y >= btn.y && pos.y < btn.y+btn.h) {
        S.color = btn.key; return;
      }
    }
    // Shield toggle
    const sb = shieldBtnRect();
    if (pos.x >= sb.x && pos.x < sb.x+sb.w && pos.y >= sb.y && pos.y < sb.y+sb.h) {
      S.shieldOn = !S.shieldOn; return;
    }
    // Speed segments
    const sp = speedBtnRect();
    if (pos.x >= sp.x && pos.x < sp.x+sp.w && pos.y >= sp.y && pos.y < sp.y+sp.h) {
      const segW = sp.w / 3;
      S.speedIdx = Math.floor((pos.x - sp.x) / segW);
      return;
    }
    // Slingshot zone
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
    const tier = SPEEDS[S.speedIdx];
    const cost = ECONOMY.shotCost + tier.extra + (S.shieldOn ? SHIELD_COST_EXTRA : 0);
    if (S.coins < cost) { toast('NOT ENOUGH COINS', '#e8203a'); return; }
    S.coins -= cost;
    const spd = tier.spd;
    S.projs.push(makeProj(S.anchor.x, S.anchor.y,
      -(dx/d)*spd, -(dy/d)*spd, S.color, false, S.shieldOn));
    burst(S.anchor.x, S.anchor.y, COLORS[S.color].hex, 4);
    checkOver();
  }

  // ── AI ────────────────────────────────────────────────────────────────────────
  function tickAI(now) {
    for (let zone = 0; zone < 3; zone++) {
      if (now < S.nextShot[zone]) continue;
      const sp  = edgeSpawn(zone);
      const sun = sunPos();
      const dx  = sun.x - sp.x + (Math.random() - .5) * 50;
      const dy  = sun.y - sp.y + (Math.random() - .5) * 50;
      const d   = Math.sqrt(dx*dx + dy*dy) || 1;
      const spd = AI_SPD_MIN + Math.random() * (AI_SPD_MAX - AI_SPD_MIN);
      const col = aiPickColor();
      S.aiProjs.push(makeProj(sp.x, sp.y, dx/d*spd, dy/d*spd, col, true, false));
      S.nextShot[zone] = now + AI_INT_MIN + Math.random() * (AI_INT_MAX - AI_INT_MIN);
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
      if (d2(p.x, p.y, sun.x, sun.y) < (SUN_R + p.r) ** 2) {
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
      if (d2(p.x, p.y, sun.x, sun.y) < (SUN_R + p.r) ** 2) {
        p.alive = false;
        burst(sun.x, sun.y, COLORS[p.color].hex, 6);
      }
    });

    // Player vs AI — RPS
    S.projs.forEach(pp => {
      if (!pp.alive) return;
      S.aiProjs.forEach(ap => {
        if (!ap.alive) return;
        if (d2(pp.x, pp.y, ap.x, ap.y) < (pp.r + ap.r) ** 2) rps(pp, ap);
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
      toast((shieldBonus ? '+' + reward + '  SHIELD BREAK' : '+' + reward + '  DESTROYED'),
            COLORS[pc].hex);
      burst(ai.x, ai.y, COLORS[ac].hex, 14);
    } else if (ac === 'YELLOW' || RPS_BEATS[ac] === pc) {
      burst(player.x, player.y, COLORS[pc].hex, 8);
    } else {
      S.coins += ECONOMY.tieEnemy; S.score += 5;
      toast('+' + ECONOMY.tieEnemy + '  TIE', INK2);
      burst((player.x+ai.x)/2, (player.y+ai.y)/2, '#aaa', 6);
    }
  }

  // ── Particles ─────────────────────────────────────────────────────────────────
  function burst(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, spd = 50 + Math.random()*160;
      S.particles.push({ x, y,
        vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
        color: col, life: 1, decay: 1.1 + Math.random()*1.0, size: 3 + Math.random()*4 });
    }
  }
  function tickParticles(dt) {
    S.particles.forEach(p => { p.x += p.vx*dt; p.y += p.vy*dt; p.life -= p.decay*dt; });
    S.particles = S.particles.filter(p => p.life > 0);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────────
  function toast(txt, col) { S.msg = txt; S.msgTtl = 1.8; S.msgColor = col || INK; }

  // ── Over / restart ────────────────────────────────────────────────────────────
  function checkOver() { if (S.coins < ECONOMY.shotCost) S.phase = 'gameover'; }
  function restart() {
    Object.assign(S, {
      coins: ECONOMY.start, score: 0, color: 'RED', shieldOn: false, speedIdx: 1,
      projs: [], aiProjs: [], particles: [],
      dragging: false, phase: 'playing', msg: '', msgTtl: 0, sunFlash: 0,
    });
    S.nextShot = [0, 1, 2].map(() =>
      Date.now() + AI_INT_MIN + Math.random() * (AI_INT_MAX - AI_INT_MIN));
  }

  // ── Draw: background + panel ──────────────────────────────────────────────────
  function drawBG() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = PANEL_BG;
    rr(0, canvas.height - PANEL_H, canvas.width, PANEL_H, [16, 16, 0, 0]);
    ctx.fill();
  }

  // ── Draw: sun ─────────────────────────────────────────────────────────────────
  function drawSun() {
    const { x, y } = sunPos();
    const fl = S.sunFlash;

    [SUN_R*3.8, SUN_R*2.6, SUN_R*1.7].forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(x, y, r + fl*6, 0, Math.PI*2);
      ctx.strokeStyle = fl > 0.3
        ? `rgba(245,144,10,${0.15 + i*0.06})`
        : `rgba(26,26,46,${0.06 + i*0.04})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(x, y, SUN_R + fl*5, 0, Math.PI*2);
    ctx.fillStyle = fl > 0.4 ? '#ffffff' : '#f5900a';
    ctx.fill();

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

  // ── Draw: projectile ─────────────────────────────────────────────────────────
  function drawProj(p) {
    const isShielded = p.shielded && !p.isAI;
    const drawColor  = isShielded ? '#b0b0be' : COLORS[p.color].hex;

    // Trail
    for (let i = 0; i < p.trail.length; i++) {
      const frac = i / p.trail.length;
      ctx.beginPath();
      ctx.arc(p.trail[i].x, p.trail[i].y, p.r * frac * 0.6, 0, Math.PI*2);
      ctx.fillStyle = drawColor + Math.round(frac * 0.18 * 255).toString(16).padStart(2, '0');
      ctx.fill();
    }

    // Body — flat solid circle, no shine dot, no letter
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = p.isAI ? drawColor + 'b0' : drawColor;
    ctx.fill();

    // Lock icon only when player-shielded
    if (isShielded) {
      ctx.font = `${p.r * 0.82}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', p.x, p.y + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // ── Draw: slingshot ───────────────────────────────────────────────────────────
  function drawSlingshot() {
    const { x, y } = S.anchor;
    const tier = SPEEDS[S.speedIdx];
    const col  = COLORS[S.color];

    if (S.dragging) {
      const { x: cx, y: cy } = S.dragCur;
      const dx = cx - x, dy = cy - y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;

      // Bands
      ctx.strokeStyle = S.shieldOn ? '#b0b0be' : col.hex;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(x - 14, y - 6); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 14, y - 6); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.globalAlpha = 1;

      // Ball — no shine, no letter
      ctx.beginPath();
      ctx.arc(cx, cy, PROJ_R, 0, Math.PI*2);
      ctx.fillStyle = S.shieldOn ? '#b0b0be' : col.hex;
      ctx.fill();
      if (S.shieldOn) {
        ctx.font = `${PROJ_R * 0.82}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', cx, cy + 0.5);
        ctx.textBaseline = 'alphabetic';
      }

      // Trajectory preview using selected speed tier
      const tvx = -(dx/d) * tier.spd;
      const tvy = -(dy/d) * tier.spd;
      const sun = sunPos();
      let tx = x, ty = y, tvxx = tvx, tvyy = tvy;
      for (let i = 1; i <= 12; i++) {
        const dt2 = 0.09;
        const sdx = sun.x - tx, sdy = sun.y - ty;
        const sd  = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
        tvxx += sdx/sd * HOMING * dt2;
        tvyy += sdy/sd * HOMING * dt2;
        tx += tvxx * dt2; ty += tvyy * dt2;
        ctx.globalAlpha = 0.08 + 0.04 * (1 - i/12);
        ctx.beginPath();
        ctx.arc(tx, ty, PROJ_R * (1 - i/14), 0, Math.PI*2);
        ctx.fillStyle = S.shieldOn ? '#808090' : col.hex;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

    } else {
      // Anchor dot + prongs
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI*2);
      ctx.fillStyle = col.hex;
      ctx.fill();
      ctx.strokeStyle = col.hex;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.moveTo(x-14, y-6); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+14, y-6); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ── Draw: particles ───────────────────────────────────────────────────────────
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

  // ── Draw: HUD ─────────────────────────────────────────────────────────────────
  function drawHUD() {
    const pad = 14;

    // COINS / SCORE
    ctx.font = 'bold 14px -apple-system, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(`COINS  ${S.coins}`, pad, pad + 14);
    ctx.textAlign = 'right';
    ctx.fillText(`SCORE  ${S.score}`, canvas.width - pad, pad + 14);

    // ── Speed selector ────────────────────────────────────────────────────────
    const sp = speedBtnRect();
    const segW = sp.w / 3;

    // Track background
    ctx.fillStyle = 'rgba(26,26,46,0.07)';
    rr(sp.x, sp.y, sp.w, sp.h, 10);
    ctx.fill();

    // Selected segment fill
    ctx.fillStyle = INK;
    rr(sp.x + S.speedIdx * segW, sp.y, segW, sp.h,
       S.speedIdx === 0 ? [10,0,0,10] : S.speedIdx === 2 ? [0,10,10,0] : 0);
    ctx.fill();

    // Segment labels + cost
    for (let i = 0; i < 3; i++) {
      const tier = SPEEDS[i];
      const sel  = i === S.speedIdx;
      const sx   = sp.x + i * segW;
      const mx   = sx + segW / 2;
      ctx.fillStyle = sel ? PANEL_BG : INK;
      ctx.font = `bold 12px -apple-system, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tier.name, mx, sp.y + sp.h/2 - 2);
      ctx.font = `10px -apple-system, Arial, sans-serif`;
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.65)' : INK2;
      const totalCost = ECONOMY.shotCost + tier.extra + (S.shieldOn ? SHIELD_COST_EXTRA : 0);
      ctx.fillText(`${totalCost}¢`, mx, sp.y + sp.h/2 + 13);
    }

    // ── Shield toggle ─────────────────────────────────────────────────────────
    const sb = shieldBtnRect();
    ctx.fillStyle = S.shieldOn ? INK : 'rgba(26,26,46,0.07)';
    rr(sb.x, sb.y, sb.w, sb.h, 10);
    ctx.fill();
    if (!S.shieldOn) {
      ctx.strokeStyle = 'rgba(26,26,46,0.2)';
      ctx.lineWidth = 1;
      rr(sb.x, sb.y, sb.w, sb.h, 10);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.font = `bold 13px -apple-system, Arial, sans-serif`;
    ctx.fillStyle = S.shieldOn ? PANEL_BG : INK;
    ctx.fillText(
      `🔒  ENCRYPT SHIELD  +${SHIELD_COST_EXTRA}¢${S.shieldOn ? '  —  ON' : ''}`,
      sb.x + sb.w/2, sb.y + sb.h/2 + 5
    );

    // ── Color buttons ─────────────────────────────────────────────────────────
    for (const btn of colorBtns()) {
      const col = COLORS[btn.key];
      const sel = btn.key === S.color;
      ctx.fillStyle = sel ? col.hex : PANEL_BG;
      rr(btn.x, btn.y, btn.w, btn.h, 8);
      ctx.fill();
      if (!sel) {
        ctx.strokeStyle = col.hex;
        ctx.lineWidth = 1.5;
        rr(btn.x, btn.y, btn.w, btn.h, 8);
        ctx.stroke();
      }
      ctx.fillStyle = sel ? '#ffffff' : col.hex;
      ctx.font = `bold 11px -apple-system, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(col.name, btn.x + btn.w/2, btn.y + btn.h/2 - 4);
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.7)' : INK2;
      ctx.font = `10px -apple-system, Arial, sans-serif`;
      ctx.fillText(RPS_LABEL[btn.key], btn.x + btn.w/2, btn.y + btn.h/2 + 10);
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    if (S.msgTtl > 0) {
      const a = Math.min(1, S.msgTtl * 3);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 15px -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(S.msg).width + 28;
      const tx = canvas.width/2 - tw/2;
      const ty = sunPos().y + SUN_R + 22;
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      rr(tx, ty, tw, 32, 16);
      ctx.fill();
      ctx.fillStyle = S.msgColor;
      ctx.fillText(S.msg, canvas.width/2, ty + 21);
      ctx.restore();
    }
  }

  // ── Draw: game over ───────────────────────────────────────────────────────────
  function drawGameOver() {
    ctx.fillStyle = 'rgba(234,234,238,0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width/2, cy = canvas.height/2 - 50;
    ctx.fillStyle = PANEL_BG;
    rr(cx - 150, cy - 100, 300, 200, 20);
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

    if (Math.floor(S.frame/30) % 2 === 0) {
      ctx.fillStyle = INK;
      rr(cx - 100, cy + 52, 200, 40, 10);
      ctx.fill();
      ctx.font = 'bold 13px -apple-system, Arial, sans-serif';
      ctx.fillStyle = PANEL_BG;
      ctx.fillText('TAP TO RESTART', cx, cy + 78);
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
