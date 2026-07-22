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

  // Interpolating snapshot buffer for the guest: renders ~100ms in the past
  // so motion is smooth between 30Hz snapshots.
  class SnapshotBuffer {
    constructor() { this.buf = []; this.delay = 100; }
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
    const s = JSON.parse(JSON.stringify(b));
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

  window.CrashNet = { Net, SnapshotBuffer };
})();
