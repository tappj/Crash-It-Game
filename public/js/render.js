// Crash It — canvas renderer. Draws entirely from a plain state snapshot,
// so it works identically for the local sim (host) and network replicas (guest).
//
// Performance: the static map base (background, specks, sky window, skyline,
// grounds, blocks, arcs) is rasterized ONCE per map into an offscreen canvas
// and blitted each frame; only cars, planks, particles, water and HUD are
// redrawn live.
(function () {
  const { W, H, MAPS } = CrashMaps;

  const COLORS = {
    bg: '#3f4851',          // solid terrain slate (fills everything outside the sky window)
    speck: 'rgba(0,0,0,0.18)',
    sky: '#ffc3be',         // the pink sky visible through the window
    outline: '#000000',
    skyline: ['#cc97a6', '#c095a5', '#b28ba0', '#ae8698'],
    cream: '#ffe3c9',
    plank: '#aa5942',
    pivot: '#404952',
    waterTop: '#0086ec',
    waterDeep: '#005ba3',
    stripe: '#ffbc3f',
    stripeEdge: '#ea842b',
    p1: '#ff5f57', p1d: '#c71417',
    p2: '#00c3f0', p2d: '#0074b5',
    skin: '#f7c9a2',
  };

  // per-player car/button palettes (sampled from the original art)
  const CARS = [
    { main: '#ff5f57', low: '#9e3a35', wheel: '#cb1616', hub: '#7e1010', dim: '#d96964' },
    { main: '#00c3f0', low: '#00748e', wheel: '#0081c3', hub: '#00587e', dim: '#009fc2' },
  ];

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

  // flat pastel city skyline clipped inside an island shape — two layers of
  // buildings with darker vertical slit windows, occasional cream accent block
  function drawSkyline(ctx, verts, seed) {
    const b = bounds(verts);
    const rnd = mulberry32(seed);
    ctx.save();
    smoothPath(ctx, verts);
    ctx.clip();
    // back row: tall, lighter; front row: shorter, darker — sparse enough
    // that plenty of pink sky stays visible above the roofline
    const rows = [
      { hMin: 0.35, hMax: 0.72, cols: ['#cc97a6', '#c095a5'] },
      { hMin: 0.18, hMax: 0.45, cols: ['#b28ba0', '#ae8698'] },
    ];
    for (const row of rows) {
      let x = b.x0 - 30, ci = 0;
      while (x < b.x1 + 30) {
        const bw = 90 + rnd() * 150;
        const bh = (b.y1 - b.y0) * (row.hMin + rnd() * (row.hMax - row.hMin));
        const by = b.y1 + 40 - bh;
        ctx.fillStyle = rnd() < 0.1 ? COLORS.cream : row.cols[ci++ % row.cols.length];
        ctx.fillRect(x, by, bw, bh + 40);
        // darker slit windows in vertical columns
        ctx.fillStyle = 'rgba(60,20,40,0.10)';
        for (let wx = x + 18; wx < x + bw - 26; wx += 42) {
          let wy = by + 18 + rnd() * 34;
          while (wy < b.y1 - 26) {
            const wh = 34 + rnd() * 70;
            if (rnd() < 0.7) ctx.fillRect(wx, wy, 13, wh);
            wy += wh + 20;
          }
        }
        x += bw + 14 + rnd() * 60;
      }
    }
    ctx.restore();
  }

  // scattered dark rounded bars (drifting cloud specks) — used on the slate
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
      // slate terrain fills the screen (already painted as bg) + specks
      drawSpecks(ctx, seed * 31 + 5, -300, -100, W + 300, H + 100, 26, 0.16);
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
      ctx.fillRect(-300, -100, W + 600, H + 200);
      const frame = [{ x: -300, y: 60 }, { x: W + 300, y: 60 }, { x: W + 300, y: H }, { x: -300, y: H }];
      drawSkyline(ctx, frame, seed * 17 + 3);
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
  function drawCar(ctx, c, pal, shieldOn) {
    const d = c.dir >= 0 ? 1 : -1;
    // wheels behind body — black tire, bright colored ring, dark hub
    for (const w of c.wheels) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.a);
      ctx.fillStyle = '#0d0f14';
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.wheel;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(-10, -2.5, 20, 5); // hub mark so spin is visible
      ctx.fillStyle = pal.hub;
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    // body offset: compound center of mass sits slightly above chassis center
    const bodyY = 4;
    const hx = 0, hy = bodyY - 35;

    // driver behind windshield (under the body outline)
    if (c.alive) {
      // helmet — player color with black outline + grey visor at the front
      ctx.fillStyle = pal.main;
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(hx, hy, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.arc(hx, hy, 13, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#7f6f78';
      ctx.beginPath();
      ctx.ellipse(hx + d * 10, hy + 2, 4.5, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // visor shine
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(hx - d * 4, hy - 6, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // raised cockpit cowl connecting the driver to the body
    ctx.fillStyle = pal.main;
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(d > 0 ? -30 : -14, bodyY - 27, 44, 20, 8);
    ctx.fill(); ctx.stroke();

    // exhaust nub at the back
    ctx.fillStyle = '#2e343b';
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-d * 46 - (d > 0 ? 8 : 0), bodyY - 6, 8, 10, 3);
    ctx.fill(); ctx.stroke();
    // headlight nub at the front
    ctx.fillStyle = COLORS.stripe;
    ctx.beginPath();
    ctx.roundRect(d * 46 - (d > 0 ? 0 : 7), bodyY - 8, 7, 12, 3);
    ctx.fill(); ctx.stroke();

    // chassis — main color, yellow stripe, darker rocker panel, black outline
    ctx.beginPath();
    ctx.roundRect(-46, bodyY - 15, 92, 30, 12);
    ctx.fillStyle = pal.main;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = pal.low;
    ctx.fillRect(-46, bodyY + 8, 92, 10);
    ctx.fillStyle = COLORS.stripe;
    ctx.fillRect(-46, bodyY + 1, 92, 7);
    ctx.fillStyle = COLORS.stripeEdge;
    ctx.fillRect(-46, bodyY + 6, 92, 2.5);
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(-46, bodyY - 15, 92, 30, 12);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 4.5;
    ctx.stroke();

    // windshield — small white bar in front of the driver
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(d * 17 - 3, bodyY - 34, 6, 19, 3);
    ctx.fill(); ctx.stroke();

    // dead marker
    if (!c.alive) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 5;
      const s = 10;
      ctx.beginPath();
      ctx.moveTo(hx - s, hy - s); ctx.lineTo(hx + s, hy + s);
      ctx.moveTo(hx + s, hy - s); ctx.lineTo(hx - s, hy + s);
      ctx.stroke();
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
          ctx.fillStyle = '#8a8580';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'drop') {
          ctx.fillStyle = '#5eb1f5';
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
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.particles = new Particles();
      this.lastEventId = 0;
      this.lastMid = null;
      this.banner = null; // {text, t}
      this.pressed = {};  // button visual feedback, set by input
      this.showButtons = true;
      this.localPlayers = [0, 1];
      // offscreen cache of the static map base — rebuilt on map change / resize
      this.base = document.createElement('canvas');
      this.baseMap = -1;
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
      this.baseMap = -1; // invalidate the static-base cache
    }

    // map a client (CSS px) point into world coordinates — used by input.js
    toWorld(cx, cy) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return { x: (cx * dpr - this.offX) / this.scale, y: (cy * dpr - this.offY) / this.scale };
    }

    // rasterize the static map base once; per-frame drawing just blits it
    ensureBase(mapIdx) {
      if (this.baseMap === mapIdx &&
          this.base.width === this.canvas.width &&
          this.base.height === this.canvas.height) return;
      this.base.width = this.canvas.width;
      this.base.height = this.canvas.height;
      const b = this.base.getContext('2d', { alpha: false });
      b.fillStyle = COLORS.bg;
      b.fillRect(0, 0, this.base.width, this.base.height);
      b.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
      drawMapBase(b, MAPS[mapIdx], mapIdx + 1);
      this.baseMap = mapIdx;
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

      // static map base from the offscreen cache
      this.ensureBase(state.map);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.base, 0, 0);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);

      const map = MAPS[state.map];

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
        ctx.strokeStyle = COLORS.outline;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // cars + exhaust
      state.cars.forEach((c, i) => {
        if (c.drive !== 0 && c.alive && Math.random() < 0.5) {
          const back = c.wheels[c.drive > 0 ? 0 : 1];
          if (back) this.particles.smoke(back.x, back.y);
        }
        drawCar(ctx, c, CARS[i], state.shield > 0 && state.phase !== 'over');
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

    // two-tone water: bright blue wavy band over a deeper navy layer
    drawWater(ctx, level) {
      const t = performance.now() / 1000;
      const layers = [
        { y: level, color: COLORS.waterTop, phase: 0 },
        { y: level + 24, color: COLORS.waterDeep, phase: 2.1 },
      ];
      for (const l of layers) {
        ctx.beginPath();
        ctx.moveTo(-300, H + 200);
        ctx.lineTo(-300, l.y);
        for (let x = -300; x <= W + 300; x += 16) {
          const y = l.y + Math.sin(x / 34 + t * 1.6 + l.phase) * 6 + Math.sin(x / 61 - t * 2.2 + l.phase) * 4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W + 300, H + 200);
        ctx.closePath();
        ctx.fillStyle = l.color;
        ctx.fill();
      }
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

      // touch buttons — thick black ring, colored disc (bright when pressed,
      // dimmed otherwise), chunky black chevron
      if (this.showButtons) {
        for (const b of buttonLayout()) {
          if (!this.localPlayers.includes(b.player)) continue;
          const pal = CARS[b.player];
          const pressed = this.pressed[b.player + b.side];
          ctx.fillStyle = '#000000';
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = pressed ? pal.main : pal.dim;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 10, 0, Math.PI * 2); ctx.fill();
          // chevron
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 16;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          const d = b.dirIcon, s = 18;
          ctx.beginPath();
          ctx.moveTo(b.x - d * s * 0.5, b.y - s);
          ctx.lineTo(b.x + d * s * 0.7, b.y);
          ctx.lineTo(b.x - d * s * 0.5, b.y + s);
          ctx.stroke();
        }
      }
    }
  }

  window.CrashRender = { Renderer, buttonLayout, COLORS };
})();
