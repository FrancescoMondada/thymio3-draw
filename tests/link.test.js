// The link to a real robot, without Bluetooth: RobotBackendCore talks to the demonstration robot (src/dev/fake-thymio.js), which runs
// the JavaScript twin of the mode on the virtual robot. What the "robot" prints goes back through the stdout notifications.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the browser the fake robot expects
globalThis.document = new EventTarget();
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

const fake = await import('../src/dev/fake-thymio.js');
const { RobotBackendCore, runArgs, mergeChange } = await import('../src/robot/robot-backend-core.js');
const { buildModuleFrom, moduleNameFor } = await import('../src/script-core.js');
const { Telemetry } = await import('../src/store.js');
const { CMD } = await import('../src/protocol.js');
const { figurePath, customSteps, customMessage, figureOf } = await import('../src/geometry.js');
const { mmPerUnit } = await import('../src/spec.js');
const { FIGURES } = await import('../src/spec.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, '..', 'src', 'py', 'drawer_mode.py'), 'utf8');
const MODULE_TEXT = buildModuleFrom(SOURCE);
const MODULE = { name: moduleNameFor(MODULE_TEXT), text: MODULE_TEXT };
const EV = { connected: 'thymio-connected', manualReconnect: 'thymio-prompt-manual-reconnection', stdout: 'thymio-std-out-values', pyStatus: 'thymio-python-execution-status', pyLoad: 'thymio-python-load-result' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(5); }
};

window.fakeRobot.flags.byteMs = 0.01;       // a module of 14 KB in a tenth of a second
window.fakeRobot.flags.slow = 8;            // the robot's clock goes 8 times faster

function link(options = {}, tele = null) {
  const events = [];
  const log = [];
  const core = new RobotBackendCore((e) => { events.push(e); tele?.push(e); }, {
    thymio: fake, events: EV, module: MODULE, doc: document, win: new EventTarget(), onLog: (kind, text) => log.push([kind, text]),
    liveAckMs: 500, helloTimeoutMs: 3000, moduleHelloTimeoutMs: 3000, haltTimeoutMs: 1500, unknownHaltMs: 300, ...options,
  });
  core.attach();
  return { core, events, log, last: (type) => events.filter((e) => e.type === type).at(-1) };
}

async function connected(options, tele) {
  const l = link(options, tele);
  await l.core.connect();
  await until(() => l.events.some((e) => e.type === 'conn' && e.status === 'connected'));
  return l;
}

const done = async (l) => { await l.core.stop(); await fake.stopScriptExecution(); l.core.detach(); };       // (and whatever the link left running on the robot)

test('connect, install the module once, start the mode: the robot says hello, its calibration and the figure chosen', async () => {
  const l = await connected();
  await l.core.start({ sel: 5 });
  assert.ok(l.events.some((e) => e.type === 'hello'));
  await until(() => l.last('cal') && l.last('sel') && l.last('n'));
  assert.equal(l.last('sel').figure, 5);
  assert.equal(l.last('cal').fw, 9000000);
  assert.equal(l.last('n').state, 'idle');
  assert.ok(window.fakeRobot.files.includes(`${MODULE.name}.py`), 'the module is on the robot');
  assert.ok(l.log.some(([, t]) => /launcher/.test(t)), 'started by the two-line launcher');
  await done(l);
});

test('a figure is chosen and drawn from the page: acknowledged, then the steps, then the end', async () => {
  const l = await connected();
  await l.core.start({ sel: 0 });
  await l.core.apply({ select: 3 });
  await until(() => l.last('sel')?.figure === 3);
  assert.ok(l.last('live-ok'), 'acknowledged');
  await l.core.apply({ command: CMD.START });
  await until(() => l.last('draw'));
  assert.equal(l.last('draw').figure, 3);
  await until(() => l.last('end'), 20000);
  const segs = l.events.filter((e) => e.type === 'seg').map((e) => `${e.step}${e.phase}`);
  assert.deepEqual(segs, ['0s', '0t', '1s', '1t', '2s', '2t', '3s', '3t']);
  await until(() => l.last('n').state === 'idle', 8000);
  await done(l);
});

test('a drawing can be stopped at once', async () => {
  const l = await connected();
  await l.core.start({ sel: 9 });
  await l.core.apply({ command: CMD.START });
  await until(() => l.last('draw'));
  await wait(60);
  await l.core.apply({ command: CMD.STOP });
  await until(() => l.last('stop'));
  await until(() => l.last('n').state === 'idle');
  assert.deepEqual(l.last('n').left === 0 && l.last('n').right === 0, true);
  assert.equal(l.events.some((e) => e.type === 'end'), false);
  await done(l);
});

test('changes that come quickly are merged; a command keeps its place after the figure', () => {
  const list = [];
  mergeChange(list, { select: 1 });
  mergeChange(list, { select: 4, size: 150 });
  mergeChange(list, { size: 80 });
  assert.equal(list.length, 1);
  assert.equal(list[0].select, 4);
  assert.equal(list[0].size, 80);
  mergeChange(list, { command: CMD.START });
  mergeChange(list, { select: 7 });
  assert.equal(list.length, 2);
  assert.equal(list[0].command, CMD.START);
  assert.equal(list[1].select, 7);
});

test('a person who goes through the figures sends few messages, the last figure wins', async () => {
  const l = await connected();
  await l.core.start({ sel: 0 });
  await until(() => l.last('sel'));
  const before = l.log.filter(([, t]) => /live update: \d+ item/.test(t)).length;
  for (let f = 1; f <= 15; f++) l.core.apply({ select: f });
  await until(() => l.last('sel').figure === 15);
  const sent = l.log.filter(([, t]) => /live update: \d+ item/.test(t)).length - before;
  assert.ok(sent <= 3, `${sent} messages for 15 figures`);
  await done(l);
});

test('frames that are lost: the mode is started again with the change, and the drawing starts all the same', async () => {
  const l = await connected({ liveAckMs: 250 });
  await l.core.start({ sel: 2 });
  await until(() => l.last('sel'));
  window.fakeRobot.flags.live = 'drop';
  const restarted = new Promise((resolve) => setTimeout(() => { window.fakeRobot.flags.live = 'ok'; resolve(); }, 1300));
  const sent = l.core.apply({ select: 0, command: CMD.START });
  await restarted;
  await sent;
  await until(() => l.events.some((e) => e.type === 'live-failed'));
  await until(() => l.events.some((e) => e.type === 'draw' && e.figure === 0), 12000);
  await until(() => l.last('end'), 12000);
  await done(l);
});

test('the store follows the events: the ink, the pose, the steps', async () => {
  const tele = new Telemetry(3);
  const l = await connected({}, tele);
  await l.core.start({ sel: 3 });
  const start = { ...tele.s.pose };
  await l.core.apply({ command: CMD.START });
  await until(() => l.last('end'), 20000);
  await until(() => tele.s.state === 'idle', 8000);
  assert.equal(tele.s.ink.length, 1);
  assert.equal(tele.s.ink[0].figure, 3);
  assert.equal(tele.s.ink[0].done, true);
  assert.ok(tele.s.ink[0].points.length > 30);
  assert.equal(tele.s.draws, 1);
  // the square closes: the dead reckoning ends where it began, within a few millimetres
  assert.ok(Math.hypot(tele.s.pose.x - start.x, tele.s.pose.y - start.y) < 4, JSON.stringify([start, tele.s.pose]));
  // and the ink is the figure's path
  const ideal = figurePath(FIGURES[3], { pose: start, mm: tele.s.mm }).points;
  const xs = tele.s.ink[0].points.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) - Math.min(...ideal.map((p) => p[0]))) < 4);
  await done(l);
});

const SQUARE = customMessage(customSteps([[0, 40], [-40, 40], [-40, 0], [0, 0]]));

test('the size and a form of the page\'s own are told with the start, and the robot says its size', async () => {
  const l = await connected();
  await l.core.start({ sel: 3 });
  await l.core.apply({ select: 16, size: 150, custom: SQUARE, command: CMD.START });
  await until(() => l.last('draw'));
  assert.equal(l.last('draw').figure, 16);
  assert.equal(l.last('size').size, 150);
  await until(() => l.last('end'), 20000);
  const segs = l.events.filter((e) => e.type === 'seg').map((e) => `${e.step}${e.phase}`);
  assert.deepEqual(segs, ['0s', '0t', '1s', '1t', '2s', '2t', '3s']);
  await done(l);
});

test('frames that are lost with a form and a start: the mode is started again with the form and the start in its arguments', async () => {
  const l = await connected({ liveAckMs: 250 });
  await l.core.start({ sel: 2, size: 120 });
  await until(() => l.last('sel'));
  window.fakeRobot.flags.live = 'drop';
  const restarted = new Promise((resolve) => setTimeout(() => { window.fakeRobot.flags.live = 'ok'; resolve(); }, 1300));
  const sent = l.core.apply({ select: 16, custom: SQUARE, command: CMD.START });
  await restarted;
  await sent;
  await until(() => l.events.some((e) => e.type === 'live-failed'));
  await until(() => l.events.some((e) => e.type === 'draw' && e.figure === 16), 12000);
  assert.equal(l.last('size').size, 120, 'the size was kept through the restart');
  await until(() => l.last('end'), 20000);
  await done(l);
});

test('a form is told in messages, the start last and alone, the frames a few ticks apart even on a fast link', async () => {
  const times = [];
  const l = await connected({ thymio: { ...fake, setActuatorState: async (data) => { times.push(Date.now()); return fake.setActuatorState(data); } } });
  await l.core.start({ sel: 3 });
  window.fakeRobot.flags.writeMs = 1;                      // a link that answers faster than the mode looks at its LEDs
  times.length = 0;
  const steps = figureOf(16, [[0, 40], [30, 70], [60, 40], [60, 0], [0, 0]], 1, 0).steps;
  await l.core.apply({ select: 16, custom: customMessage(steps, mmPerUnit(9000000)), command: CMD.START });
  window.fakeRobot.flags.writeMs = 90;
  const sent = l.log.filter(([, t]) => /live update: \d+ item/.test(t)).map(([, t]) => t);
  assert.match(sent.at(-1), /: 1 item, 1 frame, message/, 'the start goes alone');
  assert.ok(sent.length >= 2, sent.join('\n'));
  const sizes = sent.map((t) => Number(/(\d+) frames?,/.exec(t)[1]));
  assert.equal(times.length, sizes.reduce((a, b) => a + b, 0), 'one write for each frame');
  assert.ok(Math.max(...sizes) >= 4, `${sizes} frames in a message`);
  let at = 0;
  for (const n of sizes) {                                  // (between two messages the robot, that goes 8 times faster here, has answered: no gap is owed)
    const gaps = times.slice(at + 1, at + n).map((t, i) => t - times[at + i]);
    assert.ok(!gaps.length || Math.min(...gaps) >= 38, `frames ${Math.min(...gaps)} ms apart at the closest`);
    at += n;
  }
  await until(() => l.last('draw'));
  assert.equal(l.last('draw').figure, 16);
  await until(() => l.last('end'), 25000);
  await done(l);
});

test('a start that was heard but whose answer was lost is not started again: the drawing is the answer', async () => {
  const l = await connected();
  await l.core.start({ sel: 3 });
  const hellos = l.events.filter((e) => e.type === 'hello').length;
  window.fakeRobot.flags.acks = 0;
  window.fakeRobot.flags.muteAckAfter = 1;                 // the form is answered, the start is not, nor is "@@draw" (its answer is the state, the "@@n" that say draw)
  window.fakeRobot.flags.lose = /^@@draw/;
  await l.core.apply({ select: 16, custom: SQUARE, command: CMD.START });
  window.fakeRobot.flags.muteAckAfter = Infinity;
  window.fakeRobot.flags.lose = null;
  assert.equal(l.events.filter((e) => e.type === 'live-failed').length, 0, 'nothing failed');
  assert.equal(l.events.filter((e) => e.type === 'hello').length, hellos, 'the mode was not started again');
  assert.equal(l.log.filter(([, t]) => /\(again\)/.test(t)).length, 0, 'and the start was not sent twice');
  await until(() => l.last('end'), 25000);
  assert.equal(l.events.filter((e) => e.type === 'end').length, 1, 'the form was drawn once');
  assert.equal(l.events.filter((e) => e.type === 'draw').length, 0, '("@@draw" was the line that was lost)');
  await done(l);
});

test('lines that a burst of the robot loses (the drawing, the sides, the end) do not leave the page without ink', async () => {
  const tele = new Telemetry(3);
  const l = await connected({}, tele);
  await l.core.start({ sel: 3 });
  window.fakeRobot.flags.lose = /^@@(draw|seg|rep|end|state draw|state blink)/;
  await l.core.apply({ command: CMD.START });
  await until(() => tele.s.draws === 1, 25000);
  await until(() => tele.s.state === 'idle', 8000);
  window.fakeRobot.flags.lose = null;
  assert.equal(l.events.filter((e) => e.type === 'draw' || e.type === 'end').length, 0, 'the page did not hear them');
  assert.equal(tele.s.ink.length, 1);
  assert.equal(tele.s.ink[0].figure, 3);
  assert.equal(tele.s.ink[0].done, true);
  assert.ok(tele.s.ink[0].points.length > 30, `${tele.s.ink[0].points.length} points`);
  assert.equal(tele.s.draws, 1);
  assert.equal(tele.s.drawing, -1);
  await done(l);
});

test('a form drawn three times is told with its number and the robot says each time', async () => {
  const l = await connected();
  await l.core.start({ sel: 3 });
  const steps = figureOf(16, [[0, 30], [-30, 30]], 3, -90).steps;                 // (the turn after the last side is the angle it ends with)
  await l.core.apply({ select: 16, custom: customMessage(steps, mmPerUnit(9000000)), repeat: 3, command: CMD.START });
  await until(() => l.last('end'), 25000);
  assert.deepEqual(l.events.filter((e) => e.type === 'rep').map((e) => e.rep), [1, 2]);
  assert.equal(l.events.filter((e) => e.type === 'draw').length, 1);
  await done(l);
});

test('runArgs: the arguments of the launcher', () => {
  assert.equal(runArgs({}), '0, 0, 100');
  assert.equal(runArgs({ sel: 12, go: 1 }), '12, 1, 100');
  assert.equal(runArgs({ sel: 99, go: true, size: 250 }), '16, 1, 250');
  assert.equal(runArgs({ sel: -3, size: 5 }), '0, 0, 40');
  assert.equal(runArgs({ sel: 16, go: 1, custom: [{ units: 206, turn: 90 }, { units: 5, turn: -45 }] }), '16, 1, 100, "206:90,5:-45", 1');
  assert.equal(runArgs({ sel: 16, go: 1, repeat: 4, custom: [{ units: 206, turn: 90 }] }), '16, 1, 100, "206:90", 4');
  assert.equal(runArgs({ sel: 16, repeat: 400, custom: [{ units: 1, turn: 0 }] }), '16, 0, 100, "1:0", 50');
});
