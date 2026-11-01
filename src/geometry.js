// The geometry of the figures, in millimetres: where the pen goes for each figure, where the robot has been (dead reckoning from what
// it says), and what to put on the page. Pure functions, no browser: Node can test everything.
//
// Frame: x to the right, y up (the sheet seen from above, the robot's first heading is up). A heading is in degrees, counter-clockwise
// from "up", like the gyroscope's angle and the firmware's turns (a left turn is positive). The pen is in the middle of the axle.
import {
  FIGURES, MM_PER_UNIT, WHEEL_BASE, MOVE_SPEED, SIDE_MS, sideLengthMm, pivotSpeeds, SIZE_DEFAULT, CUSTOM_ID, CUSTOM_UNIT_MS, CUSTOM_UNITS_MAX, CUSTOM_MAX_STEPS,
  clampRepeat, clampEndAngle,
} from './spec.js';

export const rad = (deg) => (deg * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const dirOf = (h) => [-Math.sin(rad(h)), Math.cos(rad(h))];       // the way a robot with heading h goes
export const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

const ARC_STEP = 5;                                                      // degrees between two points of a circle

// The pen's path of one figure from a pose { x, y, h }. Returns
//   { legs: [[ [x, y], ... ] per step], points: all of them (the legs are joined), end: { x, y, h },
//     ends: [{ x, y, from, to, rep, last }] }   (a form of the page's own: where each time ends, the heading before and after its end angle)
// `mm` is the length of a base side (sideLengthMm of the robot), `wheelBase` the distance between the wheels, `size` the percent of the
// firmware's size (sides and circles; a form of the page's own has its lengths in mm and no size). `loss`: the mm a timed side loses to the
// robot's start-up and braking, the same for every side (robotModel): a side of the firmware is its time, so it is `mm` scaled, less the loss.
export function figurePath(fig, { pose = { x: 0, y: 0, h: 0 }, mm = sideLengthMm(), wheelBase = WHEEL_BASE, size = SIZE_DEFAULT, loss = 0 } = {}) {
  let { x, y, h } = pose;
  const legs = [];
  const ends = [];
  const times = fig.repeat > 1 ? fig.repeat : 1;
  const steps = times === 1 ? fig.steps : Array.from({ length: times }, () => fig.steps).flat();
  const per = fig.steps.length;
  for (let n = 0; n < steps.length; n++) {
    const step = steps[n];
    if (step.len != null) {
      const [dx, dy] = dirOf(h);
      if (step.len > 0) {
        legs.push([[x, y], [x + dx * step.len, y + dy * step.len]]);
        x += dx * step.len;
        y += dy * step.len;
      }
      const before = h;
      h += step.turn;
      if (n % per === per - 1) ends.push({ x, y, from: before, to: h, rep: Math.floor(n / per), last: n === steps.length - 1 });
    } else if (step.side) {
      const len = Math.max(0, (mm * step.side[0] * size) / (step.side[1] * 100) - loss);
      const [dx, dy] = dirOf(h);
      legs.push([[x, y], [x + dx * len, y + dy * len]]);
      x += dx * len;
      y += dy * len;
      h += step.turn;
    } else {
      // pivot: the wheels' speeds (l, r) make an arc of radius (l + r) / 2 * wheelBase / |r - l|, a full turn of 360 degrees
      const [l, r] = pivotSpeeds(step.pivot, size);
      const sgn = step.pivot[1] > step.pivot[0] ? 1 : -1;
      const radius = (((l + r) / 2) * wheelBase) / Math.abs(r - l);
      const cx = x + sgn * radius * -Math.cos(rad(h));
      const cy = y + sgn * radius * -Math.sin(rad(h));
      const leg = [];
      for (let a = 0; a <= 360; a += ARC_STEP) {
        const hh = h + sgn * a;
        leg.push([cx + sgn * radius * Math.cos(rad(hh)), cy + sgn * radius * Math.sin(rad(hh))]);
      }
      legs.push(leg);
      [x, y] = leg[leg.length - 1];
      h += sgn * 360;
    }
  }
  const points = legs.flatMap((leg, i) => (i === 0 ? leg : leg.slice(1)));
  return { legs, points, end: { x, y, h }, ends };
}

export function bounds(points) {
  if (!points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

export const centreOf = (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

// Where to put the robot so that the figure is in the middle of a page's centre (cx, cy): the start pose for a heading `h`.
export function startPoseFor(fig, { centre = { x: 0, y: 0 }, h = 0, mm, wheelBase, size, loss } = {}) {
  const path = figurePath(fig, { pose: { x: 0, y: 0, h }, mm, wheelBase, size, loss });
  const c = centreOf(bounds(path.points));
  return { x: centre.x - c.x, y: centre.y - c.y, h };
}

// Does the figure come back to where it started? The gap in mm between the end of the pen's path and its start, and the heading
// it ends with (a polygon ends facing the way it started: 360 degrees; the heptagon's 7 x 51 is 357).
export function closure(fig, opts = {}) {
  const p = figurePath(fig, opts);
  const gap = Math.hypot(p.end.x, p.end.y);
  return { gap, turned: p.end.h, closes: gap < 1.5 };
}

export const totalTurn = (fig) => fig.steps.reduce((sum, s) => sum + (s.pivot ? Math.sign(s.pivot[1] - s.pivot[0]) * 360 : s.turn), 0) * (fig.repeat || 1);

// The steps of a figure as the recipe card shows them: a regular figure is one group repeated, the others a row per step.
// [{ steps: [index, ...], repeat }]
export function recipeGroups(fig) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const first = fig.steps[0];
  if (fig.steps.length > 1 && fig.steps.every((s) => same(s, first))) return [{ steps: [0], repeat: fig.steps.length }];
  return fig.steps.map((_, i) => ({ steps: [i], repeat: 1 }));
}

// How long the robot takes (seconds), as it drives: the sides at speed 140 for 1.2 s each, a pause after each, the turns at about
// 34 degrees a second (speed 100 at most) and the pivots (one wheel at speed 140: 15 s a circle). A guide, not a promise.
export function durationSec(fig, { mmPerUnit = MM_PER_UNIT, wheelBase = WHEEL_BASE, size = SIZE_DEFAULT } = {}) {
  let t = 0;
  const turning = (a) => 0.8 + Math.abs(a) / (((ROT_RATE * mmPerUnit) / wheelBase) * (180 / Math.PI)) + 0.2;
  const times = fig.repeat || 1;
  fig.steps.forEach((s, i) => {
    if (s.len != null) {
      if (s.len > 0) t += (s.len / (MOVE_SPEED * mmPerUnit) + 0.5) * times;
      if (s.turn) t += turning(s.turn) * times;
    } else if (s.side) {
      t += ((SIDE_MS / 1000) * (s.side[0] / s.side[1]) * size) / 100 + 0.5;
      if (s.turn) t += turning(s.turn);
    } else {
      const [l, r] = pivotSpeeds(s.pivot, size);
      t += 360 / deg((Math.abs(r - l) * mmPerUnit) / wheelBase) + 0.2;
    }
  });
  return t;
}
const ROT_RATE = 2 * 100;                                                // both wheels at speed 100, opposite: 200 units of difference

// ---- dead reckoning: where the robot is, from what it says ---------------------------------------------------------------
// The mode says, every 100 ms, the gyroscope's angle since the drawing began and the distance it has driven since, added up by the mode at
// every tick of 20 ms (the speed of the tick before, or the mean of the two when it dropped: the wheels stopped half way) (a side starts and ends between two readings, so a distance worked out from the speeds of two readings is out by a few
// millimetres at each side, and the first 100 ms of a drawing would be lost). The heading is the start heading plus the angle; the distance
// of a reading is the difference of the two totals, along the mean heading of the two readings. A mode that gives no total: the mean speed
// of the two readings times the time.
export const DIST_TICK_S = 0.02;                                    // a tick of the mode
export const DIST_FACTOR = 4;                                       // the total adds 4 x the mean speed (in units of speed) at each tick
export class Odometer {
  constructor(mmPerUnit = MM_PER_UNIT) {
    this.k = mmPerUnit;
    this.pose = { x: 0, y: 0, h: 0 };
    this.base = 0;
    this.prev = null;
  }

  begin(pose) {
    this.pose = { ...pose };
    this.base = pose.h;
    this.prev = { ms: null, angle: 0, ml: 0, mr: 0, dist: 0 };      // (the angle and the total are 0 when the drawing begins)
    return this.pose;
  }

  // sample: { ms, angle (degrees since the drawing began), ml, mr, dist (the total, or null) }. Returns the new pose.
  push(sample) {
    const p = this.pose;
    const prev = this.prev;
    if (prev && sample.dist != null && prev.dist != null) {
      const s = ((sample.dist - prev.dist) / DIST_FACTOR) * this.k * DIST_TICK_S;
      const [dx, dy] = dirOf(this.base + (prev.angle + sample.angle) / 2);
      p.x += dx * s;
      p.y += dy * s;
    } else if (prev && prev.ms != null) {
      const dt = (sample.ms - prev.ms) / 1000;
      if (dt > 0 && dt <= 1) {
        const v = ((prev.ml + prev.mr + sample.ml + sample.mr) / 4) * this.k;
        const [dx, dy] = dirOf(this.base + (prev.angle + sample.angle) / 2);
        p.x += dx * v * dt;
        p.y += dy * v * dt;
      }
    }
    p.h = this.base + sample.angle;
    this.prev = sample;
    return { ...p };
  }
}

// ---- a form of the page's own ---------------------------------------------------------------------------------------------------
// It is told as points on the sheet, in the robot's own frame (the pen is the origin and the robot faces "up", x to its right): moving or
// turning the robot moves and turns the form with it. The robot is told sides: a first turn on the spot (a side of no length) if the
// first point is not straight ahead, then each side's length and the turn that follows it (none after the last).
export const worldToLocal = (pose, w) => {
  const a = rad(pose.h);
  const dx = w.x - pose.x;
  const dy = w.y - pose.y;
  return { x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a) };
};
export const localToWorld = (pose, l) => {
  const a = rad(pose.h);
  return { x: pose.x + l.x * Math.cos(a) - l.y * Math.sin(a), y: pose.y + l.x * Math.sin(a) + l.y * Math.cos(a) };
};

// The sides of the form through these local points: [{ len (mm), turn (degrees, the turn that follows) }]. The turns are whole degrees
// that add up to the whole degrees of each side's direction, so that they do not drift.
export function customSteps(points) {
  const P = [[0, 0], ...points];
  const sides = [];
  let cum = 0;
  let told = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const dx = P[i + 1][0] - P[i][0];
    const dy = P[i + 1][1] - P[i][1];
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    cum += wrap180(deg(Math.atan2(-dx, dy)) - cum);
    const target = Math.round(cum);
    sides.push({ len, before: target - told });
    told = target;
  }
  const steps = [];
  if (sides.length && sides[0].before) steps.push({ len: 0, turn: sides[0].before });
  sides.forEach((s, i) => steps.push({ len: s.len, turn: i + 1 < sides.length ? sides[i + 1].before : 0 }));
  return steps.slice(0, CUSTOM_MAX_STEPS);
}

// A figure like the others, from local points: its sides (the turn after the last one is `endAngle`, the angle it ends with), drawn `repeat`
// times, each time from where the last one stopped and in the heading it stopped in.
export function customFigure(points, repeat = 1, endAngle = 0) {
  const steps = customSteps(points);
  if (steps.length) steps[steps.length - 1] = { ...steps[steps.length - 1], turn: clampEndAngle(endAngle) };
  return { id: CUSTOM_ID, group: 'custom', key: 'custom', steps, repeat: clampRepeat(repeat), endAngle: clampEndAngle(endAngle) };
}

// The figure of an id: one of the sixteen, or the page's own form (drawn `repeat` times, ending with `endAngle` degrees of turn).
export const figureOf = (id, custom = [], repeat = 1, endAngle = 0) => (id >= CUSTOM_ID ? customFigure(custom, repeat, endAngle) : FIGURES[Math.max(0, Math.trunc(id) || 0)]);

// What the robot is told of a side: its time in units of 5 ms, from the robot's own speed (mm per second per unit of speed).
// `rampMs`: the time a side loses to the speed controller (see RAMP_MS): the robot is told that much more, to cover the length asked.
export const unitsFor = (len, mmPerUnit = MM_PER_UNIT, rampMs = 0) => (len <= 0 ? 0 : Math.max(1, Math.min(CUSTOM_UNITS_MAX, Math.round(((len / (MOVE_SPEED * mmPerUnit)) * 1000 + rampMs) / CUSTOM_UNIT_MS))));
export const customMessage = (steps, mmPerUnit, rampMs = 0) => steps.map((s) => ({ units: unitsFor(s.len, mmPerUnit, rampMs), turn: Math.max(-360, Math.min(360, Math.round(s.turn))) }));

// The length of a form in mm, all its sides.
export const customLength = (steps) => steps.reduce((sum, s) => sum + s.len, 0);

// The first figure whose key is `key`.
export const figureByKey = (key) => FIGURES.find((f) => f.key === key);
export { MOVE_SPEED };
