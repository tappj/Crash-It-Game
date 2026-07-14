// end-to-end browser test: boot page, start local game, drive, screenshot
const puppeteer = require('puppeteer-core');
const path = require('path');

const SHOTS = process.env.SHOT_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--window-size=1280,720', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(SHOTS, '1-menu.png') });

  // start local game
  await page.click('#btnLocal');
  await new Promise((r) => setTimeout(r, 1600)); // past GET READY
  await page.screenshot({ path: path.join(SHOTS, '2-round-start.png') });

  // drive both cars toward each other for 1.5s
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowLeft');
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(SHOTS, '3-driving.png') });
  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowLeft');
  await page.screenshot({ path: path.join(SHOTS, '4-collision.png') });

  // let any point play out
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(SHOTS, '5-after-point.png') });

  // sample game state from the page
  const state = await page.evaluate(() => {
    const el = document.getElementById('overScreen');
    return {
      overVisible: !el.classList.contains('hidden'),
      hasCanvas: !!document.getElementById('game'),
    };
  });

  console.log('JS errors:', errors.length ? errors : 'none');
  console.log('state:', JSON.stringify(state));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e.message); process.exit(2); });
