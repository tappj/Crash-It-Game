// screenshot every map in local mode for visual comparison with maps/*.png
const puppeteer = require('puppeteer-core');
const path = require('path');
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    protocolTimeout: 30000,
    args: ['--window-size=1280,640', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 640 });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text());
  });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await page.click('#btnLocal');
  await page.waitForFunction(() => window.__crash.mode === 'local', { polling: 200, timeout: 5000 });

  const n = await page.evaluate(() => CrashMaps.MAPS.length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((m) => {
      const match = window.__crash.match;
      match.scores = [1, 0];
      match.startRound(m);
      match.phase = 'play'; match.phaseT = 0; match.shield = 0;
    }, i);
    await new Promise((r) => setTimeout(r, 900)); // settle + skip fades
    await page.screenshot({ path: path.join(SHOTS, `map${i + 1}.png`) });
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : `OK — ${n} map shots in test/shots/`);
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e); process.exit(2); });
