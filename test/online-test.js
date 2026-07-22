// end-to-end online test: two browsers, lobby create/join, real-time play
const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

let failures = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) failures++;
}

function step(msg) { console.log('   …', msg); }

(async () => {
  const errors = [];
  const browsers = [];
  async function newPage(tag) {
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: 'new',
      protocolTimeout: 30000,
      args: [
        '--window-size=1280,720', '--mute-audio',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    browsers.push(browser);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', (e) => { if (errors.length < 20) errors.push(`${tag} pageerror: ${e.message}`); });
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon') && errors.length < 20) errors.push(`${tag} console: ${m.text()}`);
    });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    return page;
  }

  step('launching host browser');
  const host = await newPage('host');
  step('launching guest browser');
  const guest = await newPage('guest');
  const POLL = { polling: 250, timeout: 8000 };

  // host creates a lobby
  await host.click('#btnCreate');
  step('waiting for lobby code');
  await host.waitForFunction(() => /^[A-Z2-9]{4}$/.test(document.getElementById('lobbyCode').textContent), POLL);
  const code = await host.$eval('#lobbyCode', (el) => el.textContent);
  check('lobby created with 4-char code', /^[A-Z2-9]{4}$/.test(code), code);

  // guest joins with a WRONG code first
  await guest.click('#btnJoin');
  await guest.type('#codeInput', 'XXXX');
  await guest.click('#btnJoinGo');
  step('waiting for error toast');
  await guest.waitForFunction(() => !document.getElementById('toast').classList.contains('hidden'), POLL);
  const toastMsg = await guest.$eval('#toast', (el) => el.textContent);
  check('bad code shows error toast', /not found/i.test(toastMsg), toastMsg);

  // now the real code
  await guest.evaluate(() => { document.getElementById('codeInput').value = ''; });
  await guest.type('#codeInput', code);
  await guest.click('#btnJoinGo');
  step('waiting for host role');
  await host.waitForFunction(() => window.__crash.mode === 'host', POLL);
  await guest.waitForFunction(() => window.__crash.mode === 'guest', POLL);
  check('both entered the match (host/guest roles)', true);

  // guest starts receiving snapshots
  await guest.waitForFunction(() => {
    const a = window.__crash;
    return a.snapBuf && a.snapBuf.buf.length > 3 && a.snapBuf.latest().cars.length === 2;
  }, POLL);
  check('guest receives snapshot stream', true);

  // guest drives; verify HIS car (index 1) moves in the host's sim
  // (peak displacement, since some maps block or tip the car)
  await new Promise((r) => setTimeout(r, 1400)); // pass GET READY
  const x0 = await host.evaluate(() => window.__crash.match.cars[1].body.position.x);
  await guest.keyboard.down('ArrowLeft');
  let peakHost = 0, peakGuest = 0;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const hx = await host.evaluate(() => window.__crash.match.cars[1].body.position.x);
    const gx = await guest.evaluate(() => window.__crash.snapBuf.latest().cars[1].x);
    peakHost = Math.max(peakHost, Math.abs(hx - x0));
    peakGuest = Math.max(peakGuest, Math.abs(gx - x0));
  }
  await guest.keyboard.up('ArrowLeft');
  check('guest input drives car on host sim', peakHost > 40, `peak dx=${Math.round(peakHost)}`);
  check('guest sees own car moved', peakGuest > 40, `peak dx=${Math.round(peakGuest)}`);

  await host.screenshot({ path: path.join(SHOTS, 'net-host.png') });
  await guest.screenshot({ path: path.join(SHOTS, 'net-guest.png') });

  // force the match to game over on the host sim and check both UIs react
  await host.evaluate(() => {
    const m = window.__crash.match;
    m.scores = [4, 0];
    // drown guest car repeatedly until win
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const phase = await host.evaluate(() => window.__crash.match.phase);
    if (phase === 'over') break;
    await host.evaluate(() => {
      const m = window.__crash.match;
      const Matter = window.Matter;
      if (m.phase === 'play' && m.shield <= 0) Matter.Body.setPosition(m.cars[1].body, { x: 800, y: 2000 });
    });
    await new Promise((r) => setTimeout(r, 200));
  }
  step('waiting for host game over');
  await host.waitForFunction(() => !document.getElementById('overScreen').classList.contains('hidden'), { polling: 250, timeout: 15000 });
  check('host shows game over', true);
  await guest.waitForFunction(() => !document.getElementById('overScreen').classList.contains('hidden'), { polling: 250, timeout: 15000 });
  check('guest shows game over', true);
  const winnerTxt = await host.$eval('#overTitle', (el) => el.textContent);
  check('winner announced', /WINS/.test(winnerTxt), winnerTxt);
  await host.screenshot({ path: path.join(SHOTS, 'net-gameover.png') });

  // rematch from guest side
  await guest.click('#btnRematch');
  step('waiting for rematch');
  await host.waitForFunction(() => window.__crash.match && window.__crash.match.phase !== 'over', POLL);
  await guest.waitForFunction(() => document.getElementById('overScreen').classList.contains('hidden'), POLL);
  const scores = await host.evaluate(() => window.__crash.match.scores.join(','));
  check('rematch resets match', scores === '0,0', scores);

  // guest leaves -> host gets notified back to menu
  await guest.click('#hudExit');
  step('waiting for peer-left');
  await host.waitForFunction(() => window.__crash.mode === 'menu', POLL);
  check('peer-left returns host to menu', true);

  check('no JS errors across both clients', errors.length === 0, errors.join(' | ') || 'clean');

  for (const b of browsers) await b.close();
  console.log(failures === 0 ? '\nONLINE TESTS PASSED' : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
