// Crash It — authoritative match simulation (browser + node)
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('matter-js'), require('poly-decomp'), require('./maps.js'));
  } else {
    root.CrashGame = factory(root.Matter, root.decomp, root.CrashMaps);
  }
})(typeof self !== 'undefined' ? self : this, function (Matter, decomp, CrashMaps) {

  const { Engine, Bodies, Body, Composite, Constraint, Events, Common } = Matter;
  const { W, H, WATER_BASE, MAPS } = CrashMaps;

  if (decomp && Common.setDecomp) Common.setDecomp(decomp);

  const CFG = {
    gravity: 1.42,
    wheelAV: 0.76,        // target wheel spin (rad/step-ish)
    wheelAccel: 0.038,
    airWheelAccel: 0.024,
    coastBrake: 0.28,
    airSpin: 0.0065,      // button-held body spin assist while airborne
    maxBodyAV: 0.36,
    shieldTime: 1.8,      // spawn protection seconds
    readyTime: 1.0,
    pointTime: 2.2,       // pause after a kill before next round
    riseStart: 60,        // seconds until water rises
    riseSpeed: 20,        // px/sec
    waterMin: 120,
    winScore: 5,
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  class Match {
    constructor() {
      this.scores = [0, 0];
      this.mid = (Math.random() * 1e9) | 0;
      this.eventId = 0;
      this.events = [];
      this.winner = null;
      this.usedMaps = [];
      this.startRound(this.pickMap());
    }

    pickMap() {
      // avoid repeating the previous map
      let i;
      do { i = (Math.random() * MAPS.length) | 0; } while (MAPS.length > 1 && i === this.mapIndex);
      return i;
    }

    pushEvent(type, extra) {
      this.events.push(Object.assign({ id: ++this.eventId, type }, extra || {}));
      if (this.events.length > 10) this.events.splice(0, this.events.length - 10);
    }

    startRound(mapIndex) {
      this.mapIndex = mapIndex;
      const map = MAPS[mapIndex];
      this.engine = Engine.create();
      this.engine.gravity.y = CFG.gravity;
      this.water = WATER_BASE;
      this.playT = 0;
      this.phase = 'ready';
      this.phaseT = 0;
      this.shield = CFG.shieldTime;
      this.risingAnnounced = false;
      this.pendingDeaths = new Set();

      // terrain — chains of static wall segments along each outline, so the
      // collision surface matches the drawn shape exactly (no decomposition).
      // Sky-window pockets collide from the inside (walls extend outward),
      // ground masses from the outside (walls extend inward).
      if (map.sky.kind === 'window') this.addOutline(map.sky.verts, true);
      for (const g of map.grounds) this.addOutline(g.verts, false);
      for (const b of map.blocks) {
        Composite.add(this.engine.world, Bodies.rectangle(b.x, b.y, b.w, b.h, {
          isStatic: true, chamfer: { radius: 10 }, friction: 1.0, restitution: 0, label: 'terrain',
        }));
      }
      for (const a of map.arcs) this.addBand(a.pts, a.thick);

      // planks (free-spinning seesaws pinned at their centers)
      this.planks = [];
      for (const p of map.planks) {
        const plank = Bodies.rectangle(p.x, p.y, p.w, p.h, {
          chamfer: { radius: 12 }, density: 0.004, friction: 0.9,
          frictionAir: 0.028, label: 'plank',
        });
        Body.setAngle(plank, p.angle);
        const pivot = Constraint.create({
          pointA: { x: p.x, y: p.y }, bodyB: plank, pointB: { x: 0, y: 0 },
          length: 0, stiffness: 0.92,
        });
        plank.springK = p.spring || 0; // optional self-centering (sumo plank)
        Composite.add(this.engine.world, [plank, pivot]);
        this.planks.push(plank);
      }

      // These are the only surfaces that can put a car "on the ground".
      // Keeping this set before the cars are added avoids counting a car's
      // own wheels/body as drive contact.
      this.driveSurfaces = Composite.allBodies(this.engine.world);

      // cars — snap each spawn onto the surface below it so cars don't
      // drop-bounce or land on a slope shoulder
      const statics = Composite.allBodies(this.engine.world).filter((b) => b.isStatic || b.label === 'plank');
      this.cars = map.spawns.map((s, i) => {
        let y = s.y;
        for (let yy = Math.max(60, s.y - 60); yy < H; yy += 4) {
          if (Matter.Query.point(statics, { x: s.x, y: yy }).length) { y = yy - 35; break; }
        }
        return this.createCar(i, { x: s.x, y, dir: s.dir });
      });

      // collisionActive too: a touch that begins under the spawn shield and
      // persists after it expires must still count as a head hit
      Events.on(this.engine, 'collisionStart', (ev) => this.onCollisions(ev));
      Events.on(this.engine, 'collisionActive', (ev) => this.onCollisions(ev));
    }

    // static wall chain along a closed outline. wallsOutside=true keeps the
    // playable side INSIDE the polygon (sky windows); false keeps it outside
    // (ground masses). Each wall's inner face passes through both vertices.
    addOutline(verts, wallsOutside) {
      const THICK = 60;
      const inside = (x, y) => {
        let inPoly = false;
        for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
          const a = verts[i], b = verts[j];
          if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inPoly = !inPoly;
        }
        return inPoly;
      };
      const walls = [];
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i], b = verts[(i + 1) % verts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;
        let nx = dy / len, ny = -dx / len;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // the wall body sits away from the play area
        if (inside(mx + nx * 3, my + ny * 3) === wallsOutside) { nx = -nx; ny = -ny; }
        walls.push(Bodies.rectangle(mx + (nx * THICK) / 2, my + (ny * THICK) / 2, len + THICK * 0.7, THICK, {
          isStatic: true, angle: Math.atan2(dy, dx), friction: 1.0, restitution: 0, label: 'terrain',
        }));
      }
      Composite.add(this.engine.world, walls);
    }

    // thick collision band centered on an open polyline (half-pipes, arcs)
    addBand(pts, thick) {
      const walls = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;
        walls.push(Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + thick * 0.4, thick, {
          isStatic: true, angle: Math.atan2(dy, dx), friction: 1.0, restitution: 0, label: 'terrain',
        }));
      }
      for (const p of [pts[0], pts[pts.length - 1]]) {
        walls.push(Bodies.circle(p.x, p.y, thick / 2, {
          isStatic: true, friction: 1.0, restitution: 0, label: 'terrain',
        }));
      }
      Composite.add(this.engine.world, walls);
    }

    createCar(i, spawn) {
      const { x, y, dir } = spawn;
      const group = Body.nextGroup(true);
      const chassis = Bodies.rectangle(x, y, 92, 30, {
        chamfer: { radius: 10 }, density: 0.0012, label: 'chassis' + i,
      });
      const head = Bodies.circle(x, y - 31, 15, { density: 0.0008, label: 'head' + i });
      const body = Body.create({
        parts: [chassis, head],
        collisionFilter: { group }, friction: 0.6, frictionAir: 0.008,
        restitution: 0.16, label: 'car' + i,
      });
      const wheels = [-30, 30].map((ox) => Bodies.circle(x + ox, y + 16, 17, {
        collisionFilter: { group }, friction: 1.55, frictionStatic: 5.2,
        frictionAir: 0.006, restitution: 0.07, density: 0.0022, label: 'wheel' + i,
      }));
      const axles = wheels.map((wheel) => Constraint.create({
        bodyA: body,
        pointA: { x: wheel.position.x - body.position.x, y: wheel.position.y - body.position.y },
        bodyB: wheel, pointB: { x: 0, y: 0 },
        length: 0, stiffness: 0.9, damping: 0.12,
      }));
      Composite.add(this.engine.world, [body, ...wheels, ...axles]);
      return {
        body, head, wheels, dir, alive: true, input: { l: 0, r: 0 },
        drive: 0, grounded: false, index: i,
      };
    }

    carOfPart(part) {
      const parent = part.parent || part;
      for (const c of this.cars) if (c.body === parent || c.wheels.includes(parent)) return c;
      return null;
    }

    onCollisions(ev) {
      if (this.phase !== 'play' || this.shield > 0) return;
      for (const pair of ev.pairs) {
        for (const [me, other] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
          if (!/^head\d/.test(me.label)) continue;
          const myCar = this.carOfPart(me);
          const otherCar = this.carOfPart(other);
          if (!myCar || otherCar === myCar) continue;
          if (!myCar.alive) continue;
          this.pendingDeaths.add(myCar.index); // head touched map, plank or opponent
        }
      }
    }

    setInput(i, inp) {
      const car = this.cars[i];
      if (car) car.input = { l: inp.l ? 1 : 0, r: inp.r ? 1 : 0 };
    }

    headPos(car) {
      // head part positions update with the compound body
      return { x: car.head.position.x, y: car.head.position.y };
    }

    isGrounded(car) {
      // Querying two wheels against a small fixed surface list is cheap and
      // keeps the driving model tied to actual terrain/plank contact.
      return car.wheels.some((wheel) => Matter.Query.collides(wheel, this.driveSurfaces).length > 0);
    }

    step(dt = 1 / 60) {
      this.phaseT += dt;

      if (this.phase === 'ready' && this.phaseT >= CFG.readyTime) {
        this.phase = 'play';
        this.phaseT = 0;
      }

      const driving = this.phase === 'play' || this.phase === 'point';
      if (driving) {
        this.shield = Math.max(0, this.shield - dt);
        for (const car of this.cars) {
          const d = car.alive ? (car.input.r ? 1 : 0) - (car.input.l ? 1 : 0) : 0;
          car.drive = d;
          car.grounded = this.isGrounded(car);
          if (d === 0) {
            // Let an airborne car keep its spin. Grounded wheels receive only
            // a light rolling brake, preserving the long terrain launches in
            // the reference instead of stopping dead on button release.
            if (car.grounded) {
              for (const wheel of car.wheels)
                wheel.torque -= CFG.coastBrake * wheel.angularVelocity * wheel.inertia / 277.6;
            }
          } else {
            const accel = car.grounded ? CFG.wheelAccel : CFG.airWheelAccel;
            for (const wheel of car.wheels) {
              const target = d * CFG.wheelAV;
              const av = wheel.angularVelocity;
              Body.setAngularVelocity(wheel, av + clamp(target - av, -accel, accel));
            }
            // Wheel traction creates movement on slopes and walls. Once both
            // wheels leave a surface, the same control becomes a deliberate
            // air-roll, matching the reference's controllable launch arcs.
            if (!car.grounded) {
              Body.setAngularVelocity(car.body,
                clamp(car.body.angularVelocity + d * CFG.airSpin, -CFG.maxBodyAV, CFG.maxBodyAV));
            }
          }
        }
      }

      for (const plank of this.planks) {
        if (plank.springK)
          plank.torque -= plank.angle * plank.springK * plank.inertia / 277.6;
      }

      Engine.update(this.engine, dt * 1000);

      // water rise
      if (this.phase === 'play') {
        this.playT += dt;
        if (this.playT >= CFG.riseStart) {
          if (!this.risingAnnounced) { this.risingAnnounced = true; this.pushEvent('rise'); }
          this.water = Math.max(CFG.waterMin, this.water - CFG.riseSpeed * dt);
        }
      }

      if (this.phase === 'play' && this.shield <= 0) {
        for (const car of this.cars) {
          if (!car.alive) continue;
          const h = this.headPos(car);
          const p = car.body.position;
          if (h.y - 5 > this.water) this.pendingDeaths.add(car.index);          // drowned
          if (p.x < -160 || p.x > W + 160 || p.y > H + 260 || p.y < -1400)      // thrown out
            this.pendingDeaths.add(car.index);
        }
      }

      if (this.phase === 'play' && this.pendingDeaths.size > 0) {
        const dead = [...this.pendingDeaths];
        this.pendingDeaths.clear();
        for (const idx of dead) {
          const car = this.cars[idx];
          if (!car.alive) continue;
          car.alive = false;
          const h = this.headPos(car);
          this.pushEvent('die', { car: idx, x: r1(h.x), y: r1(h.y) });
        }
        const alive = this.cars.filter((c) => c.alive);
        if (alive.length === 1) this.scores[alive[0].index]++;
        // both dead at once = draw, no point
        this.phase = 'point';
        this.phaseT = 0;
      }

      if (this.phase === 'point' && this.phaseT >= CFG.pointTime) {
        const top = Math.max(...this.scores);
        if (top >= CFG.winScore) {
          this.winner = this.scores[0] > this.scores[1] ? 0 : 1;
          this.phase = 'over';
          this.phaseT = 0;
          this.pushEvent('win', { car: this.winner });
        } else {
          this.startRound(this.pickMap());
        }
      }
    }

    snapshot() {
      return {
        mid: this.mid,
        map: this.mapIndex,
        phase: this.phase,
        phaseT: r1(this.phaseT),
        water: r1(this.water),
        scores: this.scores.slice(),
        winner: this.winner,
        shield: r1(this.shield),
        cars: this.cars.map((c) => {
          const h = this.headPos(c);
          return {
            x: r1(c.body.position.x), y: r1(c.body.position.y), a: r3(c.body.angle),
            hx: r1(h.x), hy: r1(h.y),
            alive: c.alive, dir: c.dir, drive: c.drive,
            sp: r1(Math.hypot(c.body.velocity.x, c.body.velocity.y)),
            wheels: c.wheels.map((w) => ({ x: r1(w.position.x), y: r1(w.position.y), a: r3(w.angle) })),
          };
        }),
        planks: this.planks.map((p) => ({ x: r1(p.position.x), y: r1(p.position.y), a: r3(p.angle) })),
        events: this.events.slice(),
      };
    }

    // Compact form for the 20 Hz online stream. Array positions are stable
    // protocol fields; the browser expands them before rendering.
    networkSnapshot() {
      const s = this.snapshot();
      return [
        s.mid, s.map, s.phase, s.phaseT, s.water, s.scores[0], s.scores[1],
        s.winner == null ? -1 : s.winner, s.shield,
        s.cars.map((c) => [
          c.x, c.y, c.a, c.hx, c.hy, c.alive ? 1 : 0, c.dir, c.drive, c.sp,
          c.wheels[0].x, c.wheels[0].y, c.wheels[0].a,
          c.wheels[1].x, c.wheels[1].y, c.wheels[1].a,
        ]),
        s.planks.map((p) => [p.x, p.y, p.a]),
        s.events.map((e) => e.type === 'die'
          ? [e.id, 0, e.car, e.x, e.y]
          : e.type === 'rise' ? [e.id, 1] : [e.id, 2, e.car]),
      ];
    }
  }

  return { Match, CFG, W, H, MAPS };
});
