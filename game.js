// FRONTRUNNER - Tactical Projectile System
// 80s Retro Physics-Based Projectile Game

(function() {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────
  const COLORS = {
    RED:    { hex: '#c44040', name: 'RED',    glow: 'rgba(196,64,64,0.6)',   cost: 10 },
    BLUE:   { hex: '#4070c4', name: 'BLUE',   glow: 'rgba(64,112,196,0.6)',  cost: 10 },
    GREEN:  { hex: '#40a860', name: 'GREEN',  glow: 'rgba(64,168,96,0.6)',   cost: 10 },
    YELLOW: { hex: '#c4a030', name: 'YELLOW', glow: 'rgba(196,160,48,0.6)', cost: 15 },
  };

  const COLOR_KEYS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

  // Rock-Paper-Scissors: key beats value
  const RPS_BEATS = {
    RED:    'BLUE',
    BLUE:   'GREEN',
    GREEN:  'RED',
    YELLOW: null,
  };

  const RPS_HINT = {
    RED:    'RED > BLUE',
    BLUE:   'BLUE > GREEN',
    GREEN:  'GREEN > RED',
    YELLOW: 'YELLOW = WILD',
  };

  const PROJECTILE_RADIUS = 10;
  const SUN_RADIUS = 60;
  const MAX_PULL = 100;
  const LAUNCH_SPEED_FACTOR = 8;
  const HOMING_STRENGTH = 0.04;
  const AI_SHOOT_MIN = 2000;
  const AI_SHOOT_MAX = 4000;

  const ECONOMY = {
    shotCost: 10,
    shotCostYellow: 15,
    hitSunReward: 15,
    destroyEnemy: 30,
    tieEnemy: 5,
    startCoins: 100,
  };

  // ─── Game State ────────────────────────────────────────────────────────────────
  const state = {
    coins: ECONOMY.startCoins,
    score: 0,
    selectedColor: 'RED',
    projectiles: [],
    aiProjectiles: [],
    dragging: false,
    dragStart: { x: 0, y: 0 },
    dragCurrent: { x: 0, y: 0 },
    slingshotAnchor: { x: 0, y: 0 },
    gameOver: false,
    message: '',
    messageTtl: 0,
    phase: 'loading', // loading | playing | gameover
    loadProgress: 0,
    particles: [],
    sunPulse: 0,
    frame: 0,
    lastTime: 0,
    aiShooters: [],
    nextAiShoot: [],
  };

  // ─── Canvas Setup ─────────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    const maxW = Math.min(window.innerWidth, 480);
    const maxH = Math.min(window.innerHeight, 854);
    canvas.width = maxW;
    canvas.height = maxH;
    state.slingshotAnchor = { x: canvas.width / 2, y: canvas.height - 80 };
    initAiShooters();
  }

  window.addEventListener('resize', resize);
  resize();

  // ─── Sun ──────────────────────────────────────────────────────────────────────
  function getSunPos() {
    return { x: canvas.width / 2, y: canvas.height / 2 - 40 };
  }

  // ─── AI Shooters ──────────────────────────────────────────────────────────────
  function initAiShooters() {
    state.aiShooters = [
      { x: 40,              y: 40 },
      { x: canvas.width - 40, y: 40 },
      { x: 40,              y: canvas.height / 2 },
    ];
    state.nextAiShoot = state.aiShooters.map(() =>
      Date.now() + AI_SHOOT_MIN + Math.random() * (AI_SHOOT_MAX - AI_SHOOT_MIN)
    );
  }

  // ─── Projectile Factory ───────────────────────────────────────────────────────
  function makeProjectile(x, y, vx, vy, colorKey, isAI) {
    return {
      x, y, vx, vy,
      color: colorKey,
      radius: PROJECTILE_RADIUS,
      isAI,
      alive: true,
      trail: [],
    };
  }

  // ─── Input ────────────────────────────────────────────────────────────────────
  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top)  * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  function distSq(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx*dx + dy*dy;
  }

  function onPointerDown(e) {
    if (state.phase === 'gameover') {
      restartGame();
      return;
    }
    if (state.phase !== 'playing') return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const anchor = state.slingshotAnchor;

    // Check color selector click (buttons drawn at bottom)
    if (handleColorClick(pos)) return;

    // Check slingshot area
    if (distSq(pos.x, pos.y, anchor.x, anchor.y) < 80*80) {
      state.dragging = true;
      state.dragStart   = { ...anchor };
      state.dragCurrent = { ...pos };
    }
  }

  function onPointerMove(e) {
    if (!state.dragging) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const anchor = state.slingshotAnchor;
    const dx = pos.x - anchor.x;
    const dy = pos.y - anchor.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > MAX_PULL) {
      const scale = MAX_PULL / dist;
      state.dragCurrent = { x: anchor.x + dx * scale, y: anchor.y + dy * scale };
    } else {
      state.dragCurrent = { ...pos };
    }
  }

  function onPointerUp(e) {
    if (!state.dragging) return;
    e.preventDefault();
    state.dragging = false;
    launchPlayerProjectile();
  }

  // Color selector buttons at bottom
  const COLOR_BTN_WIDTH = 70;
  const COLOR_BTN_HEIGHT = 28;

  function colorBtnX(i) {
    return canvas.width / 2 - (COLOR_KEYS.length * COLOR_BTN_WIDTH) / 2 + i * COLOR_BTN_WIDTH;
  }

  function colorBtnY() {
    return canvas.height - 44;
  }

  function handleColorClick(pos) {
    const y = colorBtnY();
    for (let i = 0; i < COLOR_KEYS.length; i++) {
      const x = colorBtnX(i);
      if (pos.x >= x && pos.x <= x + COLOR_BTN_WIDTH &&
          pos.y >= y && pos.y <= y + COLOR_BTN_HEIGHT) {
        state.selectedColor = COLOR_KEYS[i];
        return true;
      }
    }
    return false;
  }

  canvas.addEventListener('mousedown',  onPointerDown);
  canvas.addEventListener('mousemove',  onPointerMove);
  canvas.addEventListener('mouseup',    onPointerUp);
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
  canvas.addEventListener('touchend',   onPointerUp,   { passive: false });

  // ─── Launch ───────────────────────────────────────────────────────────────────
  function launchPlayerProjectile() {
    const anchor = state.slingshotAnchor;
    const cur    = state.dragCurrent;
    const dx = cur.x - anchor.x;
    const dy = cur.y - anchor.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 5) return; // too small a pull

    const colorKey = state.selectedColor;
    const cost = colorKey === 'YELLOW' ? ECONOMY.shotCostYellow : ECONOMY.shotCost;
    if (state.coins < cost) {
      showMessage('NOT ENOUGH COINS');
      return;
    }
    state.coins -= cost;

    // Velocity: opposite direction of drag, proportional to pull
    const speed = (dist / MAX_PULL) * LAUNCH_SPEED_FACTOR * 60;
    const vx = -(dx / dist) * speed;
    const vy = -(dy / dist) * speed;

    state.projectiles.push(makeProjectile(anchor.x, anchor.y, vx, vy, colorKey, false));
    spawnParticles(anchor.x, anchor.y, COLORS[colorKey].hex, 6);
    checkGameOver();
  }

  // ─── AI Logic ─────────────────────────────────────────────────────────────────
  function updateAI(now) {
    for (let i = 0; i < state.aiShooters.length; i++) {
      if (now >= state.nextAiShoot[i]) {
        const shooter = state.aiShooters[i];
        const sun     = getSunPos();
        const dx = sun.x - shooter.x + (Math.random() - 0.5) * 80;
        const dy = sun.y - shooter.y + (Math.random() - 0.5) * 80;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const speed = 3 * 60 + Math.random() * 1.5 * 60;
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed;
        const colorKey = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
        state.aiProjectiles.push(makeProjectile(shooter.x, shooter.y, vx, vy, colorKey, true));

        state.nextAiShoot[i] = now + AI_SHOOT_MIN + Math.random() * (AI_SHOOT_MAX - AI_SHOOT_MIN);
      }
    }
  }

  // ─── Physics & Collision ──────────────────────────────────────────────────────
  function updateProjectiles(dt) {
    const sun = getSunPos();

    function moveProjectile(p) {
      if (!p.alive) return;

      // Save trail
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 8) p.trail.shift();

      // Homing toward sun
      const dx = sun.x - p.x;
      const dy = sun.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 0) {
        p.vx += (dx / dist) * HOMING_STRENGTH * 60 * dt;
        p.vy += (dy / dist) * HOMING_STRENGTH * 60 * dt;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Out of bounds
      const pad = 50;
      if (p.x < -pad || p.x > canvas.width + pad ||
          p.y < -pad || p.y > canvas.height + pad) {
        p.alive = false;
      }
    }

    state.projectiles.forEach(moveProjectile);
    state.aiProjectiles.forEach(moveProjectile);

    // Collision: player vs sun
    state.projectiles.forEach(p => {
      if (!p.alive) return;
      if (dist2(p.x, p.y, sun.x, sun.y) < (SUN_RADIUS + p.radius) ** 2) {
        p.alive = false;
        state.coins += ECONOMY.hitSunReward;
        state.score += 10;
        showMessage('SOLAR HIT! +' + ECONOMY.hitSunReward + ' COINS');
        spawnParticles(sun.x, sun.y, '#c4a030', 20);
        state.sunPulse = 1.0;
      }
    });

    // Collision: AI vs sun
    state.aiProjectiles.forEach(p => {
      if (!p.alive) return;
      if (dist2(p.x, p.y, sun.x, sun.y) < (SUN_RADIUS + p.radius) ** 2) {
        p.alive = false;
        spawnParticles(sun.x, sun.y, COLORS[p.color].hex, 8);
      }
    });

    // Collision: player vs AI projectiles (RPS)
    state.projectiles.forEach(pp => {
      if (!pp.alive) return;
      state.aiProjectiles.forEach(ap => {
        if (!ap.alive) return;
        if (dist2(pp.x, pp.y, ap.x, ap.y) < (pp.radius + ap.radius) ** 2) {
          resolveRPS(pp, ap);
        }
      });
    });

    // Collision: player vs player projectiles (RPS)
    for (let i = 0; i < state.projectiles.length; i++) {
      for (let j = i+1; j < state.projectiles.length; j++) {
        const a = state.projectiles[i], b = state.projectiles[j];
        if (!a.alive || !b.alive) continue;
        if (dist2(a.x, a.y, b.x, b.y) < (a.radius + b.radius) ** 2) {
          a.alive = false;
          b.alive = false;
        }
      }
    }

    // Prune dead projectiles
    state.projectiles   = state.projectiles.filter(p => p.alive);
    state.aiProjectiles = state.aiProjectiles.filter(p => p.alive);
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax-bx, dy = ay-by;
    return dx*dx + dy*dy;
  }

  function resolveRPS(player, ai) {
    const pc = player.color, ac = ai.color;
    if (pc === 'YELLOW' || RPS_BEATS[pc] === ac) {
      // Player wins
      player.alive = false;
      ai.alive     = false;
      state.coins += ECONOMY.destroyEnemy;
      state.score += 30;
      showMessage('DESTROYED! +' + ECONOMY.destroyEnemy + ' COINS');
      spawnParticles(ai.x, ai.y, COLORS[ac].hex, 15);
    } else if (ac === 'YELLOW' || RPS_BEATS[ac] === pc) {
      // AI wins
      player.alive = false;
      ai.alive     = false;
      spawnParticles(player.x, player.y, COLORS[pc].hex, 10);
    } else {
      // Tie
      player.alive = false;
      ai.alive     = false;
      state.coins += ECONOMY.tieEnemy;
      state.score += 5;
      showMessage('TIE! +' + ECONOMY.tieEnemy + ' COINS');
      spawnParticles((player.x+ai.x)/2, (player.y+ai.y)/2, '#ffffff', 8);
    }
  }

  // ─── Particles ────────────────────────────────────────────────────────────────
  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 150;
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        life: 1.0,
        decay: 0.8 + Math.random() * 0.8,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function updateParticles(dt) {
    state.particles.forEach(p => {
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.life -= p.decay * dt;
    });
    state.particles = state.particles.filter(p => p.life > 0);
  }

  // ─── Messages ────────────────────────────────────────────────────────────────
  function showMessage(text) {
    state.message    = text;
    state.messageTtl = 2.0;
  }

  // ─── Game Over ────────────────────────────────────────────────────────────────
  function checkGameOver() {
    const minCost = ECONOMY.shotCost;
    if (state.coins < minCost) {
      state.phase = 'gameover';
    }
  }

  function restartGame() {
    state.coins        = ECONOMY.startCoins;
    state.score        = 0;
    state.projectiles  = [];
    state.aiProjectiles= [];
    state.particles    = [];
    state.dragging     = false;
    state.phase        = 'playing';
    state.message      = '';
    state.messageTtl   = 0;
    state.selectedColor = 'RED';
    initAiShooters();
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────────
  function drawBackground() {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = 'rgba(60,70,90,0.25)';
    ctx.lineWidth = 0.5;
    const gridSize = 40;
    for (let x = 0; x <= canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawSun() {
    const sun = getSunPos();
    const t   = state.frame * 0.02;
    const pulse = 1 + 0.06 * Math.sin(t) + state.sunPulse * 0.3;

    // Outer glow rings
    for (let r = SUN_RADIUS * 2.5; r >= SUN_RADIUS; r -= 10) {
      const alpha = 0.04 + state.sunPulse * 0.05;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(196,160,48,${alpha})`;
      ctx.fill();
    }

    // Core
    const grad = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, SUN_RADIUS * pulse);
    grad.addColorStop(0, '#ffe080');
    grad.addColorStop(0.4, '#c4a030');
    grad.addColorStop(1, 'rgba(196,160,48,0)');
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, SUN_RADIUS * pulse, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Corona rays
    ctx.save();
    ctx.translate(sun.x, sun.y);
    ctx.rotate(t * 0.3);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, SUN_RADIUS * 0.9);
      ctx.lineTo(-5, SUN_RADIUS * 1.6);
      ctx.lineTo(5,  SUN_RADIUS * 1.6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(196,160,48,0.3)';
      ctx.fill();
    }
    ctx.restore();

    state.sunPulse = Math.max(0, state.sunPulse - 0.02);
  }

  function drawProjectile(p) {
    const col = COLORS[p.color];
    const alpha = p.isAI ? 0.7 : 1.0;

    // Trail
    p.trail.forEach((pt, i) => {
      const a = (i / p.trail.length) * 0.4 * alpha;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, p.radius * (i / p.trail.length) * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = col.hex.replace(')', `,${a})`).replace('rgb', 'rgba').replace('#', 'rgba(') || col.glow;
      // Simpler approach:
      ctx.fillStyle = `rgba(${hexToRgb(col.hex)},${a})`;
      ctx.fill();
    });

    // Glow
    ctx.save();
    ctx.shadowColor  = col.hex;
    ctx.shadowBlur   = p.isAI ? 8 : 15;
    ctx.globalAlpha  = alpha;

    // Circle
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = col.hex;
    ctx.fill();

    // Inner highlight
    ctx.beginPath();
    ctx.arc(p.x - p.radius * 0.3, p.y - p.radius * 0.3, p.radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();

    ctx.restore();

    // Color label for player projectiles
    if (!p.isAI) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font      = '7px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(p.color[0], p.x, p.y + 3);
    }
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `${r},${g},${b}`;
  }

  function drawSlingshot() {
    const anchor = state.slingshotAnchor;

    // Fork prongs
    ctx.strokeStyle = '#5a4020';
    ctx.lineWidth   = 4;
    ctx.beginPath();
    ctx.moveTo(anchor.x - 20, anchor.y + 20);
    ctx.lineTo(anchor.x - 15, anchor.y - 10);
    ctx.lineTo(anchor.x,      anchor.y - 25);
    ctx.lineTo(anchor.x + 15, anchor.y - 10);
    ctx.lineTo(anchor.x + 20, anchor.y + 20);
    ctx.stroke();

    // Stem
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y + 20);
    ctx.lineTo(anchor.x, anchor.y + 35);
    ctx.stroke();

    if (state.dragging) {
      const cur = state.dragCurrent;
      const col = COLORS[state.selectedColor];

      // Elastic bands
      ctx.strokeStyle = '#8a6030';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(anchor.x - 15, anchor.y - 10);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(anchor.x + 15, anchor.y - 10);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();

      // Projectile preview at drag point
      ctx.save();
      ctx.shadowColor = col.hex;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = col.hex;
      ctx.fill();
      ctx.restore();

      // Power indicator
      const dx = cur.x - anchor.x;
      const dy = cur.y - anchor.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const power = Math.round((dist / MAX_PULL) * 100);
      ctx.fillStyle = '#c4a030';
      ctx.font      = '10px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(`PWR: ${power}%`, anchor.x, anchor.y + 55);
    }
  }

  function drawAiShooters() {
    state.aiShooters.forEach(s => {
      ctx.save();
      ctx.strokeStyle = '#603030';
      ctx.lineWidth   = 2;
      ctx.shadowColor = '#c44040';
      ctx.shadowBlur  = 6;
      ctx.strokeRect(s.x - 12, s.y - 12, 24, 24);
      ctx.fillStyle = 'rgba(196,64,64,0.2)';
      ctx.fillRect(s.x - 12, s.y - 12, 24, 24);
      ctx.fillStyle = '#c44040';
      ctx.font      = '8px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('AI', s.x, s.y + 3);
      ctx.restore();
    });
  }

  function drawParticles() {
    state.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    });
  }

  function drawHUD() {
    const pad = 12;
    ctx.font      = '13px Courier New';
    ctx.textAlign = 'left';

    // Top-left: COINS
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(pad - 4, pad - 4, 140, 22);
    ctx.strokeStyle = 'rgba(196,160,48,0.4)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(pad - 4, pad - 4, 140, 22);
    ctx.fillStyle = '#c4a030';
    ctx.shadowColor = '#c4a030';
    ctx.shadowBlur  = 6;
    ctx.fillText(`COINS: ${state.coins}`, pad, pad + 12);
    ctx.shadowBlur = 0;

    // Top-right: SCORE
    ctx.textAlign   = 'right';
    ctx.fillStyle   = 'rgba(0,0,0,0.5)';
    ctx.fillRect(canvas.width - pad - 136, pad - 4, 140, 22);
    ctx.strokeStyle = 'rgba(64,112,196,0.4)';
    ctx.strokeRect(canvas.width - pad - 136, pad - 4, 140, 22);
    ctx.fillStyle   = '#4070c4';
    ctx.shadowColor = '#4070c4';
    ctx.shadowBlur  = 6;
    ctx.fillText(`SCORE: ${state.score}`, canvas.width - pad, pad + 12);
    ctx.shadowBlur  = 0;

    // Color selector
    drawColorSelector();

    // Selected color hint (above slingshot)
    const col  = COLORS[state.selectedColor];
    const hint = RPS_HINT[state.selectedColor];
    const anchor = state.slingshotAnchor;

    ctx.textAlign   = 'center';
    ctx.fillStyle   = col.hex;
    ctx.shadowColor = col.hex;
    ctx.shadowBlur  = 8;
    ctx.font        = '11px Courier New';
    ctx.fillText(`${col.name} — ${col.cost} COINS`, anchor.x, anchor.y - 45);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(160,168,184,0.7)';
    ctx.font        = '9px Courier New';
    ctx.fillText(hint, anchor.x, anchor.y - 32);

    // Message
    if (state.messageTtl > 0) {
      const alpha = Math.min(1, state.messageTtl * 2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign   = 'center';
      ctx.font        = 'bold 14px Courier New';
      ctx.fillStyle   = '#c4a030';
      ctx.shadowColor = '#c4a030';
      ctx.shadowBlur  = 12;
      ctx.fillText(state.message, canvas.width / 2, canvas.height / 2 + SUN_RADIUS + 50);
      ctx.restore();
    }
  }

  function drawColorSelector() {
    for (let i = 0; i < COLOR_KEYS.length; i++) {
      const key  = COLOR_KEYS[i];
      const col  = COLORS[key];
      const x    = colorBtnX(i);
      const y    = colorBtnY();
      const w    = COLOR_BTN_WIDTH - 4;
      const h    = COLOR_BTN_HEIGHT;
      const sel  = key === state.selectedColor;

      ctx.save();
      ctx.fillStyle = sel ? `rgba(${hexToRgb(col.hex)},0.3)` : 'rgba(0,0,0,0.5)';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = sel ? col.hex : 'rgba(160,168,184,0.3)';
      ctx.lineWidth   = sel ? 2 : 1;
      if (sel) {
        ctx.shadowColor = col.hex;
        ctx.shadowBlur  = 8;
      }
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = sel ? col.hex : 'rgba(160,168,184,0.7)';
      ctx.font      = '10px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(key, x + w / 2, y + h / 2 + 4);
      ctx.restore();
    }
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.textAlign   = 'center';
    ctx.font        = 'bold 28px Courier New';
    ctx.fillStyle   = '#c44040';
    ctx.shadowColor = '#c44040';
    ctx.shadowBlur  = 20;
    ctx.fillText('MISSION FAILED', cx, cy - 60);
    ctx.shadowBlur  = 0;

    ctx.font      = '14px Courier New';
    ctx.fillStyle = '#c4a030';
    ctx.fillText(`FINAL SCORE: ${state.score}`, cx, cy - 20);

    ctx.font      = '12px Courier New';
    ctx.fillStyle = '#a0a8b8';
    ctx.fillText('COINS DEPLETED', cx, cy + 10);

    ctx.font        = '13px Courier New';
    ctx.fillStyle   = '#40a860';
    ctx.shadowColor = '#40a860';
    ctx.shadowBlur  = 8;
    const blink = Math.floor(state.frame / 30) % 2 === 0;
    if (blink) ctx.fillText('[ CLICK TO RESTART ]', cx, cy + 60);
    ctx.shadowBlur  = 0;
  }

  // ─── Main Loop ────────────────────────────────────────────────────────────────
  function gameLoop(ts) {
    const dt = Math.min((ts - (state.lastTime || ts)) / 1000, 0.05);
    state.lastTime = ts;
    state.frame++;

    if (state.phase === 'loading') {
      updateLoading(dt);
    } else if (state.phase === 'playing') {
      updateGame(dt);
    }

    drawScene();
    requestAnimationFrame(gameLoop);
  }

  function updateLoading(dt) {
    state.loadProgress += dt * 0.7;
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = Math.min(state.loadProgress * 100, 100) + '%';
    if (state.loadProgress >= 1.4) {
      state.phase = 'playing';
      const ls = document.getElementById('loading-screen');
      if (ls) ls.style.display = 'none';
    }
  }

  function updateGame(dt) {
    const now = Date.now();
    updateAI(now);
    updateProjectiles(dt);
    updateParticles(dt);
    if (state.messageTtl > 0) state.messageTtl -= dt;
    checkGameOver();
  }

  function drawScene() {
    drawBackground();
    drawSun();
    drawAiShooters();

    state.aiProjectiles.forEach(drawProjectile);
    state.projectiles.forEach(drawProjectile);

    drawParticles();
    drawSlingshot();
    drawHUD();

    if (state.phase === 'gameover') {
      drawGameOver();
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  requestAnimationFrame(gameLoop);

  // Expose state for tests
  window.__gameState = state;
  window.__launchPlayerProjectile = launchPlayerProjectile;
  window.__restartGame = restartGame;

})();
