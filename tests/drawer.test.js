// The JavaScript twin of the mode (src/sim/drawer-mode.js) against the Python mode: tests/golden-drawer.json holds the inputs of a few
// scenarios (the sixteen figures, the arrows and a hand, messages of the page) and what src/py/drawer_mode.py did with them on a virtual
// robot (python3 -I tests/test_drawer_mode.py --golden tests/golden-drawer.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VirtualThymio } from '../src/sim/physics.js';
import { DrawerMode } from '../src/sim/drawer-mode.js';
import { VirtualRobot } from '../src/sim/virtual-robot.js';
import { SimBackend } from '../src/sim/sim-backend.js';
import { encodeMessage, selectItem, commandItem, CMD } from '../src/protocol.js';

const golden = JSON.parse(readFileSync(new URL('./golden-drawer.json', import.meta.url), 'utf8'));

// The harness of tests/test_drawer_mode.py, tick by tick: the inputs of tick t are set, the mode runs, the physics moves 10 steps.
function replay(sc) {
  const body = new VirtualThymio();
  const lines = [];
  const sounds = [];
  const mode = new DrawerMode(body, { sel: sc.sel, go: sc.go, say: (text) => lines.push([body.nowMs, text]), sound: (id) => sounds.push([body.nowMs, id]) });
  const buttons = new Map(sc.buttons);
  const frames = new Map(sc.frames);
  const prox = new Map(sc.prox.map(([t, a, b]) => [t, [a, b]]));
  const ground = new Map(sc.ground);
  let rear = [0, 0];
  let floor = '?';
  let idleAt = null;
  mode.start();
  let t = 0;
  for (; t < sc.ticks; t++) {
    const b = [0, 0, 0, 0, 0];
    if (buttons.has(t)) b[buttons.get(t)] = 1;
    if (prox.has(t)) rear = prox.get(t);
    if (ground.has(t)) floor = ground.get(t);
    if (sc.untilIdle) {
      const end = lines.findIndex(([, l]) => l.startsWith('@@end'));
      if (end >= 0 && idleAt === null && lines.slice(end).some(([, l]) => l === '@@state idle')) idleAt = t;
      if (idleAt !== null && t >= idleAt + 15) break;
    }
    mode.tick({ buttons: b, rear, ground: floor, frame: frames.get(t) || null });
    for (let i = 0; i < 10; i++) body.step();          // (the loop of run() sleeps out its tick before it looks at quit)
    if (mode.quit) { t++; break; }
  }
  return { lines, sounds, body, ticks: t };
}

for (const sc of golden.scenarios) {
  test(`the JavaScript mode does what the Python mode did: ${sc.name}`, () => {
    const out = replay(sc);
    const want = sc.lines.filter(([, l]) => !l.startsWith('@@bye'));
    const have = out.lines;
    const n = Math.min(want.length, have.length);
    for (let i = 0; i < n; i++) assert.deepEqual(have[i], want[i], `line ${i}`);
    assert.equal(have.length, want.length, 'same number of lines');
    assert.deepEqual(out.sounds, sc.sounds, 'same sounds');
    assert.ok(Math.abs(out.body.x - sc.pose[0]) < 1e-3, `x ${out.body.x} vs ${sc.pose[0]}`);
    assert.ok(Math.abs(out.body.y - sc.pose[1]) < 1e-3, `y ${out.body.y} vs ${sc.pose[1]}`);
    assert.ok(Math.abs(out.body.headingDeg - sc.pose[2]) < 1e-3, `heading ${out.body.headingDeg} vs ${sc.pose[2]}`);
  });
}

test('the frames of a message are the same as the ones the Python test encodes', () => {
  for (const g of golden.frames) assert.deepEqual(encodeMessage(g.items, g.msg), g.frames);
});

test('the scenarios exercise what they are for', () => {
  const words = new Set();
  for (const sc of golden.scenarios) for (const [, l] of sc.lines) words.add(l.split(' ')[0]);
  for (const w of ['@@n', '@@sel', '@@size', '@@draw', '@@seg', '@@end', '@@stop', '@@ack', '@@state', '@@cal', '@@exit']) assert.ok(words.has(w), w);
  const mixed = golden.scenarios.find((s) => s.name === 'size-and-custom');
  assert.ok(mixed.lines.some(([, l]) => l === '@@draw 16'), 'the page\'s own form was drawn');
  assert.ok(mixed.lines.some(([, l]) => l === '@@size 60') && mixed.lines.some(([, l]) => l === '@@size 200'), 'two sizes');
  assert.ok(mixed.lines.some(([, l]) => l === '@@size 300'), 'a size out of range is brought back');
  assert.equal(golden.scenarios.filter((s) => s.name.startsWith('figure-')).length, 16);
  const ends = golden.scenarios.filter((s) => s.name.startsWith('figure-')).map((s) => s.lines.some(([, l]) => l.startsWith('@@end')));
  assert.ok(ends.every(Boolean), 'every figure was drawn to its end');
});

// ---- the virtual robot and its backend ---------------------------------------------------------------
test('the virtual robot draws a square when it is told to, and says so with the same words as the real one', () => {
  const events = [];
  const sim = new SimBackend((e) => events.push(e), { speed: 10 });
  sim.start({ sel: 3 });
  sim.apply({ command: CMD.START });
  for (let i = 0; i < 700; i++) sim.advance(100);               // 70 s of robot time at x10
  const types = events.map((e) => e.type);
  assert.ok(types.includes('hello'));
  assert.ok(types.includes('cal'));
  assert.ok(types.includes('draw'));
  assert.equal(events.filter((e) => e.type === 'seg' && e.phase === 's').length, 4);
  assert.equal(events.filter((e) => e.type === 'seg' && e.phase === 't').length, 4);
  assert.ok(types.includes('end'));
  assert.equal(events.filter((e) => e.type === 'n').at(-1).state, 'idle');
  assert.ok(events.filter((e) => e.type === 'n').length > 100, 'a progress line every 100 ms');
  assert.ok(events.every((e) => e.t != null || e.type === 'bye'));
});

test('a figure chosen by the page is the one that is drawn, a stop halts it', () => {
  const events = [];
  const sim = new SimBackend((e) => events.push(e), { speed: 10 });
  sim.start({ sel: 0 });
  sim.apply({ select: 12 });
  for (let i = 0; i < 5; i++) sim.advance(100);
  assert.equal(events.filter((e) => e.type === 'sel').at(-1).figure, 12);
  sim.apply({ command: CMD.START });
  for (let i = 0; i < 12; i++) sim.advance(100);               // 12 s of robot time: the star takes about 30 s
  assert.ok(events.some((e) => e.type === 'draw' && e.figure === 12));
  sim.apply({ command: CMD.STOP });
  for (let i = 0; i < 10; i++) sim.advance(100);
  assert.ok(events.some((e) => e.type === 'stop'));
  assert.deepEqual([sim.robot.body.vl, sim.robot.body.vr], [0, 0]);
  assert.equal(events.some((e) => e.type === 'end'), false);
});

test('the person can put the robot down somewhere else, the next drawing starts from there', () => {
  const sim = new SimBackend(() => {}, { speed: 10 });
  sim.start({ sel: 0 });
  sim.place({ x: 100, y: -50, h: 90 });
  sim.apply({ command: CMD.START });
  for (let i = 0; i < 100; i++) sim.advance(100);
  const b = sim.robot.body;
  assert.ok(Math.abs(b.x - (100 - 46.67)) < 1.5, `x ${b.x}`);          // a line to the left: heading 90 is left
  assert.ok(Math.abs(b.y - -50) < 1.5, `y ${b.y}`);
});

test('the colour under the virtual robot lights its body', () => {
  const robot = new VirtualRobot();
  robot.ground = 'g';
  robot.start({ sel: 3 });
  for (let i = 0; i < 100; i++) robot.tick();
  const body = robot.mode.leds.body;
  assert.equal(body[0], 0);
  assert.equal(body[2], 0);
  assert.ok(body[1] > 0 || robot.mode.pulse < 0);
  robot.ground = 'c';
  robot.tick();
  assert.deepEqual(robot.mode.leds.body, [0, 0, 0], 'cyan switches the body lights off, as in the firmware');
});

test('the Lego LEDs count the place in the row', () => {
  const robot = new VirtualRobot();
  robot.start({ sel: 10 });
  robot.tick();
  assert.deepEqual([robot.mode.leds.front, robot.mode.leds.back], [0, 3]);
  robot.pushFrames(encodeMessage([selectItem(4)], 1));
  robot.tick();
  robot.tick();
  assert.deepEqual([robot.mode.leds.front, robot.mode.leds.back], [5, 0]);
});

test('a message gets its answer', () => {
  const robot = new VirtualRobot();
  robot.start({ sel: 0 });
  robot.pushFrames(encodeMessage([selectItem(7), commandItem(CMD.REPORT)], 5));
  const lines = robot.tick().lines.concat(robot.tick().lines);
  assert.ok(lines.includes('@@ack 5'), lines.join(' | '));
  assert.ok(lines.includes('@@sel 7'));
});
