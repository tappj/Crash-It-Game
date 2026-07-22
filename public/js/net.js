// Crash It — WebSocket client for online lobbies.
(function () {
  class Net {
    constructor() {
      this.ws = null;
      this.handlers = {};
      this.connected = false;
    }

    on(type, fn) { this.handlers[type] = fn; }
    emit(type, msg) { if (this.handlers[type]) this.handlers[type](msg); }

    connect() {
      return new Promise((resolve, reject) => {
        if (this.connected) return resolve();
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${proto}//${location.host}`);
        this.ws.onopen = () => { this.connected = true; resolve(); };
        this.ws.onerror = () => { if (!this.connected) reject(new Error('Could not reach the server.')); };
        this.ws.onclose = () => {
          const was = this.connected;
          this.connected = false;
          if (was) this.emit('disconnected');
        };
        this.ws.onmessage = (e) => {
          let msg;
          try { msg = JSON.parse(e.data); } catch { return; }
          this.emit(msg.t, msg);
        };
      });
    }

    send(obj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
    }

    createLobby() { this.send({ t: 'create' }); }
    joinLobby(code) { this.send({ t: 'join', code }); }
    leaveLobby() { this.send({ t: 'leave' }); }
  }

  // The host sends snapshots frequently, so keep their wire representation
  // compact. Local rendering continues to use descriptive object fields.
  // This removes repeated JSON keys from every network frame.
  function unpackSnapshot(packed) {
    if (!Array.isArray(packed)) return packed; // supports older servers during a rolling deploy
    const [mid, map, phase, phaseT, water, score0, score1, winner, shield, cars, planks, events] = packed;
    return {
      mid, map, phase, phaseT, water,
      scores: [score0, score1],
      winner: winner < 0 ? null : winner,
      shield,
      cars: cars.map((c) => ({
        x: c[0], y: c[1], a: c[2], hx: c[3], hy: c[4], alive: !!c[5],
        dir: c[6], drive: c[7], sp: c[8],
        wheels: [{ x: c[9], y: c[10], a: c[11] }, { x: c[12], y: c[13], a: c[14] }],
      })),
      planks: planks.map((p) => ({ x: p[0], y: p[1], a: p[2] })),
      events: events.map((e) => {
        if (e[1] === 0) return { id: e[0], type: 'die', car: e[2], x: e[3], y: e[4] };
        if (e[1] === 1) return { id: e[0], type: 'rise' };
        return { id: e[0], type: 'win', car: e[2] };
      }),
    };
  }

  // Interpolating snapshot buffer for the guest: renders ~100ms in the past
  // so motion is smooth between 30Hz snapshots.
  class SnapshotBuffer {
    constructor() { this.buf = []; this.delay = 125; }
    push(state) {
      state._t = performance.now();
      this.buf.push(state);
      if (this.buf.length > 30) this.buf.shift();
    }
    latest() { return this.buf[this.buf.length - 1] || null; }
    sample() {
      const n = this.buf.length;
      if (n === 0) return null;
      if (n === 1) return this.buf[0];
      const target = performance.now() - this.delay;
      let a = this.buf[0], b = this.buf[n - 1];
      for (let i = n - 1; i > 0; i--) {
        if (this.buf[i - 1]._t <= target) { a = this.buf[i - 1]; b = this.buf[i]; break; }
      }
      if (target >= b._t) return b;
      const span = b._t - a._t;
      const k = span > 0 ? Math.min(1, Math.max(0, (target - a._t) / span)) : 1;
      return lerpState(a, b, k);
    }
  }

  const lerp = (a, b, k) => a + (b - a) * k;
  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  function lerpState(a, b, k) {
    // interpolate only between snapshots of the same round/map
    if (a.map !== b.map || a.mid !== b.mid || a.phase !== b.phase && b.phase === 'ready') return b;
    const s = { ...b };
    s.water = lerp(a.water, b.water, k);
    s.cars = b.cars.map((cb, i) => {
      const ca = a.cars[i];
      if (!ca || Math.hypot(cb.x - ca.x, cb.y - ca.y) > 220) return cb; // teleport (respawn)
      return Object.assign({}, cb, {
        x: lerp(ca.x, cb.x, k), y: lerp(ca.y, cb.y, k), a: lerpAngle(ca.a, cb.a, k),
        hx: lerp(ca.hx, cb.hx, k), hy: lerp(ca.hy, cb.hy, k),
        wheels: cb.wheels.map((wb, j) => ({
          x: lerp(ca.wheels[j].x, wb.x, k),
          y: lerp(ca.wheels[j].y, wb.y, k),
          a: lerpAngle(ca.wheels[j].a, wb.a, k),
        })),
      });
    });
    s.planks = b.planks.map((pb, i) => ({
      x: lerp(a.planks[i].x, pb.x, k),
      y: lerp(a.planks[i].y, pb.y, k),
      a: lerpAngle(a.planks[i].a, pb.a, k),
    }));
    return s;
  }

  window.CrashNet = { Net, SnapshotBuffer, unpackSnapshot };
})();
