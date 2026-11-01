import test from 'node:test';
import assert from 'node:assert/strict';
import { Telemetry, DEFAULT_FIGURE, MAX_POINTS } from '../src/store.js';
import { FIGURES, sideLengthMm, CUSTOM_PRESETS, robotModel } from '../src/spec.js';
import { figurePath, bounds, startPoseFor } from '../src/geometry.js';
import { parseRobotLine } from '../src/protocol.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

test('the first figure is a square, the robot waits where it is in the middle of the sheet', () => {
  const t = new Telemetry();
  assert.equal(t.s.sel, DEFAULT_FIGURE);
  const b = bounds(figurePath(FIGURES[3], { pose: t.s.pose }).points);
  near((b.minX + b.maxX) / 2, 0, 1e-6);
  near((b.minY + b.maxY) / 2, 0, 1e-6);
  assert.equal(t.s.autoPlace, true);
});

test('choosing a figure moves the robot to its start on a blank sheet, and not once the person has put it somewhere', () => {
  const t = new Telemetry();
  const placed = t.s.placed;
  t.choose(8);
  assert.equal(t.s.sel, 8);
  assert.ok(t.s.placed > placed, 'the virtual robot is told');
  const b = bounds(figurePath(FIGURES[8], { pose: t.s.pose }).points);
  near((b.minX + b.maxX) / 2, 0, 1e-6);
  t.place({ x: 50, y: 20, h: 90 });
  const p = { ...t.s.pose };
  t.choose(4);
  assert.deepEqual(t.s.pose, p, 'it stays where it was put');
  assert.equal(t.s.autoPlace, false);
  t.newSheet();
  assert.equal(t.s.autoPlace, true);
  assert.deepEqual(t.s.pose, startPoseFor(FIGURES[4], { mm: t.s.mm, h: 0 }));
});

test('the robot says the figure: shown, unless the person has just chosen another', () => {
  const t = new Telemetry();
  t.push({ type: 'sel', figure: 10, t: 1 });
  assert.equal(t.s.sel, 10);
  t.choose(2);
  t.push({ type: 'sel', figure: 10, t: 2 });            // an older word of the robot
  assert.equal(t.s.sel, 2);
  t.push({ type: 'sel', figure: 2, t: 3 });             // it has caught up
  t.push({ type: 'sel', figure: 11, t: 4 });            // now its arrows count again
  assert.equal(t.s.sel, 11);
});

test('a drawing leaves ink, moves the pose, and counts', () => {
  const t = new Telemetry();
  t.push({ type: 'hello', t: 1 });
  t.push({ type: 'cal', fw: 9000000, bw: 9000000, rot90: 16384, t: 1 });
  const start = { ...t.s.pose };
  t.push({ type: 'state', state: 'draw', t: 2 });
  t.push({ type: 'draw', figure: 0, t: 3 });
  assert.equal(t.s.ink.length, 1);
  assert.equal(t.s.drawing, 0);
  const speed = 140;
  for (let i = 0; i <= 12; i++) t.push({ type: 'n', ms: 1000 + i * 100, state: 'draw', figure: 0, step: 0, angle: 0, left: i === 12 ? 0 : speed, right: i === 12 ? 0 : speed, colour: '?', rear: [0, 0], t: 1000 + i * 100 });
  assert.ok(t.s.ink[0].points.length > 5);
  near(t.s.pose.x, start.x, 1e-9);
  assert.ok(t.s.pose.y > start.y + 30, `y ${t.s.pose.y - start.y}`);
  t.push({ type: 'end', figure: 0, t: 3000 });
  assert.equal(t.s.draws, 1);
  assert.equal(t.s.ink[0].done, true);
  assert.equal(t.s.drawing, -1);
  // no more ink once the drawing is over, and the pose stays
  const n = t.s.ink[0].points.length;
  t.push({ type: 'n', ms: 4000, state: 'blink', figure: 0, step: 0, angle: 12, left: 90, right: 90, colour: '?', rear: [0, 0], t: 4000 });
  assert.equal(t.s.ink[0].points.length, n);
  // a second drawing begins where the first ended
  const end = { ...t.s.pose };
  t.push({ type: 'draw', figure: 3, t: 5000 });
  assert.equal(t.s.ink.length, 2);
  assert.deepEqual(t.s.ink[1].points[0], [end.x, end.y]);
});

test('the calibration of the robot sets the length of a side', () => {
  const t = new Telemetry();
  near(t.s.mm, sideLengthMm(), 1e-9);
  t.push({ type: 'cal', fw: 10000000, bw: 10000000, rot90: 16384, t: 1 });
  assert.ok(t.s.mm < sideLengthMm());
  assert.equal(t.s.cal.known, true);
});

test('stop keeps the ink so far; a lost link leaves nothing drawing', () => {
  const t = new Telemetry();
  t.push({ type: 'draw', figure: 3, t: 1 });
  t.push({ type: 'state', state: 'draw', t: 1 });
  t.push({ type: 'stop', t: 2 });
  assert.equal(t.s.state, 'idle');
  assert.equal(t.s.ink[0].done, true);
  t.push({ type: 'draw', figure: 3, t: 3 });
  t.push({ type: 'conn', status: 'disconnected', t: 4 });
  assert.equal(t.s.drawing, -1);
  assert.equal(t.s.running, false);
});

test('a clean sheet and the robot at the start', () => {
  const t = new Telemetry();
  t.push({ type: 'draw', figure: 3, t: 1 });
  t.push({ type: 'end', figure: 3, t: 2 });
  assert.equal(t.s.ink.length, 1);
  t.newSheet();
  assert.equal(t.s.ink.length, 0);
  t.centre();
  assert.equal(t.s.autoPlace, true);
});

test('clear keeps the link and the figure chosen', () => {
  const t = new Telemetry();
  t.setLink({ status: 'connected', device: 'THYMIO3-1234' });
  t.choose(13);
  t.push({ type: 'draw', figure: 13, t: 1 });
  t.clear();
  assert.equal(t.s.sel, 13);
  assert.equal(t.s.link.device, 'THYMIO3-1234');
  assert.equal(t.s.ink.length, 0);
});

test('snapshots are published once per frame and listeners are told', async () => {
  const t = new Telemetry();
  let calls = 0;
  const off = t.subscribe(() => { calls++; });
  t.push({ type: 'hello', t: 1 });
  t.push({ type: 'battery', volts: 4, t: 2 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
  assert.equal(t.getSnapshot().running, true);
  assert.equal(t.getSnapshot().battery, 4);
  off();
});

test('the size: shown at once, kept in its range, not taken back by the robot\'s older word', () => {
  const t = new Telemetry(3);
  const placed = t.s.placed;
  t.chooseSize(200);
  assert.equal(t.s.size, 200);
  assert.ok(t.s.placed > placed, 'the robot waits where the bigger figure is in the middle');
  const b = bounds(figurePath(FIGURES[3], { pose: t.s.pose, mm: t.s.mm, size: 200 }).points);
  near((b.minX + b.maxX) / 2, 0, 1e-6);
  t.push({ type: 'size', size: 100, t: 1 });                // an older word
  assert.equal(t.s.size, 200);
  t.push({ type: 'size', size: 200, t: 2 });                // it has caught up
  t.push({ type: 'size', size: 60, t: 3 });
  assert.equal(t.s.size, 60);
  t.chooseSize(5000);
  assert.equal(t.s.size, 300);
  t.chooseSize(1);
  assert.equal(t.s.size, 40);
});

test('the page\'s own form: points put on the sheet are kept in the robot\'s frame', () => {
  const t = new Telemetry(16);
  t.place({ x: 20, y: 10, h: 90 });                          // facing left
  assert.equal(t.customAdd({ x: -30, y: 10 }), true);        // 50 mm ahead of it
  near(t.s.custom[0][0], 0, 1e-9);
  near(t.s.custom[0][1], 50, 1e-9);
  assert.equal(t.customAdd({ x: -30.5, y: 10 }), false, 'too close to the last point');
  assert.equal(t.customAdd({ x: -30, y: 40 }), true);
  t.customMove(1, { x: -30, y: -20 });
  near(t.s.custom[1][0], -30, 1e-9);                         // 30 mm to its right is... the sheet's -y when it faces left? (x to its right)
  t.customUndo();
  assert.equal(t.s.custom.length, 1);
  t.customRemove(0);
  assert.equal(t.s.custom.length, 0);
  t.customSet([[0, 10], [10, 10]]);
  assert.equal(t.s.custom.length, 2);
  assert.equal(t.figureNow().steps.length, 2);
  // the robot turns, the form turns with it: the steps do not change
  const before = JSON.stringify(t.figureNow().steps);
  t.place({ x: 0, y: 0, h: 30 });
  assert.equal(JSON.stringify(t.figureNow().steps), before);
});

test('the form drawn several times: the number is kept in its range, the time is followed, the figure is the repeated one', () => {
  const t = new Telemetry(16, { custom: [[0, 40], [-40, 40], [-40, 0], [0, 0]], repeat: 3 });
  assert.equal(t.s.repeat, 3);
  assert.equal(t.figureNow().repeat, 3);
  t.chooseRepeat(99);
  assert.equal(t.s.repeat, 50);
  t.chooseRepeat(0);
  assert.equal(t.s.repeat, 1);
  t.chooseRepeat(4);
  t.push({ type: 'draw', figure: 16, t: 1 });
  assert.equal(t.s.rep, 0);
  t.push({ type: 'rep', rep: 2, t: 2 });
  assert.equal(t.s.rep, 2);
  assert.equal(t.s.step, 0);
  t.push({ type: 'draw', figure: 16, t: 3 });
  assert.equal(t.s.rep, 0, 'a new drawing begins at the first time');
  t.chooseEndAngle(500);
  assert.equal(t.s.endAngle, 180);
  t.chooseEndAngle(-500);
  assert.equal(t.s.endAngle, -180);
  t.chooseEndAngle(36);
  assert.equal(t.figureNow().endAngle, 36);
  assert.equal(t.figureNow().steps.at(-1).turn, 36);
  t.clear();
  assert.equal(t.s.repeat, 4, 'kept through a new run');
  assert.equal(t.s.endAngle, 36);
  assert.equal(new Telemetry(3).s.repeat, 1);
  assert.equal(new Telemetry(3).s.endAngle, 0);
});

test('a form is limited to 23 points (24 sides with the turn on the spot) and survives a new run', () => {
  const t = new Telemetry(16, { custom: [] });
  t.place({ x: 0, y: 0, h: 0 });
  for (let i = 0; i < 40; i++) t.customAdd({ x: (i % 2) * 20, y: 5 * (i + 1) });
  assert.equal(t.s.custom.length, MAX_POINTS);
  t.clear();
  assert.equal(t.s.custom.length, MAX_POINTS);
  assert.equal(t.s.sel, 16);
});

// What a real robot's page received on 2026-11-01 when a house was started (the journal of the settings page, from "@@state draw" on): the
// start of a burst of lines was cut short on the way, "@@draw 16", "@@seg 0 s" and "@@size" never came. The robot drew all the same.
const REAL_START = [
  '@@state draw', '@@ack 3', '@@sel 16',
  '@@n 19731 1 16 0 0 116 115 y 0 0 390', '@@n 19831 1 16 0 0 146 131 y 0 0 3084', '@@n 19931 1 16 0 0 115 121 y 0 0 5509',
  '@@n 20031 1 16 0 1 130 134 y 0 0 8158', '@@n 20132 1 16 0 2 115 141 y 0 0 10827', '@@n 20233 1 16 0 0 147 141 y 0 0 13541',
  '@@n 20333 1 16 0 -1 135 141 y 0 0 16351', '@@n 20433 1 16 0 -3 141 144 y 0 0 19026', '@@n 20534 1 16 0 -2 138 139 y 0 0 21875',
  '@@n 20633 1 16 0 -1 98 140 y 0 0 24633', '@@n 20733 1 16 0 -1 146 145 y 0 0 27319', '@@n 20833 1 16 0 -1 67 69 y 0 0 29970',
  '@@n 20933 1 16 0 0 0 0 y 0 0 30334',
];
const REAL_TURN = [
  '@@n 21033 1 16 0 0 0 0 y 0 0 30334', '@@n 21133 1 16 0 0 0 0 y 0 0 30334', '@@n 21233 1 16 0 0 0 0 y 0 0 30334', '@@seg 0 t',
  '@@n 21334 1 16 0 0 0 0 y 0 0 30334', '@@n 21434 1 16 0 -9 73 -89 y 0 0 30253', '@@n 21533 1 16 0 -52 86 -101 y 0 0 30093',
  '@@n 21634 1 16 0 -78 82 -99 y 0 0 29932', '@@n 21734 1 16 0 -124 82 -101 y 0 0 29784', '@@n 21833 1 16 0 -170 83 -103 y 0 0 29645',
  '@@n 21934 1 16 0 -197 83 -86 y 0 0 29519', '@@n 22034 1 16 0 -246 95 -101 y 0 0 29415', '@@n 22135 1 16 0 -269 89 -96 y 0 0 29318',
  '@@n 22235 1 16 0 -322 92 -121 y 0 0 29181', '@@n 22335 1 16 0 -367 82 -90 y 0 0 29052',
  '@@stop', '@@state idle', '@@ack 4', '@@size 65', '@@n 22460 0 16 0 -400 25 -25 y 0 0 29006', '@@n 22660 0 16 0 -402 0 -5 y 0 0 28968',
];
const tell = (t, lines) => lines.forEach((line, i) => {
  const ev = parseRobotLine(line);
  assert.ok(ev, line);
  t.push({ ...ev, t: 1000 + i });
});

test('a drawing whose first lines were lost on the way (a real robot): the ink and the robot follow it from "@@n" all the same', () => {
  const t = new Telemetry();
  t.push({ type: 'hello', t: 1 });
  t.push({ type: 'cal', fw: 8142712, bw: 8507147, rot90: 15920, t: 1 });
  t.push({ type: 'sel', figure: 16, t: 1 });
  const start = { ...t.s.pose };
  tell(t, REAL_START);
  assert.equal(t.s.state, 'draw');
  assert.equal(t.s.drawing, 16, 'the drawing is known without "@@draw"');
  assert.equal(t.s.ink.length, 1);
  assert.equal(t.s.ink[0].figure, 16);
  assert.ok(t.s.ink[0].points.length > 10, `${t.s.ink[0].points.length} points`);
  const side = Math.hypot(t.s.pose.x - start.x, t.s.pose.y - start.y);
  near(side, 46.6, 3, 'the first side is 30334 units of distance: about 47 mm for this robot\'s calibration');
  tell(t, REAL_TURN);
  assert.equal(t.s.state, 'idle');
  assert.equal(t.s.drawing, -1);
  assert.equal(t.s.ink[0].done, true, 'stopped by the person: the stroke is closed');
  assert.ok(t.s.ink[0].points.length > 10);
});

test('what the robot says once and a burst loses is told by "@@n" as well: the end, the stop, the next step, the form again', () => {
  const t = new Telemetry();
  t.push({ type: 'hello', t: 1 });
  t.push({ type: 'cal', fw: 9000000, bw: 9000000, rot90: 16384, t: 1 });
  t.chooseRepeat(3);
  t.choose(16);
  const n = (ms, state, step, angle = 0, dist = 1000) => t.push({ type: 'n', ms, state, figure: 16, step, angle, left: 100, right: 100, colour: '?', rear: [0, 0], dist, t: ms });
  n(100, 'draw', 0, 0, 500);                       // no "@@state", no "@@draw"
  assert.equal(t.s.state, 'draw');
  assert.equal(t.s.drawing, 16);
  assert.equal(t.s.phase, 's');
  t.push({ type: 'seg', step: 1, phase: 't', t: 2 });
  n(200, 'draw', 1, 10, 1500);
  assert.equal(t.s.phase, 't', 'a line that did not change the step does not change the phase');
  n(300, 'draw', 2, 20, 2500);                     // "@@seg 2 s" was lost: the step is new, it begins with its side
  assert.equal(t.s.step, 2);
  assert.equal(t.s.phase, 's');
  n(400, 'draw', 0, 30, 3500);                     // "@@rep 1" was lost: the steps begin again
  assert.equal(t.s.rep, 1);
  n(500, 'draw', 1, 30, 4500);
  assert.equal(t.s.rep, 1);
  n(600, 'draw', 0, 30, 5500);
  assert.equal(t.s.rep, 2);
  n(700, 'draw', 0, 30, 6500);
  n(800, 'draw', 0, 30, 6500);
  assert.equal(t.s.rep, 2, 'a form is not drawn more times than it has');
  n(900, 'blink', 0, 30, 6500);                    // "@@end" was lost: the robot blinks
  assert.equal(t.s.drawing, -1);
  assert.equal(t.s.draws, 1);
  assert.equal(t.s.ink[0].done, true);
  const points = t.s.ink[0].points.length;
  n(1000, 'blink', 0, 30, 9000);
  assert.equal(t.s.ink[0].points.length, points, 'no more ink');
  t.push({ type: 'end', figure: 16, t: 1100 });    // (an "@@end" that comes after all is not counted twice)
  assert.equal(t.s.draws, 1);
});

test('a ready-made form, the number of times and the end angle leave the robot where it is, with the ink so far', () => {
  // a blank sheet and a robot nobody has put anywhere: it waits where the form is in the middle
  const blank = new Telemetry(16);
  blank.customPreset(CUSTOM_PRESETS.zigzag);
  const b = bounds(figurePath(blank.figureNow(), { pose: blank.s.pose, mm: blank.s.mm }).points);
  near((b.minX + b.maxX) / 2, 0, 1e-6);
  near((b.minY + b.maxY) / 2, 0, 1e-6);
  // a robot that has been put somewhere stays there
  const placed = new Telemetry(16);
  placed.place({ x: 40, y: -20, h: 30 });
  placed.customPreset(CUSTOM_PRESETS.house);
  placed.chooseRepeat(4);
  placed.chooseEndAngle(36);
  assert.deepEqual(placed.s.pose, { x: 40, y: -20, h: 30 });
  // so does a robot that has drawn: the sheet has ink, the next form starts where the last one ended
  const drawn = new Telemetry(3);
  drawn.push({ type: 'hello', t: 1 });
  drawn.push({ type: 'cal', fw: 9000000, bw: 9000000, rot90: 16384, t: 1 });
  drawn.push({ type: 'draw', figure: 3, t: 2 });
  for (let i = 0; i <= 8; i++) drawn.push({ type: 'n', ms: 1000 + i * 100, state: 'draw', figure: 3, step: 0, angle: 0, left: 140, right: 140, colour: '?', rear: [0, 0], dist: i * 2500, t: 1000 + i * 100 });
  drawn.push({ type: 'end', figure: 3, t: 3000 });
  drawn.push({ type: 'state', state: 'idle', t: 3100 });
  const where = { ...drawn.s.pose };
  assert.equal(drawn.s.ink.length, 1);
  drawn.choose(16);
  drawn.customPreset(CUSTOM_PRESETS.zigzag);
  drawn.chooseRepeat(3);
  drawn.chooseEndAngle(-90);
  assert.deepEqual(drawn.s.pose, where, 'the robot did not move');
  assert.equal(drawn.s.ink.length, 1, 'and the ink is still there');
  // "Centrer" is the way to put it back
  drawn.centre();
  assert.notDeepEqual(drawn.s.pose, where);
});

test('a real robot accelerates and brakes: its side and the loss come from its calibration, and the sheet follows', () => {
  const t = new Telemetry();
  const virtual = { mm: t.s.mm, loss: t.s.loss, k: t.odo.k };
  assert.equal(t.real, false);
  assert.equal(virtual.loss, 0);
  near(virtual.mm, sideLengthMm(), 1e-9);
  t.setReal(true);
  const real = robotModel(9000000, true);
  near(t.s.mm, real.mm, 1e-9);
  near(t.s.loss, real.loss, 1e-9);
  t.push({ type: 'cal', fw: 8142712, bw: 8507147, rot90: 15920, t: 1 });
  const mine = robotModel(8142712, true);
  near(t.s.mm, mine.mm, 1e-9, 'the calibration that comes is the one of the real robot');
  near(t.s.loss, mine.loss, 1e-9);
  t.clear();
  near(t.s.loss, robotModel(9000000, true).loss, 1e-9, 'and a new run keeps it');
  assert.equal(t.model().rampMs, robotModel(9000000, true).rampMs);
  t.setReal(false);
  assert.equal(t.s.loss, 0, 'the virtual robot loses nothing');
  near(t.s.mm, sideLengthMm(), 1e-9);
});

test('the side planned at a size is the side that is drawn, less the loss: 65 % and 170 % of a real robot', () => {
  const t = new Telemetry(3);
  t.setReal(true);
  t.push({ type: 'cal', fw: 8142712, bw: 8507147, rot90: 15920, t: 1 });
  for (const [size, mm] of [[65, 34], [170, 92]]) {
    t.chooseSize(size);
    const p = figurePath(t.figureNow(), { mm: t.s.mm, loss: t.s.loss, size: t.s.size }).points;
    near(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), mm, 0.6, `${size} %`);
  }
});

test('a real robot is not followed on the sheet: it stays where it was put, the dotted plan and the step in progress are all that move', () => {
  const t = new Telemetry(3);
  t.setReal(true);
  t.push({ type: 'hello', t: 1 });
  t.push({ type: 'cal', fw: 8142712, bw: 8507147, rot90: 15920, t: 1 });
  t.place({ x: 30, y: -10, h: 20 });
  const put = { ...t.s.pose };
  t.push({ type: 'state', state: 'draw', t: 2 });
  t.push({ type: 'draw', figure: 3, t: 3 });
  assert.equal(t.s.drawing, 3);
  assert.equal(t.s.ink.length, 1, 'the stroke exists: it anchors the dotted plan while the robot draws');
  assert.deepEqual(t.s.ink[0].start, put);
  for (let i = 0; i <= 12; i++) t.push({ type: 'n', ms: 1000 + i * 100, state: 'draw', figure: 3, step: i < 6 ? 0 : 1, angle: i < 6 ? 0 : -450, left: 140, right: 140, colour: '?', rear: [0, 0], dist: i * 2500, t: 1000 + i * 100 });
  assert.deepEqual(t.s.pose, put, 'the robot on the screen did not move');
  assert.equal(t.s.ink[0].points.length, 1, 'and nothing was traced');
  assert.equal(t.s.step, 1, 'but the step in progress is known');
  t.push({ type: 'seg', step: 1, phase: 't', t: 3000 });
  assert.equal(t.s.phase, 't');
  t.push({ type: 'end', figure: 3, t: 4000 });
  assert.equal(t.s.draws, 1);
  assert.equal(t.s.drawing, -1);
  assert.deepEqual(t.s.pose, put, 'it is still where it was put');
  assert.equal(t.s.ink[0].done, true);
  // the same events with the virtual robot move it
  const v = new Telemetry(3);
  v.push({ type: 'hello', t: 1 });
  v.push({ type: 'draw', figure: 3, t: 3 });
  for (let i = 0; i <= 12; i++) v.push({ type: 'n', ms: 1000 + i * 100, state: 'draw', figure: 3, step: 0, angle: 0, left: 140, right: 140, colour: '?', rear: [0, 0], dist: i * 2500, t: 1000 + i * 100 });
  assert.ok(v.s.ink[0].points.length > 5);
});
