// headless sanity tests for the Crash It simulation
const { Match, CFG, W, H, MAPS } = require('../public/js/game.js');

let failures = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) failures++;
}

// 1. every map: cars settle on solid ground and survive 10 idle seconds
for (let m = 0; m < MAPS.length; m++) {
  const match = new Match();
  match.scores = [0, 0];
  match.startRound(m);
  for (let i = 0; i < 600; i++) match.step();
  const s = match.snapshot();
  const ok = s.cars.every((c) => c.alive) && s.phase === 'play';
  check(`map ${m} (${MAPS[m].name}): both cars idle-safe 10s`, ok,
    s.cars.map((c) => `y=${c.y | 0} alive=${c.alive}`).join(' | '));
  const wheelsAttached = match.cars.every((c) =>
    c.wheels.every((w) => Math.hypot(w.position.x - c.body.position.x, w.position.y - c.body.position.y) < 80));
  check(`map ${m}: wheels still attached`, wheelsAttached);
  const noNaN = !JSON.stringify(s).includes('null,null') && isFinite(s.cars[0].x);
  check(`map ${m}: no NaN`, noNaN);
}

// 2. driving moves the car
{
  const match = new Match();
  match.startRound(5); // asphalt isle, open drivable surface
  for (let i = 0; i < 90; i++) match.step(); // settle + ready phase
  const x0 = match.cars[0].body.position.x;
  match.setInput(0, { l: 0, r: 1 });
  for (let i = 0; i < 120; i++) match.step();
  const x1 = match.cars[0].body.position.x;
  check('driving right moves car right', x1 - x0 > 150, `dx=${(x1 - x0) | 0}`);
  match.setInput(0, { l: 1, r: 0 });
  for (let i = 0; i < 180; i++) match.step();
  const x2 = match.cars[0].body.position.x;
  check('driving left reverses', x2 < x1 - 60, `dx=${(x2 - x1) | 0}`);
}

// 3. drop a car on the other's head -> kill + score
{
  const match = new Match();
  match.startRound(1); // the divot — flat pocket floor
  for (let i = 0; i < 130; i++) match.step(); // past shield (1.8s) + ready
  const Matter = require('matter-js');
  const victim = match.cars[0];
  const pos = victim.body.position;
  // teleport car 1 right above car 0's head and let it fall
  Matter.Body.setPosition(match.cars[1].body, { x: pos.x, y: pos.y - 150 });
  Matter.Body.setVelocity(match.cars[1].body, { x: 0, y: 8 });
  Matter.Body.setAngularVelocity(match.cars[1].body, 0);
  Matter.Body.setAngle(match.cars[1].body, 0);
  match.cars[1].wheels.forEach((w, i) => {
    Matter.Body.setPosition(w, { x: pos.x + (i ? 30 : -30), y: pos.y - 150 + 16 });
    Matter.Body.setVelocity(w, { x: 0, y: 8 });
  });
  let killed = false;
  for (let i = 0; i < 240 && !killed; i++) { match.step(); killed = !match.cars[0].alive; }
  check('head stomp kills victim', killed);
  check('killer scores a point', match.scores[1] === 1 && match.scores[0] === 0,
    `scores=${match.scores}`);
  check('phase moved to point', ['point', 'ready', 'play'].includes(match.phase));
}

// 4. water rises after 60s and eventually kills both (draw -> no winner yet)
{
  const match = new Match();
  match.startRound(1); // the divot — cars idle safely in the pocket
  const w0 = match.water;
  for (let i = 0; i < 63 * 60; i++) match.step();
  check('water started rising after 60s', match.water < w0, `water=${match.water | 0}`);
  let steps = 0;
  while (match.phase !== 'point' && match.phase !== 'ready' && steps < 80 * 60) { match.step(); steps++; }
  check('rising water ends the round', steps < 80 * 60, `extra=${(steps / 60) | 0}s water=${match.water | 0}`);
}

// 5. driving off an open island's edge drowns the car
{
  const match = new Match();
  match.startRound(5); // asphalt isle
  for (let i = 0; i < 70; i++) match.step();
  match.setInput(0, { l: 1, r: 0 }); // drive left, off the island edge
  let died = false;
  for (let i = 0; i < 12 * 60 && !died; i++) { match.step(); died = !match.cars[0].alive; }
  check('car driven off the island dies in water', died);
  check('opponent got the point', match.scores[1] >= 1, `scores=${match.scores}`);
}

// 6. first to 5 wins
{
  const match = new Match();
  let guard = 0;
  while (match.phase !== 'over' && guard < 400 * 60) {
    // car 1 idles; car 0 chases and generally wins by pushing car 1 into water/walls...
    // instead: force kills by drowning car 1 directly
    if (match.phase === 'play' && match.shield <= 0 && match.cars[1].alive) {
      const Matter = require('matter-js');
      Matter.Body.setPosition(match.cars[1].body, { x: 800, y: H + 300 });
    }
    match.step(); guard++;
  }
  check('match reaches game over', match.phase === 'over');
  check('winner is car 0 with 5 points', match.winner === 0 && match.scores[0] === 5,
    `winner=${match.winner} scores=${match.scores}`);
}

// 7. snapshot size sanity for networking
{
  const match = new Match();
  for (let i = 0; i < 120; i++) match.step();
  const size = JSON.stringify({ t: 's', s: match.snapshot() }).length;
  check('snapshot < 2KB', size < 2048, `${size} bytes`);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
