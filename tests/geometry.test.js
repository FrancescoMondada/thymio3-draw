// node --test tests/geometry.test.js
// The figures as the firmware draws them (spec.js), their paths (geometry.js) and the dead reckoning that follows the robot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGURES, FIGURE_COUNT, figureAt, groupOf, placeInGroup, idOf, stepSelection, otherGroupFirst, sideLengthMm, mmPerUnit, MM_PER_UNIT, SIDE_MS, pivotSpeeds, MOVE_SPEED, robotModel, TAU300_S } from '../src/spec.js';
import {
  figurePath, closure, totalTurn, bounds, startPoseFor, recipeGroups, durationSec, Odometer, dirOf, wrap180, customSteps, customFigure, customLength, customMessage, figureOf,
  localToWorld, worldToLocal, unitsFor,
} from '../src/geometry.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

test('sixteen figures in two rows of eight, numbered like the firmware (StepsIndex)', () => {
  assert.equal(FIGURE_COUNT, 16);
  FIGURES.forEach((f, i) => assert.equal(f.id, i));
  assert.deepEqual(FIGURES.map((f) => f.group), [...Array(8).fill('polygons'), ...Array(8).fill('shapes')]);
  assert.deepEqual(FIGURES.slice(0, 8).map((f) => f.key), ['line', 'angle', 'triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon']);
  assert.deepEqual(FIGURES.slice(8).map((f) => f.key), ['circle', 'rectangle', 'diamond', 'trapezoid', 'star5', 'parallelogram', 'star7', 'eight']);
  assert.equal(groupOf(7), 'polygons');
  assert.equal(groupOf(8), 'shapes');
  assert.equal(placeInGroup(0), 1);
  assert.equal(placeInGroup(15), 8);
  assert.equal(idOf('shapes', 3), 10);
  assert.equal(figureAt(99).key, 'eight');
  assert.equal(figureAt(-4).key, 'line');
});

test('the firmware tables: turn and number of steps of the polygons, the sides halved from the hexagon on', () => {
  // DegreesPerStepPolygon = {0, 120, 120, 90, 72, 60, 51, 45}, StepsPerPolygon = {1, 2, 3, 4, 5, 6, 7, 8}
  const turns = [0, 120, 120, 90, 72, 60, 51, 45];
  FIGURES.slice(0, 8).forEach((f, i) => {
    assert.equal(f.steps.length, i + 1, f.key);
    assert.ok(f.steps.every((s) => s.turn === turns[i]), f.key);
    assert.ok(f.steps.every((s) => s.side[1] === (i >= 5 ? 2 : 1)), `${f.key}: sides halved from index 5`);
  });
});

test('the arrows go round in a row, forward and backward change row', () => {
  assert.equal(stepSelection(0, -1), 7);
  assert.equal(stepSelection(7, 1), 0);
  assert.equal(stepSelection(8, -1), 15);
  assert.equal(stepSelection(15, 1), 8);
  assert.equal(stepSelection(3, 2), 5);
  assert.equal(otherGroupFirst(5), 8);
  assert.equal(otherGroupFirst(12), 0);
});

test('a base side is 1.2 s at speed 140: about 47 mm for the factory calibration', () => {
  near(sideLengthMm(), 140 * MM_PER_UNIT * 1.2, 1e-9);
  near(sideLengthMm(), 46.67, 0.01);
  assert.equal(SIDE_MS, 1200);
  near(mmPerUnit(9000000), MM_PER_UNIT, 1e-12);
  assert.ok(sideLengthMm(10000000) < sideLengthMm(9000000), 'a robot that takes longer for 15 cm is slower: shorter sides');
});

test('the closed figures come back to where they started, the others do not', () => {
  const closed = { triangle: 360, square: 360, pentagon: 360, hexagon: 360, octagon: 360, circle: -360, rectangle: 360, diamond: 360, trapezoid: 360, star5: 720, parallelogram: 360, eight: 0 };
  for (const [key, total] of Object.entries(closed)) {
    const f = FIGURES.find((x) => x.key === key);
    const c = closure(f);
    assert.ok(c.gap < 1.5, `${key} gap ${c.gap.toFixed(2)} mm`);
    near(totalTurn(f), total, 0, `${key} total turn`);
  }
  // the firmware's integer angles do not close these exactly
  const hept = closure(FIGURES[6]);
  near(hept.turned, 357, 0, 'heptagon: 7 x 51');
  assert.ok(hept.gap > 0.5 && hept.gap < 3, `heptagon gap ${hept.gap.toFixed(2)} mm`);
  const star7 = closure(FIGURES[14]);
  near(star7.turned, 1078, 0, 'star7: 7 x 154');
  assert.ok(star7.gap > 0 && star7.gap < 3, `star7 gap ${star7.gap.toFixed(2)} mm`);
  // the line and the angle are open
  near(closure(FIGURES[0]).gap, sideLengthMm(), 1e-9);
  near(closure(FIGURES[1]).turned, 240, 0, 'angle: two turns of 120, the second after the last side');
});

test('a polygon turns to the left: the square goes up, then left, then down, then right', () => {
  const sq = figurePath(FIGURES[3]).points;
  const s = sideLengthMm();
  const want = [[0, 0], [0, s], [-s, s], [-s, 0], [0, 0]];
  sq.forEach((p, i) => { near(p[0], want[i][0], 1e-9, `x${i}`); near(p[1], want[i][1], 1e-9, `y${i}`); });
});

test('the circle is 94 mm wide and turns clockwise round the right wheel, the 8 is two of them side by side', () => {
  const c = bounds(figurePath(FIGURES[8]).points);
  near(c.maxX - c.minX, 94, 0.5, 'circle width');
  near(c.maxY - c.minY, 94, 0.5, 'circle height');
  assert.ok(c.minX > -1 && c.maxX > 90, 'the circle is on the right of the start point');
  const e = bounds(figurePath(FIGURES[15]).points);
  near(e.maxX - e.minX, 188, 1, '8 width');
  near(e.minX, -94, 0.5);
  assert.deepEqual(figurePath(FIGURES[15]).legs.length, 2);
});

test('the rectangle is 1 x 1.5, the trapezoid has a base of 2.5 sides, the diamond and the parallelogram have 60 and 120 degree corners', () => {
  const s = sideLengthMm();
  const r = bounds(figurePath(FIGURES[9]).points);
  near(r.maxX - r.minX, 1.5 * s, 1e-9);      // up one short side, then left along a long one
  near(r.maxY - r.minY, s, 1e-9);
  const t = figurePath(FIGURES[11]);
  near(Math.hypot(t.legs[3][1][0] - t.legs[3][0][0], t.legs[3][1][1] - t.legs[3][0][1]), 2.5 * s, 1e-9);
  assert.deepEqual(FIGURES[10].steps.map((x) => x.turn), [120, 60, 120, 60]);
  assert.deepEqual(FIGURES[13].steps.map((x) => x.turn), [120, 60, 120, 60]);
});

test('startPoseFor puts the middle of the figure on the page centre, whatever the heading', () => {
  for (const f of FIGURES) {
    for (const h of [0, 90, -30]) {
      const pose = startPoseFor(f, { centre: { x: 10, y: -5 }, h });
      const b = bounds(figurePath(f, { pose }).points);
      near((b.minX + b.maxX) / 2, 10, 1e-6, `${f.key} x`);
      near((b.minY + b.maxY) / 2, -5, 1e-6, `${f.key} y`);
    }
  }
});

test('the recipe: a regular figure is one step repeated, the others list their steps', () => {
  assert.deepEqual(recipeGroups(FIGURES[3]), [{ steps: [0], repeat: 4 }]);
  assert.deepEqual(recipeGroups(FIGURES[12]), [{ steps: [0], repeat: 5 }]);
  assert.equal(recipeGroups(FIGURES[9]).length, 4);
  assert.deepEqual(recipeGroups(FIGURES[8]), [{ steps: [0], repeat: 1 }]);
  assert.deepEqual(recipeGroups(FIGURES[0]), [{ steps: [0], repeat: 1 }]);
});

test('the time a figure takes is of the right order: a square about 15 s, a circle about 15 s, the 8 about 30 s', () => {
  const sq = durationSec(FIGURES[3]);
  assert.ok(sq > 10 && sq < 30, `square ${sq}`);
  near(durationSec(FIGURES[8]), 15.4, 0.5);
  near(durationSec(FIGURES[15]), 30.6, 1);
});

test('dead reckoning follows a straight line, a circle and a turn on the spot', () => {
  const k = MM_PER_UNIT;
  const o = new Odometer(k);
  o.begin({ x: 10, y: 20, h: 90 });                           // facing left
  for (let i = 0; i <= 10; i++) o.push({ ms: i * 100, angle: 0, ml: 140, mr: 140 });
  const p = o.pose;
  near(p.x, 10 - 140 * k * 1, 1e-6, 'one second to the left');
  near(p.y, 20, 1e-6);
  near(p.h, 90, 1e-9);
  // a full circle round the right wheel: speeds 140 / 0, 15.2 s, angle going to -360
  const c = new Odometer(k);
  c.begin({ x: 0, y: 0, h: 0 });
  const total = 360 / ((140 * k / 94) * 180 / Math.PI);       // seconds
  const n = Math.round(total * 10);
  let last;
  for (let i = 0; i <= n; i++) last = c.push({ ms: i * 100, angle: -360 * (i / n), ml: 140, mr: 0 });
  assert.ok(Math.hypot(last.x, last.y) < 3, `the circle closes within 3 mm: ${Math.hypot(last.x, last.y).toFixed(2)}`);
  // turning on the spot moves nothing
  const s = new Odometer(k);
  s.begin({ x: 5, y: 5, h: 0 });
  for (let i = 0; i <= 10; i++) s.push({ ms: i * 100, angle: 9 * i, ml: -100, mr: 100 });
  near(s.pose.x, 5, 1e-9);
  near(s.pose.h, 90, 1e-9);
  // with the mode's own total of the distance (added up at every tick: 4 x the mean speed, a tick being 20 ms), the first 100 ms count too, and so does a
  // side that starts or stops between two readings
  const d = new Odometer(k);
  d.begin({ x: 0, y: 0, h: 0 });
  const perTick = 4 * 140;
  d.push({ ms: 100, angle: 0, ml: 140, mr: 140, dist: 5 * perTick });                 // moving since the start of the drawing
  d.push({ ms: 200, angle: 0, ml: 140, mr: 140, dist: 10 * perTick });
  near(d.pose.y, 10 * 140 * k * 0.02, 1e-9, 'ten ticks of speed 140 from the start');
  d.push({ ms: 300, angle: 0, ml: 0, mr: 0, dist: 10 * perTick + 3 * perTick });      // stopped after 3 more ticks (the total went on 3 ticks)
  near(d.pose.y, 13 * 140 * k * 0.02, 1e-9);
  // a gap of more than a second invents no distance
  const g = new Odometer(k);
  g.begin({ x: 0, y: 0, h: 0 });
  g.push({ ms: 0, angle: 0, ml: 140, mr: 140 });
  g.push({ ms: 5000, angle: 0, ml: 140, mr: 140 });
  near(g.pose.y, 0, 1e-9);
});

test('helpers', () => {
  const [dx, dy] = dirOf(90);
  near(dx, -1, 1e-12);
  near(dy, 0, 1e-12);
  assert.equal(wrap180(190), -170);
  assert.equal(wrap180(-190), 170);
});

test('the size scales the sides, and the circles through the wheel that the firmware stops', () => {
  const s = sideLengthMm();
  const sq = bounds(figurePath(FIGURES[3], { size: 200 }).points);
  near(sq.maxX - sq.minX, 2 * s, 1e-9);
  const half = bounds(figurePath(FIGURES[3], { size: 50 }).points);
  near(half.maxX - half.minX, s / 2, 1e-9);
  for (const [size, width] of [[100, 94], [200, 186], [300, 188 * 1.5], [50, 47], [40, 37.6]]) {
    const c = bounds(figurePath(FIGURES[8], { size }).points);
    near(c.maxX - c.minX, width, 3, `circle at ${size}`);
    assert.ok(Math.hypot(...Object.values(figurePath(FIGURES[8], { size }).end).slice(0, 2)) < 1e-6, 'it closes');
  }
  const eight = bounds(figurePath(FIGURES[15], { size: 200 }).points);
  near(eight.maxX - eight.minX, 2 * 186, 6);
  assert.deepEqual(pivotSpeeds([140, 0], 200), [140, 46]);
  assert.deepEqual(pivotSpeeds([140, 0], 50), [140, -46]);
  assert.deepEqual(pivotSpeeds([0, 140], 200), [46, 140]);
  assert.deepEqual(pivotSpeeds([140, 0], 100), [140, 0]);
  assert.ok(durationSec(FIGURES[3], { size: 200 }) > durationSec(FIGURES[3]));
  assert.ok(durationSec(FIGURES[3], { size: 50 }) < durationSec(FIGURES[3]));
});

test('a form of the page\'s own: the sides and turns the robot is told', () => {
  const steps = customSteps([[0, 40], [-40, 40], [-40, 0], [0, 0]]);
  assert.deepEqual(steps.map((x) => [Math.round(x.len), x.turn]), [[40, 90], [40, 90], [40, 90], [40, 0]]);
  // the first point is not ahead: a turn on the spot comes first
  const first = customSteps([[-30, 0], [-30, 30]]);
  assert.deepEqual(first.map((x) => [Math.round(x.len), x.turn]), [[0, 90], [30, -90], [30, 0]]);
  // a turn to the right is negative, a side straight on is no turn
  assert.deepEqual(customSteps([[0, 10], [0, 20], [10, 20]]).map((x) => x.turn), [0, -90, 0]);
  // a point on top of the one before is no side
  assert.equal(customSteps([[0, 0.2], [0, 30]]).length, 1);
  assert.deepEqual(customSteps([]), []);
});

test('the form is drawn where the points are, the turns that are whole degrees do not drift', () => {
  const pts = [[12, 31], [-17, 47], [-38.4, 9.2], [5.5, -14], [0, 0.4 + 5]];
  const fig = customFigure(pts);
  const path = figurePath(fig).points;
  const want = [[0, 0], ...pts];
  assert.equal(path.length, want.length);
  path.forEach((p, i) => near(Math.hypot(p[0] - want[i][0], p[1] - want[i][1]), 0, 0.15 * (i + 1) + 0.01, `point ${i}`));
  assert.ok(customLength(fig.steps) > 100);
  assert.equal(fig.id, 16);
  assert.equal(figureOf(16, pts).steps.length, fig.steps.length);
  assert.equal(figureOf(5), FIGURES[5]);
});

test('the robot\'s frame and the sheet: a form moves and turns with the robot', () => {
  const pose = { x: 30, y: -20, h: 90 };
  const l = { x: 12, y: 40 };
  const w = localToWorld(pose, l);
  near(w.x, 30 - 40, 1e-9);                      // facing left: ahead is -x
  near(w.y, -20 + 12, 1e-9);
  const back = worldToLocal(pose, w);
  near(back.x, 12, 1e-9);
  near(back.y, 40, 1e-9);
  const ahead = worldToLocal({ x: 0, y: 0, h: 0 }, { x: 0, y: 50 });
  near(ahead.y, 50, 1e-9);
});

test('what the robot is told of a side: time in units of 5 ms at its own speed', () => {
  near(unitsFor(40), (40 / (140 * MM_PER_UNIT)) * 200, 0.5);
  assert.equal(unitsFor(0), 0);
  assert.equal(unitsFor(0.01), 1);
  assert.equal(unitsFor(5000), 4095);
  assert.ok(unitsFor(40, mmPerUnit(10000000)) > unitsFor(40), 'a slower robot needs longer for the same length');
  assert.deepEqual(customMessage([{ len: 0, turn: 90.4 }, { len: 40, turn: -400 }]).map((x) => x.turn), [90, -360]);
});

test('a form drawn several times: each time from where the last one stopped, in the heading it stopped in', () => {
  const sq = [[0, 40], [-40, 40], [-40, 0], [0, 0]];                  // a square, which ends facing right (a quarter turn to the right of its start)
  const once = figurePath(customFigure(sq, 1)).points;
  // four times: four squares turned a quarter turn from each other, a pattern that comes back to its start
  const four = figurePath(customFigure(sq, 4));
  near(Math.hypot(four.end.x, four.end.y), 0, 1e-6, 'it comes back to where it began');
  const wide = bounds(four.points);
  assert.ok(wide.maxX - wide.minX > 70 && wide.maxY - wide.minY > 70, 'four squares round the start, not one');
  assert.equal(four.legs.length, 16);
  const three = figurePath(customFigure(sq, 3));
  near(Math.hypot(three.end.x, three.end.y), 0, 1e-6, 'a closed form always ends where it began, whatever the number of times');
  const w3 = bounds(three.points);
  assert.ok(w3.minY < -30 || w3.maxY > 30, 'three squares turned from each other, not one');
  near(three.end.h, 3 * 270, 1e-9, 'but facing a different way each time');
  // the angle it ends with: a quarter turn to the left makes each time start the way the first did, so the square goes over itself
  const same = figurePath(customFigure(sq, 3, 90));
  near(Math.hypot(same.end.x, same.end.y), 0, 1e-6);
  same.points.forEach((p) => assert.ok(once.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6), `${p} is on the first time`));
  // an open form with the angle that undoes its last side's direction: a chain
  const zig = [[15, 20], [-15, 40]];
  const one = figurePath(customFigure(zig, 1));
  const heading = customSteps(zig).reduce((h, s) => h + s.turn, 0);
  const chain = figurePath(customFigure(zig, 3, -heading));
  near(chain.end.x, 3 * one.end.x, 1e-6);
  near(chain.end.y, 3 * one.end.y, 1e-6);
  // one time and no angle: nothing changes
  assert.deepEqual(figurePath(customFigure(sq, 1)).end, figurePath(customFigure(sq)).end);
  assert.equal(customFigure(sq, 99).repeat, 50);
  assert.equal(customFigure(sq, 0).repeat, 1);
  assert.equal(customFigure(sq, 1, 999).endAngle, 180);
  assert.equal(customFigure(sq, 1, 90).steps.at(-1).turn, 90, 'the angle is the turn after the last side');
  assert.equal(totalTurn(customFigure(sq, 3)), 3 * 270);
  assert.equal(totalTurn(customFigure(sq, 3, 90)), 3 * 360);
  assert.ok(durationSec(customFigure(sq, 3)) > 2.9 * durationSec(customFigure(sq, 1)));
  assert.equal(figureOf(16, sq, 4, 30).repeat, 4);
  assert.equal(figureOf(16, sq, 4, 30).endAngle, 30);
});

test('the end of each time of a form: where it is and the heading before and after its end angle', () => {
  const sq = [[0, 40], [-40, 40], [-40, 0], [0, 0]];
  const f = figurePath(customFigure(sq, 3, 90));
  assert.equal(f.ends.length, 3);
  f.ends.forEach((e, i) => {
    near(e.x, 0, 1e-6, `time ${i + 1} ends at the start`);
    near(e.y, 0, 1e-6);
    near(e.to - e.from, 90, 1e-9, 'the angle it ends with');
    assert.equal(e.rep, i);
    assert.equal(e.last, i === 2);
  });
  near(f.ends[0].from, 270, 1e-9, 'the square ends facing right: 270 degrees to the left of up');
  near(f.ends[2].to, f.end.h, 1e-9, 'the last heading is the heading the robot stops in');
  // no angle: the heading is still marked, the arc is not (to equals from)
  const none = figurePath(customFigure(sq, 1, 0)).ends;
  assert.equal(none.length, 1);
  assert.equal(none[0].to, none[0].from);
  // a built-in figure has none
  assert.deepEqual(figurePath(FIGURES[3]).ends, []);
  // a negative angle goes the other way round
  const neg = figurePath(customFigure([[0, 30]], 2, -72)).ends;
  near(neg[1].to - neg[1].from, -72, 1e-9);
});

test('a single straight side turned by the angle it ends with, drawn again and again: a polygon', () => {
  for (const [n, angle] of [[4, 90], [3, 120], [6, 60], [5, 72]]) {
    const f = figurePath(customFigure([[0, 40]], n, angle));
    near(Math.hypot(f.end.x, f.end.y), 0, 1e-6, `${n} sides of ${angle} degrees`);
    near(bounds(f.points).maxY - bounds(f.points).minY > 0 ? 1 : 0, 1, 0);
  }
});

// Two squares drawn by a real robot (calibration 8 142 712) and measured on the paper, 2026-11-01: at 65 % and at 170 % of the firmware's size
// (sides told for 0.78 s and 2.04 s), the page planned 31 and 82 mm, the paper has 34 and 92.
test('a real robot accelerates and brakes: the model gives the two squares that were measured, and the loss does not depend on the size', () => {
  const m = robotModel(8142712, true);
  const side = (pct) => m.mm * (pct / 100) - m.loss;
  near(side(65), 34, 0.6, 'the small square');
  near(side(170), 92, 0.6, 'the big one');
  // more than the time-only length at the small size, less at none: the loss is the same mm for every side
  assert.ok(m.loss > 1.5 && m.loss < 3.5, `${m.loss} mm lost`);
  near(m.mm, 140 * m.k * 1.2, 1e-9);
  near(m.loss, 140 * m.k * (m.rampMs / 1000), 1e-9);
  near(m.rampMs, (TAU300_S * 1000 * 140) / 300, 1e-9);
  // the speed is the calibration's 15 cm at speed 300, less what that run lost to its own start-up and braking
  near(m.k, 150 / (300 * (8142712 / 5e6 - TAU300_S)), 1e-12);
  assert.ok(m.k > mmPerUnit(8142712), 'faster than the time alone says');
});

test('the virtual robot has no start-up and no braking: its model is the plain one', () => {
  const v = robotModel(9000000, false);
  near(v.mm, 46.67, 0.01);
  assert.equal(v.loss, 0);
  assert.equal(v.rampMs, 0);
  near(v.k, mmPerUnit(9000000), 1e-12);
  assert.deepEqual(robotModel(), v);
});

test('a side of the firmware is shorter by the loss, the same loss for every size and every fraction of a side', () => {
  const m = robotModel(8142712, true);
  const sq = (size) => figurePath(FIGURES[3], { mm: m.mm, loss: m.loss, size });
  near(Math.hypot(...sq(65).points[1].map((v, i) => v - sq(65).points[0][i])), m.mm * 0.65 - m.loss, 1e-9);
  near(Math.hypot(...sq(170).points[1].map((v, i) => v - sq(170).points[0][i])), m.mm * 1.7 - m.loss, 1e-9);
  const hex = figurePath(FIGURES[5], { mm: m.mm, loss: m.loss, size: 100 });          // (the sides are halved from the hexagon on)
  near(Math.hypot(hex.points[1][0] - hex.points[0][0], hex.points[1][1] - hex.points[0][1]), m.mm * (FIGURES[5].steps[0].side[0] / FIGURES[5].steps[0].side[1]) - m.loss, 1e-9);
  assert.deepEqual(figurePath(FIGURES[3], { mm: m.mm, size: 100 }).points, figurePath(FIGURES[3], { mm: m.mm, loss: 0, size: 100 }).points);
});

test('a real robot is told a little more time for each side, so that it covers the length asked; the virtual one is told no more', () => {
  const real = robotModel(8142712, true);
  const plain = robotModel(8142712, false);
  const steps = customSteps([[0, 50], [25, 75], [50, 50]]);
  const told = customMessage(steps, real.k, real.rampMs);
  const flat = customMessage(steps, plain.k, 0);
  told.forEach((m, i) => assert.equal(m.turn, flat[i].turn, 'the turns are the same'));
  // the time told, less the loss, at the speed of the robot, is the length asked: 50, 35.4 and 35.4 mm
  steps.forEach((st, i) => {
    if (!st.len) return;
    const covered = real.k * 140 * ((told[i].units * 5) / 1000 - real.rampMs / 1000);
    near(covered, st.len, 0.5, `side ${i}`);
  });
  assert.equal(unitsFor(0, real.k, real.rampMs), 0, 'a turn on the spot has no time to make up');
  assert.equal(unitsFor(-3, real.k, real.rampMs), 0);
  // the same length asked of a virtual robot is the time at speed 140 and nothing more
  near(unitsFor(50, plain.k, 0) * 5 / 1000, 50 / (140 * plain.k), 0.003);
});
