// Crash It — app flow: menus, local match, online host/guest.
(function () {
  const canvas = document.getElementById('game');
  const renderer = new CrashRender.Renderer(canvas);
  const net = new CrashNet.Net();

  const app = {
    mode: 'menu',        // menu | local | host | guest
    match: null,         // Match (local + host)
    snapBuf: null,       // SnapshotBuffer (guest)
    myIndex: 0,
    tick: 0,
    acc: 0,
    lastTime: performance.now(),
    lastRenderState: null,
  };

  const input = new CrashInput.Input(renderer, (player, state) => {
    if (app.mode === 'guest') net.send({ t: 'i', l: state.l, r: state.r });
  });

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const screens = ['menu', 'joinScreen', 'lobbyScreen', 'overScreen'];
  function show(id) {
    for (const s of screens) $(s).classList.toggle('hidden', s !== id);
    $('hudExit').classList.toggle('hidden', !(id === null));
  }
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  // ---------- flow ----------
  function startLocal() {
    app.mode = 'local';
    app.match = new CrashGame.Match();
    input.controlled = [0, 1];
    input.reset();
    renderer.localPlayers = [0, 1];
    show(null);
  }

  async function createLobby() {
    try { await net.connect(); } catch (e) { return toast(e.message); }
    net.createLobby();
  }

  async function joinLobby(code) {
    if (!code || code.trim().length < 4) return toast('Enter the 4-letter lobby code.');
    try { await net.connect(); } catch (e) { return toast(e.message); }
    net.joinLobby(code.trim().toUpperCase());
  }

  function startOnline(role) {
    app.mode = role;                       // 'host' | 'guest'
    app.myIndex = role === 'host' ? 0 : 1;
    input.controlled = [app.myIndex];
    input.reset();
    renderer.localPlayers = [app.myIndex];
    if (role === 'host') {
      app.match = new CrashGame.Match();
    } else {
      app.snapBuf = new CrashNet.SnapshotBuffer();
    }
    show(null);
  }

  function backToMenu(notifyPeer) {
    if (notifyPeer && (app.mode === 'host' || app.mode === 'guest')) net.leaveLobby();
    app.mode = 'menu';
    app.match = null;
    app.snapBuf = null;
    app.lastRenderState = null;
    input.reset();
    show('menu');
  }

  function rematch() {
    if (app.mode === 'local') {
      app.match = new CrashGame.Match();
      show(null);
    } else if (app.mode === 'host') {
      app.match = new CrashGame.Match();
      net.send({ t: 'rematch' });
      show(null);
    } else if (app.mode === 'guest') {
      net.send({ t: 'rematch' });
      toast('Rematch requested…');
    }
  }

  function showGameOver(state) {
    const winner = state.winner;
    const name = winner === 0 ? 'RED' : 'BLUE';
    const el = $('overTitle');
    el.textContent = `${name} WINS!`;
    el.className = winner === 0 ? 'red' : 'blue';
    $('overScore').innerHTML =
      `<span class="red">${state.scores[0]}</span> · <span class="blue">${state.scores[1]}</span>`;
    let sub = '';
    if (app.mode === 'guest') sub = winner === 1 ? 'You win! 🏆' : 'You lose…';
    if (app.mode === 'host') sub = winner === 0 ? 'You win! 🏆' : 'You lose…';
    $('overSub').textContent = sub;
    show('overScreen');
  }

  // ---------- net events ----------
  net.on('created', (m) => {
    $('lobbyCode').textContent = m.code;
    show('lobbyScreen');
  });
  net.on('err', (m) => toast(m.msg));
  net.on('start', (m) => startOnline(m.role));
  net.on('peer_left', () => {
    if (app.mode === 'host' || app.mode === 'guest') {
      toast('The other player left the game.');
      backToMenu(false);
    }
  });
  net.on('disconnected', () => {
    if (app.mode === 'host' || app.mode === 'guest') {
      toast('Connection lost.');
      backToMenu(false);
    }
  });
  net.on('i', (m) => {          // guest input -> host sim
    if (app.mode === 'host' && app.match) app.match.setInput(1, { l: m.l, r: m.r });
  });
  net.on('s', (m) => {          // host snapshot -> guest
    if (app.mode === 'guest' && app.snapBuf) app.snapBuf.push(m.s);
  });
  net.on('rematch', () => {
    if (app.mode === 'host') {
      app.match = new CrashGame.Match();
      net.send({ t: 'rematch' });
      show(null);
    } else if (app.mode === 'guest') {
      show(null);
    }
  });

  // ---------- main loop ----------
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    let dt = (now - app.lastTime) / 1000;
    app.lastTime = now;
    dt = Math.min(dt, 0.1);

    if (app.mode === 'local' || app.mode === 'host') {
      app.acc += dt;
      let steps = 0;
      while (app.acc >= 1 / 60 && steps < 5) {
        if (app.mode === 'local') {
          app.match.setInput(0, input.players[0]);
          app.match.setInput(1, input.players[1]);
        } else {
          app.match.setInput(0, input.players[0]);
        }
        const wasOver = app.match.phase === 'over';
        app.match.step(1 / 60);
        app.acc -= 1 / 60;
        app.tick++;
        if (app.mode === 'host' && app.tick % 2 === 0) {
          net.send({ t: 's', s: app.match.snapshot() });
        }
        if (!wasOver && app.match.phase === 'over') showGameOver(app.match.snapshot());
        steps++;
      }
      app.lastRenderState = app.match.snapshot();
      renderer.draw(app.lastRenderState, dt);
    } else if (app.mode === 'guest') {
      const state = app.snapBuf.sample();
      if (state) {
        const latest = app.snapBuf.latest();
        if (latest && latest.phase === 'over' && (!app.lastRenderState || app.lastRenderState.phase !== 'over')) {
          showGameOver(latest);
        }
        app.lastRenderState = latest;
        renderer.draw(state, dt);
      } else {
        renderer.draw(demoState(), dt);
      }
    } else {
      renderer.draw(demoState(), dt); // animated menu backdrop
    }
  }

  // idle backdrop state for the menu
  let _demo = null;
  function demoState() {
    if (!_demo) {
      _demo = {
        mid: -1, map: 0, phase: 'menu', phaseT: 0, water: CrashMaps.WATER_BASE,
        scores: ['', ''], winner: null, shield: 0, cars: [], planks: [{ x: 800, y: 330, a: 0 }],
        events: [],
      };
    }
    _demo.planks[0].a = Math.sin(performance.now() / 2400) * 0.3;
    return _demo;
  }

  // ---------- UI wiring ----------
  $('btnLocal').onclick = startLocal;
  $('btnCreate').onclick = createLobby;
  $('btnJoin').onclick = () => show('joinScreen');
  $('btnJoinGo').onclick = () => joinLobby($('codeInput').value);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinLobby($('codeInput').value); });
  $('btnJoinBack').onclick = () => backToMenu(false);
  $('btnLobbyCancel').onclick = () => { net.leaveLobby(); backToMenu(false); };
  $('btnRematch').onclick = rematch;
  $('btnOverMenu').onclick = () => backToMenu(true);
  $('hudExit').onclick = () => backToMenu(true);

  show('menu');
  // Do not feed a several-second delta into the fixed-step simulation after a
  // phone app switch or background tab. Browsers stop painting hidden tabs,
  // so resetting these clocks also avoids needless catch-up work on return.
  document.addEventListener('visibilitychange', () => {
    app.lastTime = performance.now();
    app.acc = 0;
  });
  requestAnimationFrame(frame);
  window.__crash = app; // debug/testing hook
})();
