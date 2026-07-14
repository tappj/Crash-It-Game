// Crash It — map pool (shared by physics sim and renderer, works in browser + node)
//
// Terrain model (matches the original game): the dark charcoal is the solid
// terrain mass and the pink shape is a SKY WINDOW carved into it — cars live
// INSIDE that pocket and drive along its lower boundary (they can ride the
// inside walls too). Open-sky maps instead place dark ground masses in a
// full-screen pink sky.
//
// Map fields:
//   sky:    { kind: 'window', verts } — pocket polygon (pink, cars inside)
//           { kind: 'open' }          — full pink sky
//   grounds:[{ verts }]               — dark solid masses (cars ride outside)
//   blocks: [{ x, y, w, h }]          — floating dark rounded blocks
//   arcs:   [{ pts, thick }]          — thick stroked bands (bowls, platforms)
//   planks: [{ x, y, w, h, angle }]   — free-spinning seesaws (center pivot)
//   spawns: [{ x, y, dir }]           — snapped down onto the surface below
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CrashMaps = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const W = 1600, H = 900;
  const WATER_BASE = 828;

  // ---- geometry helpers -------------------------------------------------

  // Catmull-Rom through control points → dense polyline (smooth drivable curves)
  function curve(pts, res = 10) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
      const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let j = 0; j < res; j++) {
        const t = j / res, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // pocket window: smooth floor (left→right) + smooth ceiling arch (left→right).
  // The floor gets dense sampling (cars drive on it); the ceiling can be coarser.
  function pocket(floorPts, topPts, res = 8) {
    return curve(floorPts, res).concat(curve(topPts, 4).reverse());
  }

  // closed superellipse (k=2 ellipse … higher = boxier capsule)
  function capsule(cx, cy, rx, ry, k = 3, n = 56) {
    const verts = [];
    const e = 2 / k;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      verts.push({
        x: cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e),
        y: cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e),
      });
    }
    return verts;
  }

  // puffy cloud ceiling from (x0,y0) over the top and down to (x1,y0)
  function cloudTop(x0, x1, y0, ry, puffs = 3, phase = 0.6) {
    const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2;
    const pts = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const th = Math.PI - (i / n) * Math.PI; // left → right over the top
      const s = Math.sin(th);
      const puff = 1 + 0.12 * Math.abs(Math.sin(puffs * th + phase)) * s;
      pts.push({ x: cx + rx * Math.cos(th), y: y0 - ry * s * puff });
    }
    return pts;
  }

  // open arc polyline (half-pipe bowls): θ in radians, y-down screen coords
  function arcPts(cx, cy, r, a0, a1, n = 22) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  const M = (def) => Object.assign({ grounds: [], blocks: [], arcs: [], planks: [], spawns: [] }, def);

  // ---- the 13 maps (maps/map1.png … map13.png) ---------------------------

  const MAPS = [
    // 1 — wide cloud pocket, one horizontal seesaw floating mid-air
    M({
      name: 'Cloud Plank',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 210, y: 470 }, { x: 320, y: 545 }, { x: 520, y: 600 }, { x: 800, y: 622 },
           { x: 1080, y: 600 }, { x: 1280, y: 545 }, { x: 1390, y: 470 }],
          cloudTop(210, 1390, 470, 430, 3, 0.7)),
      },
      planks: [{ x: 800, y: 330, w: 460, h: 42, angle: 0 }],
      spawns: [{ x: 500, y: 540, dir: 1 }, { x: 1100, y: 540, dir: -1 }],
    }),

    // 2 — smaller cloud pocket, flat floor with a fighting divot in the middle
    M({
      name: 'The Divot',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 300, y: 480 }, { x: 430, y: 520 }, { x: 600, y: 528 }, { x: 700, y: 535 },
           { x: 760, y: 558 }, { x: 800, y: 566 }, { x: 840, y: 558 }, { x: 900, y: 535 },
           { x: 1000, y: 528 }, { x: 1170, y: 520 }, { x: 1300, y: 480 }],
          cloudTop(300, 1300, 480, 420, 4, 1.9)),
      },
      spawns: [{ x: 470, y: 500, dir: 1 }, { x: 1130, y: 500, dir: -1 }],
    }),

    // 3 — huge valley reaching off the top of the screen, big seesaw in the air
    M({
      name: 'Grand Valley',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 120, y: 300 }, { x: 260, y: 330 }, { x: 420, y: 470 }, { x: 560, y: 620 },
           { x: 700, y: 720 }, { x: 800, y: 745 }, { x: 900, y: 720 }, { x: 1040, y: 620 },
           { x: 1180, y: 470 }, { x: 1340, y: 330 }, { x: 1480, y: 300 }],
          [{ x: 120, y: 300 }, { x: 70, y: 150 }, { x: 160, y: 10 }, { x: 450, y: -40 },
           { x: 800, y: -50 }, { x: 1150, y: -40 }, { x: 1440, y: 10 }, { x: 1530, y: 150 }, { x: 1480, y: 300 }]),
      },
      planks: [{ x: 800, y: 430, w: 560, h: 42, angle: 0 }],
      spawns: [{ x: 630, y: 395, dir: 1 }, { x: 970, y: 395, dir: -1 }],
    }),

    // 4 — big capsule pocket, seesaw floating in the upper half
    M({
      name: 'Capsule Seesaw',
      sky: { kind: 'window', verts: capsule(800, 400, 560, 350, 3) },
      planks: [{ x: 800, y: 295, w: 500, h: 42, angle: 0 }],
      spawns: [{ x: 600, y: 660, dir: 1 }, { x: 1000, y: 660, dir: -1 }],
    }),

    // 5 — two floating half-pipe bowls over open water, block hanging between
    M({
      name: 'Half-Pipes',
      sky: { kind: 'open' },
      arcs: [
        { pts: arcPts(420, 430, 240, Math.PI + 0.35, -0.35), thick: 46 },
        { pts: arcPts(1180, 430, 240, Math.PI + 0.35, -0.35), thick: 46 },
      ],
      blocks: [{ x: 800, y: 200, w: 340, h: 60 }],
      spawns: [{ x: 420, y: 560, dir: 1 }, { x: 1180, y: 560, dir: -1 }],
    }),

    // 6 — dark asphalt island, two shallow dips around a center hump
    M({
      name: 'Asphalt Isle',
      sky: { kind: 'open' },
      grounds: [{
        verts: curve([
          { x: 180, y: 470 }, { x: 290, y: 452 }, { x: 420, y: 470 }, { x: 560, y: 540 },
          { x: 690, y: 562 }, { x: 800, y: 520 }, { x: 910, y: 562 }, { x: 1040, y: 540 },
          { x: 1180, y: 470 }, { x: 1310, y: 452 }, { x: 1420, y: 470 },
          { x: 1505, y: 565 }, { x: 1440, y: 705 }, { x: 1180, y: 795 }, { x: 800, y: 832 },
          { x: 420, y: 795 }, { x: 160, y: 705 }, { x: 95, y: 565 }, { x: 180, y: 470 },
        ], 6),
      }],
      spawns: [{ x: 310, y: 420, dir: 1 }, { x: 1290, y: 420, dir: -1 }],
    }),

    // 7 — one huge oval pocket: the whole inside wall is rideable
    M({
      name: 'The Oval',
      sky: { kind: 'window', verts: capsule(800, 430, 620, 385, 2.4) },
      spawns: [{ x: 620, y: 700, dir: 1 }, { x: 980, y: 700, dir: -1 }],
    }),

    // 8 — open sky: two seesaws over a bumpy full-width ground, hanging corners
    M({
      name: 'Twin Seesaws',
      sky: { kind: 'open' },
      grounds: [
        { verts: curve([
            { x: -60, y: 620 }, { x: 200, y: 648 }, { x: 360, y: 612 }, { x: 520, y: 652 },
            { x: 680, y: 618 }, { x: 800, y: 658 }, { x: 920, y: 618 }, { x: 1080, y: 652 },
            { x: 1240, y: 612 }, { x: 1400, y: 648 }, { x: 1660, y: 620 },
            { x: 1660, y: 1100 }, { x: -60, y: 1100 }, { x: -60, y: 620 },
          ], 6) },
        { verts: curve([
            { x: -60, y: -80 }, { x: 300, y: -80 }, { x: 262, y: 55 }, { x: 160, y: 128 },
            { x: 30, y: 148 }, { x: -60, y: 110 }, { x: -60, y: -80 },
          ], 6) },
        { verts: curve([
            { x: 1660, y: -80 }, { x: 1300, y: -80 }, { x: 1338, y: 55 }, { x: 1440, y: 128 },
            { x: 1570, y: 148 }, { x: 1660, y: 110 }, { x: 1660, y: -80 },
          ], 6) },
      ],
      planks: [
        { x: 430, y: 390, w: 480, h: 42, angle: -0.08 },
        { x: 1170, y: 390, w: 480, h: 42, angle: 0.08 },
      ],
      spawns: [{ x: 430, y: 350, dir: 1 }, { x: 1170, y: 350, dir: -1 }],
    }),

    // 9 — two flat plateaus with a deep rounded gap (and a small mound) between
    M({
      name: 'The Gap',
      sky: { kind: 'open' },
      grounds: [{
        verts: curve([
          { x: -60, y: 445 }, { x: 240, y: 432 }, { x: 480, y: 442 }, { x: 580, y: 472 },
          { x: 660, y: 565 }, { x: 725, y: 645 }, { x: 800, y: 602 }, { x: 875, y: 645 },
          { x: 940, y: 565 }, { x: 1020, y: 472 }, { x: 1120, y: 442 }, { x: 1360, y: 432 },
          { x: 1660, y: 445 }, { x: 1660, y: 1100 }, { x: -60, y: 1100 }, { x: -60, y: 445 },
        ], 6),
      }],
      spawns: [{ x: 280, y: 390, dir: 1 }, { x: 1320, y: 390, dir: -1 }],
    }),

    // 10 — pinched bean pocket with a saddle floor and two floating blocks
    M({
      name: 'Bean Blocks',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 240, y: 480 }, { x: 340, y: 560 }, { x: 500, y: 592 }, { x: 660, y: 562 },
           { x: 800, y: 528 }, { x: 940, y: 562 }, { x: 1100, y: 592 }, { x: 1260, y: 560 }, { x: 1360, y: 480 }],
          [{ x: 240, y: 480 }, { x: 175, y: 320 }, { x: 285, y: 155 }, { x: 465, y: 90 },
           { x: 645, y: 145 }, { x: 800, y: 235 }, { x: 955, y: 145 }, { x: 1135, y: 90 },
           { x: 1315, y: 155 }, { x: 1425, y: 320 }, { x: 1360, y: 480 }]),
      },
      blocks: [{ x: 500, y: 285, w: 260, h: 82 }, { x: 985, y: 445, w: 260, h: 82 }],
      spawns: [{ x: 400, y: 555, dir: 1 }, { x: 1200, y: 555, dir: -1 }],
    }),

    // 11 — one giant smooth brawl pit, everything rolls to the middle
    M({
      name: 'The Pit',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 150, y: 380 }, { x: 295, y: 462 }, { x: 425, y: 578 }, { x: 555, y: 655 },
           { x: 695, y: 712 }, { x: 800, y: 726 }, { x: 905, y: 712 }, { x: 1045, y: 655 },
           { x: 1175, y: 578 }, { x: 1305, y: 462 }, { x: 1450, y: 380 }],
          [{ x: 150, y: 380 }, { x: 90, y: 220 }, { x: 200, y: 55 }, { x: 500, y: -25 },
           { x: 800, y: -35 }, { x: 1100, y: -25 }, { x: 1400, y: 55 }, { x: 1510, y: 220 }, { x: 1450, y: 380 }]),
      },
      spawns: [{ x: 430, y: 545, dir: 1 }, { x: 1170, y: 545, dir: -1 }],
    }),

    // 12 — wide oval pocket with a thick "smile" arc platform hanging mid-air
    M({
      name: 'Smile Arc',
      sky: { kind: 'window', verts: capsule(800, 430, 630, 375, 2.6) },
      arcs: [{
        pts: curve([
          { x: 470, y: 296 }, { x: 610, y: 344 }, { x: 800, y: 366 },
          { x: 990, y: 344 }, { x: 1130, y: 296 }], 8),
        thick: 52,
      }],
      spawns: [{ x: 580, y: 700, dir: 1 }, { x: 1020, y: 700, dir: -1 }],
    }),

    // 13 — asphalt island with camel-hump bumps between two flat shoulders
    M({
      name: 'Asphalt Bumps',
      sky: { kind: 'open' },
      grounds: [{
        verts: curve([
          { x: 140, y: 450 }, { x: 300, y: 438 }, { x: 460, y: 455 }, { x: 560, y: 520 },
          { x: 640, y: 558 }, { x: 720, y: 528 }, { x: 800, y: 558 }, { x: 880, y: 528 },
          { x: 960, y: 558 }, { x: 1040, y: 520 }, { x: 1140, y: 455 }, { x: 1300, y: 438 },
          { x: 1460, y: 450 }, { x: 1540, y: 560 }, { x: 1460, y: 715 }, { x: 1180, y: 800 },
          { x: 800, y: 838 }, { x: 420, y: 800 }, { x: 140, y: 715 }, { x: 60, y: 560 }, { x: 140, y: 450 },
        ], 6),
      }],
      spawns: [{ x: 290, y: 400, dir: 1 }, { x: 1310, y: 400, dir: -1 }],
    }),
  ];

  return { W, H, WATER_BASE, MAPS };
});
