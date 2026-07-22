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
    // 1 — asymmetric open-topped pocket, one horizontal seesaw
    M({
      name: 'Cloud Plank',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 120, y: 410 }, { x: 280, y: 478 }, { x: 450, y: 535 }, { x: 650, y: 566 },
           { x: 820, y: 575 }, { x: 1010, y: 554 }, { x: 1190, y: 505 }, { x: 1400, y: 400 }],
          [{ x: 120, y: 410 }, { x: 70, y: 300 }, { x: 145, y: 190 }, { x: 310, y: 132 },
           { x: 430, y: 150 }, { x: 515, y: -35 }, { x: 1080, y: -35 }, { x: 1175, y: 122 },
           { x: 1305, y: 122 }, { x: 1480, y: 245 }, { x: 1400, y: 400 }]),
      },
      planks: [{ x: 800, y: 330, w: 460, h: 42, angle: 0 }],
      spawns: [{ x: 500, y: 540, dir: 1 }, { x: 1100, y: 540, dir: -1 }],
    }),

    // 2 — compact pinched bean pocket
    M({
      name: 'The Divot',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: 250, y: 452 }, { x: 350, y: 524 }, { x: 560, y: 558 }, { x: 720, y: 535 },
           { x: 800, y: 580 }, { x: 880, y: 535 }, { x: 1040, y: 558 }, { x: 1250, y: 524 }, { x: 1350, y: 452 }],
          [{ x: 250, y: 452 }, { x: 310, y: 365 }, { x: 470, y: 300 }, { x: 670, y: 292 },
           { x: 735, y: 236 }, { x: 800, y: 105 }, { x: 865, y: 236 }, { x: 930, y: 292 },
           { x: 1130, y: 300 }, { x: 1290, y: 365 }, { x: 1350, y: 452 }]),
      },
      spawns: [{ x: 470, y: 500, dir: 1 }, { x: 1130, y: 500, dir: -1 }],
    }),

    // 3 — the reference's broad S-shaped asphalt shelf and center seesaw
    M({
      name: 'Grand Valley',
      sky: { kind: 'open' },
      grounds: [{ verts: curve([
        { x: -80, y: 392 }, { x: 210, y: 372 }, { x: 390, y: 430 }, { x: 565, y: 555 },
        { x: 760, y: 682 }, { x: 910, y: 640 }, { x: 1080, y: 508 }, { x: 1260, y: 374 },
        { x: 1680, y: 382 }, { x: 1680, y: 1100 }, { x: -80, y: 1100 }, { x: -80, y: 392 },
      ], 8) }],
      planks: [{ x: 800, y: 430, w: 560, h: 42, angle: 0 }],
      spawns: [{ x: 420, y: 390, dir: 1 }, { x: 1210, y: 340, dir: -1 }],
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

    // 8 — long S-pocket with two independent seesaws
    M({
      name: 'Twin Seesaws',
      sky: { kind: 'window', verts: pocket(
        [{ x: -80, y: 352 }, { x: 180, y: 470 }, { x: 355, y: 618 }, { x: 525, y: 686 },
         { x: 700, y: 620 }, { x: 860, y: 486 }, { x: 1040, y: 396 }, { x: 1240, y: 432 },
         { x: 1450, y: 590 }, { x: 1680, y: 646 }],
        [{ x: -80, y: 352 }, { x: 140, y: 265 }, { x: 325, y: 120 }, { x: 510, y: 18 },
         { x: 800, y: -42 }, { x: 1090, y: 18 }, { x: 1280, y: 135 }, { x: 1435, y: 270 },
         { x: 1680, y: 646 }], 8) },
      planks: [
        { x: 470, y: 368, w: 430, h: 42, angle: 0, spring: 0.0007 },
        { x: 1115, y: 350, w: 430, h: 42, angle: 0, spring: 0.0007 },
      ],
      spawns: [{ x: 470, y: 320, dir: 1 }, { x: 1115, y: 302, dir: -1 }],
    }),

    // 9 — opposing asphalt banks leave the narrow center brawl channel
    M({
      name: 'The Gap',
      sky: { kind: 'open' },
      grounds: [
        { verts: curve([{ x: -80, y: -80 }, { x: 1680, y: -80 }, { x: 1680, y: 194 },
          { x: 1260, y: 186 }, { x: 1030, y: 202 }, { x: 930, y: 254 }, { x: 820, y: 245 },
          { x: 690, y: 196 }, { x: 420, y: 198 }, { x: -80, y: 210 }, { x: -80, y: -80 }], 6) },
        { verts: curve([{ x: -80, y: 682 }, { x: 330, y: 688 }, { x: 550, y: 664 }, { x: 690, y: 610 },
          { x: 800, y: 596 }, { x: 910, y: 610 }, { x: 1050, y: 664 }, { x: 1270, y: 688 },
          { x: 1680, y: 682 }, { x: 1680, y: 1100 }, { x: -80, y: 1100 }, { x: -80, y: 682 }], 6) },
      ],
      spawns: [{ x: 540, y: 620, dir: 1 }, { x: 1060, y: 620, dir: -1 }],
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

    // 11 — steep, lopsided S-pit from the reference set
    M({
      name: 'The Pit',
      sky: {
        kind: 'window',
        verts: pocket(
          [{ x: -80, y: 350 }, { x: 210, y: 410 }, { x: 410, y: 538 }, { x: 590, y: 638 },
           { x: 770, y: 684 }, { x: 930, y: 650 }, { x: 1085, y: 540 }, { x: 1250, y: 405 },
           { x: 1450, y: 360 }, { x: 1680, y: 390 }],
          [{ x: -80, y: 350 }, { x: 180, y: 260 }, { x: 350, y: 105 }, { x: 570, y: 42 },
           { x: 790, y: 120 }, { x: 930, y: 205 }, { x: 1110, y: 150 }, { x: 1280, y: 72 },
           { x: 1500, y: 150 }, { x: 1680, y: 390 }]),
      },
      spawns: [{ x: 430, y: 510, dir: 1 }, { x: 1170, y: 475, dir: -1 }],
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
