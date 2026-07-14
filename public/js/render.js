// Crash It — canvas renderer. Draws entirely from a plain state snapshot,
// so it works identically for the local sim (host) and network replicas (guest).
(function () {
  const { W, H, MAPS } = CrashMaps;

  const COLORS = {
    bg: '#3d434a',          // solid terrain charcoal (fills everything outside the sky window)
    bgDeco: 'rgba(0,0,0,0.16)',
    rain: 'rgba(255,255,255,0.05)',
    sky: '#f3bcb6',         // the pink sky visible through the window
    outline: '#15181b',
    skyline: ['#ab8dab', '#9a7d9e', '#b697b2'],
    skylineWin: 'rgba(255,255,255,0.22)',
    cream: '#f6e8cf',
    plank: '#7c4b31',
    plankEdge: '#5d3623',
    pivot: '#38231a',
    waterTop: '#2196e8',
    water: '#1a7fd4',
    waterDeep: '#1a4fa8',
    p1: '#e8433f', p1d: '#b02c2c',
    p2: '#35b6e0', p2d: '#1f81ab',
    skin: '#f7c9a2',
  };

  // ---------- deterministic decor ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function bounds(verts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const v of verts) {
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y);
      x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
    }
    return { x0, y0, x1, y1 };
  }

  function smoothPath(ctx, verts) {
    const n = verts.length;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = verts[i % n], b = verts[(i + 1) % n];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.quadraticCurveTo(a.x, a.y, mx, my);
    }
    ctx.closePath();
  }

  // pixel-city skyline pattern, clipped inside an island shape
  function drawSkyline(ctx, verts, seed) {
    const b = bounds(verts);
    const rnd = mulberry32(seed);
    ctx.save();
    smoothPath(ctx, verts);
    ctx.clip();
    // building masses rising from the bottom of the shape
    let x = b.x0 - 20;
    let ci = 0;
    while (x < b.x1 + 20) {
      const bw = 70 + rnd() * 130;
      const bh = (b.y1 - b.y0) * (0.25 + rnd() * 0.55);
      const by = b.y1 + 30 - bh;
      ctx.fillStyle = COLORS.skyline[ci++ % COLORS.skyline.length];
      ctx.globalAlpha = 0.55 + rnd() * 0.3;
      ctx.fillRect(x, by, bw, bh + 40);
      // window dashes
      ctx.fillStyle = COLORS.skylineWin;
      for (let wy = by + 16; wy < b.y1; wy += 26) {
        for (let wx = x + 10; wx < x + bw - 18; wx += 30) {
          if (rnd() < 0.55) ctx.fillRect(wx, wy, 16, 7);
        }
      }
      if (rnd() < 0.18) { // cream accent building
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = COLORS.cream;
        ctx.fillRect(x + bw * 0.2, by + bh * 0.3, bw * 0.35, bh);
      }
      x += bw + 8;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // scattered dark rounded bars (drifting cloud specks) — used on the charcoal
  // background and inside ground masses
  function drawSpecks(ctx, seed, x0, y0, x1, y1, count, alpha) {
    const rnd = mulberry32(seed);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    for (let i = 0; i < count; i++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
      const w = 60 + rnd() * 130, h = 16 + rnd() * 14;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, h / 2);
      ctx.fill();
    }
  }

  // dark solid mass (ground island / hanging corner) with speckle texture
  function drawGround(ctx, verts, seed) {
    smoothPath(ctx, verts);
    ctx.fillStyle = COLORS.bg;
    ctx.fill();
    ctx.save();
    smoothPath(ctx, verts);
    ctx.clip();
    const b = bounds(verts);
    drawSpecks(ctx, seed, b.x0, b.y0 + 40, b.x1 - 60, b.y1, 16, 0.22);
    ctx.restore();
    smoothPath(ctx, verts);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 7;
    ctx.stroke();
  }

  // the map itself: dark terrain everywhere with a pink sky-window pocket,
  // or a full pink sky with dark ground masses floating in it
  function drawMapBase(ctx, map, seed) {
    if (map.sky.kind === 'window') {
      // charcoal terrain fills the screen (already painted as bg) + specks
      drawSpecks(ctx, seed * 31 + 5, -100, 0, W + 100, H, 22, 0.14);
      smoothPath(ctx, map.sky.verts);
      ctx.fillStyle = COLORS.sky;
      ctx.fill();
      drawSkyline(ctx, map.sky.verts, seed * 17 + 3);
      smoothPath(ctx, map.sky.verts);
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = 7;
      ctx.stroke();
    } else {
      // open sky: pink everywhere, city skyline rising from the horizon
      ctx.fillStyle = COLORS.sky;
      ctx.fillRect(-100, -100, W + 200, H + 200);
      const frame = [{ x: -100, y: 60 }, { x: W + 100, y: 60 }, { x: W + 100, y: H }, { x: -100, y: H }];
      drawSkyline(ctx, frame, seed * 17 + 3);
      drawSpecks(ctx, seed * 31 + 5, -100, 0, W + 100, H * 0.55, 12, 0.10);
    }
    for (const g of map.grounds) drawGround(ctx, g.verts, seed * 13 + 7);
    for (const b of map.blocks) {
      ctx.fillStyle = COLORS.bg;
      ctx.beginPath();
      ctx.roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 10);
      ctx.fill();
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    for (const a of map.arcs) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [color, width] of [[COLORS.outline, a.thick + 12], [COLORS.bg, a.thick]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        a.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }

  // ---------- cars ----------
  function drawCar(ctx, c, colors, shieldOn) {
    // wheels behind body — dark tire, player-colored hub (like the original)
    for (const w of c.wheels) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.a);
      ctx.fillStyle = '#26292d';
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.dark;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#26292d';
      ctx.fillRect(-8, -2.5, 16, 5); // hub mark so spin is visible
      ctx.restore();
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    // body offset: compound center of mass sits slightly above chassis center
    const bodyY = 4;
    // chassis
    ctx.fillStyle = colors.main;
    ctx.beginPath();
    ctx.roundRect(-46, bodyY - 15, 92, 30, 10);
    ctx.fill();
    // hood highlight + stripe
    ctx.fillStyle = colors.dark;
    ctx.beginPath();
    ctx.roundRect(-46, bodyY + 2, 92, 13, { bl: 10, br: 10, tl: 2, tr: 2 });
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.roundRect(c.dir >= 0 ? 20 : -34, bodyY - 11, 14, 6, 3);
    ctx.fill();
    // driver head
    const hx = 0, hy = bodyY - 35;
    if (!c.alive) {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 5;
      const s = 10;
      ctx.beginPath();
      ctx.moveTo(hx - s, hy - s); ctx.lineTo(hx + s, hy + s);
      ctx.moveTo(hx + s, hy - s); ctx.lineTo(hx - s, hy + s);
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.skin;
      ctx.beginPath(); ctx.arc(hx, hy, 13, 0, Math.PI * 2); ctx.fill();
      // helmet
      ctx.fillStyle = colors.main;
      ctx.beginPath(); ctx.arc(hx, hy, 15, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(hx, hy - 4, 4, 0, Math.PI * 2); ctx.fill();
      // eye
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(hx + (c.dir >= 0 ? 6 : -6), hy + 3, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    if (shieldOn) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.15 * Math.sin(performance.now() / 90);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(c.x - 78, c.y - 78, 156, 140, 30);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- particles ----------
  class Particles {
    constructor() { this.list = []; }
    smoke(x, y) {
      this.list.push({ kind: 'smoke', x, y, vx: (Math.random() - 0.5) * 0.6, vy: -0.4 - Math.random() * 0.5, r: 5 + Math.random() * 6, life: 1, decay: 0.02 });
    }
    burst(x, y, color) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
        this.list.push({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, r: 5 + Math.random() * 7, life: 1, decay: 0.016, color, rot: Math.random() * 6 });
      }
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
        this.list.push({ kind: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, r: 8 + Math.random() * 10, life: 1, decay: 0.018 });
      }
    }
    splash(x, y) {
      for (let i = 0; i < 12; i++) {
        this.list.push({ kind: 'drop', x, y, vx: (Math.random() - 0.5) * 7, vy: -3 - Math.random() * 5, r: 3 + Math.random() * 4, life: 1, decay: 0.02 });
      }
    }
    step() {
      for (const p of this.list) {
        p.x += p.vx; p.y += p.vy;
        if (p.kind !== 'smoke') p.vy += 0.18;
        else { p.r += 0.25; p.vx *= 0.98; }
        p.life -= p.decay;
        if (p.rot != null) p.rot += 0.15;
      }
      this.list = this.list.filter((p) => p.life > 0);
    }
    draw(ctx) {
      for (const p of this.list) {
        ctx.globalAlpha = Math.max(0, p.life) * 0.85;
        if (p.kind === 'smoke') {
          ctx.fillStyle = '#e8e2dc';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'drop') {
          ctx.fillStyle = '#9fd4f7';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color || '#ffd93b';
          star(ctx, p.r);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function star(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------- rain ----------
  const rain = [];
  for (let i = 0; i < 46; i++) {
    rain.push({ x: Math.random() * W, y: Math.random() * H, len: 40 + Math.random() * 70, sp: 0.35 + Math.random() * 0.5 });
  }

  // ---------- touch button layout (shared with input.js) ----------
  function buttonLayout() {
    const r = 62, m = 26, y = H - r - m;
    return [
      { player: 0, side: 'l', x: r + m, y, r, dirIcon: -1 },
      { player: 0, side: 'r', x: r * 3 + m + 34, y, r, dirIcon: 1 },
      { player: 1, side: 'l', x: W - (r * 3 + m + 34), y, r, dirIcon: -1 },
      { player: 1, side: 'r', x: W - (r + m), y, r, dirIcon: 1 },
    ];
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.particles = new Particles();
      this.lastEventId = 0;
      this.lastMid = null;
      this.banner = null; // {text, t}
      this.pressed = {};  // button visual feedback, set by input
      this.showButtons = true;
      this.localPlayers = [0, 1];
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.canvas.style.width = window.innerWidth + 'px';
      this.canvas.style.height = window.innerHeight + 'px';
      const s = Math.min(this.canvas.width / W, this.canvas.height / H);
      this.scale = s;
      this.offX = (this.canvas.width - W * s) / 2;
      this.offY = (this.canvas.height - H * s) / 2;
    }

    // map a client (CSS px) point into world coordinates — used by input.js
    toWorld(cx, cy) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return { x: (cx * dpr - this.offX) / this.scale, y: (cy * dpr - this.offY) / this.scale };
    }

    processEvents(state) {
      if (state.mid !== this.lastMid) { this.lastMid = state.mid; this.lastEventId = 0; this.particles.list = []; }
      for (const ev of state.events || []) {
        if (ev.id <= this.lastEventId) continue;
        this.lastEventId = ev.id;
        if (ev.type === 'die') {
          const color = ev.car === 0 ? COLORS.p1 : COLORS.p2;
          this.particles.burst(ev.x, ev.y, color);
          if (ev.y > state.water - 40) this.particles.splash(ev.x, state.water);
        } else if (ev.type === 'rise') {
          this.banner = { text: 'THE WATER IS RISING!', t: 2.6 };
        }
      }
    }

    draw(state, dt = 1 / 60) {
      const ctx = this.ctx;
      if (!state) return;
      this.processEvents(state);
      this.particles.step();
      if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#23272c';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);

      // background + rain
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COLORS.rain;
      for (const d of rain) {
        d.y += d.sp * 16;
        if (d.y > H + 80) { d.y = -100; d.x = Math.random() * W; }
        ctx.beginPath();
        ctx.roundRect(d.x, d.y, 9, d.len, 5);
        ctx.fill();
      }

      const map = MAPS[state.map];
      drawMapBase(ctx, map, state.map + 1);

      // planks
      state.planks.forEach((p, i) => {
        const def = map.planks[i];
        if (!def) return;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = COLORS.plank;
        ctx.beginPath();
        ctx.roundRect(-def.w / 2, -def.h / 2, def.w, def.h, def.h / 2);
        ctx.fill();
        ctx.strokeStyle = COLORS.plankEdge;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // cars + exhaust
      state.cars.forEach((c, i) => {
        if (c.drive !== 0 && c.alive && Math.random() < 0.5) {
          const back = c.wheels[c.drive > 0 ? 0 : 1];
          if (back) this.particles.smoke(back.x, back.y);
        }
        drawCar(ctx, c, i === 0 ? { main: COLORS.p1, dark: COLORS.p1d } : { main: COLORS.p2, dark: COLORS.p2d }, state.shield > 0 && state.phase !== 'over');
      });

      this.particles.draw(ctx);

      // water (drawn on top — it swallows the map as it rises)
      this.drawWater(ctx, state.water);

      // HUD
      this.drawHUD(ctx, state);

      // round transition fade
      let fade = 0;
      if (state.phase === 'point') fade = Math.min(1, Math.max(0, (state.phaseT - 1.4) / 0.8));
      else if (state.phase === 'ready') fade = Math.max(0, 1 - state.phaseT / 0.5);
      if (fade > 0) {
        // not fully opaque — the incoming map shows as a dim silhouette
        ctx.fillStyle = `rgba(15,17,20,${fade * 0.9})`;
        ctx.fillRect(-200, -200, W + 400, H + 400);
      }
    }

    drawWater(ctx, level) {
      const t = performance.now() / 1000;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-200, H + 200);
      ctx.lineTo(-200, level);
      for (let x = -200; x <= W + 200; x += 14) {
        const y = level + Math.sin(x / 46 + t * 2.2) * 5 + Math.sin(x / 21 - t * 3.1) * 3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 200, H + 200);
      ctx.closePath();
      ctx.fillStyle = COLORS.water;
      ctx.globalAlpha = 0.96;
      ctx.fill();
      ctx.clip();
      // lighter crest band
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = COLORS.waterTop;
      ctx.fillRect(-200, level - 10, W + 400, 26);
      // deep band + drifting dashes
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.waterDeep;
      ctx.fillRect(-200, Math.max(level + 90, H - 60), W + 400, 300);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let i = 0; i < 14; i++) {
        const x = ((i * 260 + t * 40) % (W + 400)) - 200;
        const y = level + 34 + (i % 4) * 26;
        ctx.beginPath();
        ctx.roundRect(x, y, 46, 8, 4);
        ctx.fill();
      }
      ctx.restore();
    }

    drawHUD(ctx, state) {
      // score bubble — white circle hanging from the top center
      ctx.save();
      ctx.translate(W / 2, -14);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 64, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 36px "Arial Rounded MT Bold", "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.p1;
      ctx.fillText(state.scores[0], -20, 30);
      ctx.fillStyle = '#333';
      ctx.fillText('·', 0, 27);
      ctx.fillStyle = COLORS.p2;
      ctx.fillText(state.scores[1], 20, 30);
      ctx.restore();

      // ready countdown
      if (state.phase === 'ready') {
        ctx.font = 'bold 64px "Arial Rounded MT Bold", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText('GET READY', W / 2, 200);
      }

      // banner (water rising)
      if (this.banner) {
        ctx.font = 'bold 52px "Arial Rounded MT Bold", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(159,216,247,${Math.min(1, this.banner.t)})`;
        ctx.fillText(this.banner.text, W / 2, 170);
      }

      // touch buttons
      if (this.showButtons) {
        for (const b of buttonLayout()) {
          if (!this.localPlayers.includes(b.player)) continue;
          const col = b.player === 0 ? COLORS.p1 : COLORS.p2;
          const pressed = this.pressed[b.player + b.side];
          ctx.globalAlpha = pressed ? 1 : 0.9;
          // solid colored disc with a fat black rim + chevron (like the original)
          ctx.fillStyle = '#101215';
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = pressed ? '#fff' : col;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 9, 0, Math.PI * 2); ctx.fill();
          // chevron
          ctx.strokeStyle = '#101215';
          ctx.lineWidth = 14;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          const d = b.dirIcon, s = 17;
          ctx.beginPath();
          ctx.moveTo(b.x - d * s * 0.5, b.y - s);
          ctx.lineTo(b.x + d * s * 0.7, b.y);
          ctx.lineTo(b.x - d * s * 0.5, b.y + s);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  window.CrashRender = { Renderer, buttonLayout, COLORS };
})();
