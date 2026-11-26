// The ink the page draws from what the robot says, against the path the robot is told: a form of the page's own at several places and headings.
// The page does not see the robot, it follows it by dead reckoning (src/geometry.js: Odometer), and its ink must lie on the dotted line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Telemetry } from '../src/store.js';
import { SimBackend } from '../src/sim/sim-backend.js';
import { figurePath, customMessage, figureOf } from '../src/geometry.js';
import { programFigure } from '../src/program.js';
import { mmPerUnit, CUSTOM_ID } from '../src/spec.js';
import { CMD } from '../src/protocol.js';

const wait = () => new Promise((r) => setImmediate(r));

async function drawn(pose, worldPoints, repeat = 1, endAngle = 0) {
  const tele = new Telemetry(CUSTOM_ID);
  const sim = new SimBackend((e) => tele.push(e), { speed: 10 });
  sim.start({ sel: CUSTOM_ID });
  tele.place(pose);
  sim.place(pose);
  for (const w of worldPoints) tele.customAdd({ x: w[0], y: w[1] });
  tele.chooseRepeat(repeat);
  tele.chooseEndAngle(endAngle);
  const steps = figureOf(CUSTOM_ID, tele.s.custom, repeat, endAngle).steps;
  sim.apply({ select: CUSTOM_ID, custom: customMessage(steps, mmPerUnit(tele.s.cal.fw)), repeat, command: CMD.START });
  for (let i = 0; i < 3000 && !tele.s.draws; i++) { sim.advance(100); await wait(); }
  await new Promise((r) => setTimeout(r, 150));
  const stroke = tele.s.ink[0];
  const ghost = figurePath(figureOf(CUSTOM_ID, tele.s.custom, repeat, endAngle), { pose: stroke.start, mm: tele.s.mm }).points;
  const dist = (p) => {
    let best = Infinity;
    for (let i = 0; i + 1 < ghost.length; i++) {
      const [ax, ay] = ghost[i];
      const [bx, by] = ghost[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
    }
    return best;
  };
  return { tele, sim, ghost, stroke, deviation: Math.max(...stroke.points.map(dist)) };
}

const CASES = [
  ['straight ahead', { x: 0, y: 0, h: 0 }, [[0, 40], [-40, 40], [-40, 0]]],
  ['the first point is to the left: a turn on the spot first', { x: 0, y: 0, h: 0 }, [[-40, 0], [-40, 40], [0, 40]]],
  ['the first point is behind', { x: 0, y: 0, h: 0 }, [[0, -40], [30, -40]]],
  ['the robot faces left, off the middle', { x: -20, y: 15, h: 90 }, [[-60, 15], [-60, 55], [-20, 55]]],
  ['the robot is turned 35 degrees to the right', { x: 30, y: -10, h: -35 }, [[60, 20], [90, -10], [30, -10]]],
  ['a house', { x: 0, y: 0, h: 0 }, [[0, 50], [25, 75], [50, 50], [50, 0], [0, 0]]],
  ['short sides', { x: 0, y: 0, h: 0 }, [[0, 8], [8, 8], [8, 16], [16, 16], [16, 24]]],
];

const HOUSE = [[0, 50], [25, 75], [50, 50], [50, 0], [0, 0]];
const REPEATED = [
  ['a house drawn four times: each from where the last stopped, a rosette', { x: 0, y: 0, h: 0 }, HOUSE, 4, 0],
  ['a square over itself, with the angle it ends with', { x: 0, y: 0, h: 0 }, [[0, 40], [-40, 40], [-40, 0], [0, 0]], 3, 90],
  ['one straight side and an angle of 72: a pentagon', { x: 0, y: 0, h: 0 }, [[0, 30]], 5, 72],
  ['a form turned 60 degrees, twice, ending with 36', { x: 10, y: -20, h: 60 }, [[10, 40], [50, 45], [40, 10]], 2, 36],
];

for (const [name, pose, pts, times, angle] of [...CASES.map((c) => [...c, 1, 0]), ...REPEATED]) {
  test(`the ink lies on the planned line, and ends where the robot is: ${name}`, async () => {
    const { tele, sim, deviation, ghost, stroke } = await drawn(pose, pts, times, angle);
    assert.ok(deviation < 1.5, `the ink is ${deviation.toFixed(2)} mm from the planned line`);
    const body = sim.robot.body;
    assert.ok(Math.hypot(tele.s.pose.x - body.x, tele.s.pose.y - body.y) < 1.5, `the estimated end ${tele.s.pose.x.toFixed(1)}, ${tele.s.pose.y.toFixed(1)} is not where the robot is ${body.x.toFixed(1)}, ${body.y.toFixed(1)}`);
    if (times > 1) assert.equal(tele.s.rep, times - 1, 'it was in its last time');
    const first = stroke.points[0];
    assert.ok(Math.hypot(first[0] - ghost[0][0], first[1] - ghost[0][1]) < 1e-6, 'the ink begins at the pen');
  });
}

const turtle = {
  'a square': [{ op: 'x', v: 4, body: [{ op: 'f', v: 40 }, { op: 'l', v: 90 }] }],
  'a five-pointed star': [{ op: 'x', v: 5, body: [{ op: 'f', v: 60 }, { op: 'r', v: 144 }] }],
  'stairs': [{ op: 'x', v: 4, body: [{ op: 'f', v: 20 }, { op: 'l', v: 90 }, { op: 'f', v: 20 }, { op: 'r', v: 90 }] }],
  'a rosette of squares, a loop in a loop': [{ op: 'x', v: 8, body: [{ op: 'x', v: 4, body: [{ op: 'f', v: 30 }, { op: 'l', v: 90 }] }, { op: 'l', v: 45 }] }],
  'a turn first, then lines and angles with no loop': [{ op: 'r', v: 45 }, { op: 'f', v: 30 }, { op: 'l', v: 60 }, { op: 'f', v: 20 }],
};
for (const [name, program] of Object.entries(turtle)) {
  test(`a geometric program is drawn on the line it plans, by the virtual robot: ${name}`, async () => {
    const tele = new Telemetry(CUSTOM_ID, { program, mine: 'program' });
    const sim = new SimBackend((e) => tele.push(e), { speed: 10 });
    sim.start({ sel: CUSTOM_ID });
    tele.place({ x: 0, y: 0, h: 0 });
    sim.place(tele.s.pose);
    const fig = programFigure(program);
    sim.apply({ select: CUSTOM_ID, custom: customMessage(fig.steps, mmPerUnit(tele.s.cal.fw)), repeat: fig.repeat, command: CMD.START });
    for (let i = 0; i < 9000 && !tele.s.draws; i++) { sim.advance(100); await wait(); }
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(tele.s.draws, 1);
    const stroke = tele.s.ink[0];
    const plan = figurePath(tele.figureNow(), { pose: stroke.start, mm: tele.s.mm }).points;
    const dist = (p) => Math.min(...plan.slice(1).map((b, i) => {
      const [ax, ay] = plan[i];
      const dx = b[0] - ax, dy = b[1] - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
    }));
    const deviation = Math.max(...stroke.points.map(dist));
    assert.ok(deviation < 2, `the ink is ${deviation.toFixed(2)} mm from the planned line`);
    assert.equal(tele.s.rep, fig.repeat - 1, 'it was in its last time');
  });
}
