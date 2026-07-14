// Crash It — keyboard + multitouch input.
// Produces per-player {l, r} states (screen-direction: l = drive left, r = drive right).
(function () {
  class Input {
    /**
     * @param renderer  used for world-coordinate mapping + button pressed visuals
     * @param onChange  called whenever any player's input state changes
     */
    constructor(renderer, onChange) {
      this.renderer = renderer;
      this.onChange = onChange || (() => {});
      this.players = [{ l: 0, r: 0 }, { l: 0, r: 0 }];
      this.enabled = true;
      // which players this device controls (local: [0,1]; online: [myIndex])
      this.controlled = [0, 1];
      this.keys = {};

      window.addEventListener('keydown', (e) => this.key(e, 1));
      window.addEventListener('keyup', (e) => this.key(e, 0));

      const c = renderer.canvas;
      const opts = { passive: false };
      c.addEventListener('touchstart', (e) => this.touch(e), opts);
      c.addEventListener('touchmove', (e) => this.touch(e), opts);
      c.addEventListener('touchend', (e) => this.touch(e), opts);
      c.addEventListener('touchcancel', (e) => this.touch(e), opts);
      // mouse fallback so buttons are testable on desktop
      c.addEventListener('mousedown', (e) => this.mouse(e, true));
      window.addEventListener('mouseup', (e) => this.mouse(e, false));
    }

    key(e, down) {
      if (!this.enabled) return;
      const map = {
        KeyA: [0, 'l'], KeyD: [0, 'r'],
        ArrowLeft: [1, 'l'], ArrowRight: [1, 'r'],
      };
      const m = map[e.code];
      if (!m) return;
      e.preventDefault();
      const [p, side] = m;
      // when controlling only one car online, both key sets steer it
      const target = this.controlled.length === 1 ? this.controlled[0] : p;
      if (!this.controlled.includes(target)) return;
      if (this.keys[e.code] === down) return;
      this.keys[e.code] = down;
      this.set(target, side, down);
    }

    buttonAt(clientX, clientY) {
      const w = this.renderer.toWorld(clientX, clientY);
      for (const b of CrashRender.buttonLayout()) {
        if (!this.controlled.includes(b.player)) continue;
        const dx = w.x - b.x, dy = w.y - b.y;
        if (dx * dx + dy * dy < (b.r + 26) * (b.r + 26)) return b;
      }
      return null;
    }

    touch(e) {
      if (!this.enabled) return;
      e.preventDefault();
      // recompute all held buttons from active touches
      const held = {};
      for (const t of e.touches) {
        const b = this.buttonAt(t.clientX, t.clientY);
        if (b) held[b.player + b.side] = true;
      }
      this.applyHeld(held);
    }

    mouse(e, down) {
      if (!this.enabled) return;
      if (down) {
        const b = this.buttonAt(e.clientX, e.clientY);
        this.mouseHeld = b;
        if (b) this.applyHeld({ [b.player + b.side]: true });
      } else if (this.mouseHeld) {
        this.mouseHeld = null;
        this.applyHeld({});
      }
    }

    applyHeld(held) {
      for (const p of this.controlled) {
        for (const side of ['l', 'r']) {
          const keyHeld = this.playerKeyHeld(p, side);
          this.set(p, side, held[p + side] || keyHeld ? 1 : 0);
        }
      }
    }

    playerKeyHeld(p, side) {
      const codes = this.controlled.length === 1
        ? (side === 'l' ? ['KeyA', 'ArrowLeft'] : ['KeyD', 'ArrowRight'])
        : (p === 0 ? (side === 'l' ? ['KeyA'] : ['KeyD'])
                   : (side === 'l' ? ['ArrowLeft'] : ['ArrowRight']));
      return codes.some((c) => this.keys[c]);
    }

    set(p, side, v) {
      if (this.players[p][side] === v) return;
      this.players[p][side] = v;
      this.renderer.pressed[p + side] = !!v;
      this.onChange(p, this.players[p]);
    }

    reset() {
      this.keys = {};
      for (const p of [0, 1]) {
        this.players[p] = { l: 0, r: 0 };
        this.renderer.pressed[p + 'l'] = this.renderer.pressed[p + 'r'] = false;
      }
    }
  }

  window.CrashInput = { Input };
})();
