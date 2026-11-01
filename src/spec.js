// What the drawing mode is made of (src/py/drawer_mode.py, a port of main/drawer.c of the Thymio 3 firmware): the sixteen figures
// of its two menus, the numbers of the firmware, and the states. Pure data: no import, so that Node can test everything.

// ---- numbers of the firmware (drawer.c) -----------------------------------------------------------------------
export const MOVE_SPEED = 140;                  // MOVEMENT_SPEED: the wheels' speed along a side and when pivoting
export const ROT_SPEED = 100;                   // MAX_ROTATION_SPEED2: the angle controller's top speed between two sides
export const TICKS_PER_MS = 5000;               // the hardware timer counts 5 ticks per microsecond
export const SIDE_TICKS = 6000000;              // DEFAULT_FW_MOTION_DURATION: the timer ticks of one base side = 1.2 s
export const SIDE_MS = SIDE_TICKS / TICKS_PER_MS;
export const STOP_MS = 500;                     // the pause after a side (behavior.c STOP_DURATION_US)
export const AFTER_TURN_TICKS = 10;             // DELAY_AFTER_ROTATION: 10 ticks of 20 ms after a turn (or a pivot)
export const TICK_MS = 20;                      // the behaviors run at 50 Hz
export const HAND_NEAR = 1700;                  // PROX_THRESHOLD + 200 on both rear sensors: a hand is there
export const HAND_FAR = 1300;                   // PROX_THRESHOLD - 200: and it has gone
export const MAXB = 16;                         // MAX_BRIGHTNESS

// ---- the robot, as far as the drawing goes (the same model as thymio3-cards' virtual robot) ----------------------
export const FACTORY_15CM_TICKS = 9000000;      // DEFAULT_MOT15CM: 15 cm at speed 300 in 1.8 s
export const MM_PER_UNIT = 150 / 1.8 / 300;     // a wheel speed unit in mm/s: 0.278
export const WHEEL_BASE = 94;                   // mm between the two wheels
export const ROT90_NOMINAL = 16384;             // gyroscope ticks in a quarter turn

// The length of a base side in mm for a robot whose 15 cm timer is `dur15` ticks (the factory's by default): 1.2 s at speed 140, with no
// start-up and no braking (the virtual robot's).
export const sideLengthMm = (dur15 = FACTORY_15CM_TICKS) => MOVE_SPEED * mmPerUnit(dur15) * (SIDE_MS / 1000);
// mm per second for one unit of wheel speed, from the robot's own calibration (the 15 cm are driven at speed 300).
export const mmPerUnit = (dur15 = FACTORY_15CM_TICKS) => 150 / ((dur15 / TICKS_PER_MS / 1000) * 300);

// ---- the sixteen figures -----------------------------------------------------------------------------------------
// The robot's menus: two rows of eight. The left and right arrows move along a row, forward and backward change row; the Lego
// LEDs count the place in the row (front row for the polygons, back row for the shapes). `id` is the firmware's StepsIndex.
//
// A figure is a list of steps, drawn one after the other from the robot's pose, the pen being in the middle of the axle:
//   { side: [num, den], turn }   a straight side of num/den base sides, then a turn on the spot (degrees, left is positive);
//                                a turn of 0 ends the figure at once (the line)
//   { pivot: [left, right] }     the wheels' speeds: the robot turns a full circle around the stopped wheel
export const GROUPS = ['polygons', 'shapes', 'custom'];

const poly = (n, turn, den = 1) => Array.from({ length: n }, () => ({ side: [1, den], turn }));

export const FIGURES = [
  // polygons: the turn is 360 / n (the firmware's table is 0 120 120 90 72 60 51 45), the sides are halved from the hexagon on
  { id: 0, group: 'polygons', key: 'line', steps: poly(1, 0) },
  { id: 1, group: 'polygons', key: 'angle', steps: poly(2, 120) },
  { id: 2, group: 'polygons', key: 'triangle', steps: poly(3, 120) },
  { id: 3, group: 'polygons', key: 'square', steps: poly(4, 90) },
  { id: 4, group: 'polygons', key: 'pentagon', steps: poly(5, 72) },
  { id: 5, group: 'polygons', key: 'hexagon', steps: poly(6, 60, 2) },
  { id: 6, group: 'polygons', key: 'heptagon', steps: poly(7, 51, 2) },
  { id: 7, group: 'polygons', key: 'octagon', steps: poly(8, 45, 2) },
  // shapes
  { id: 8, group: 'shapes', key: 'circle', steps: [{ pivot: [MOVE_SPEED, 0] }] },
  { id: 9, group: 'shapes', key: 'rectangle', steps: [{ side: [1, 1], turn: 90 }, { side: [3, 2], turn: 90 }, { side: [1, 1], turn: 90 }, { side: [3, 2], turn: 90 }] },
  { id: 10, group: 'shapes', key: 'diamond', steps: [{ side: [1, 1], turn: 120 }, { side: [1, 1], turn: 60 }, { side: [1, 1], turn: 120 }, { side: [1, 1], turn: 60 }] },
  { id: 11, group: 'shapes', key: 'trapezoid', steps: [{ side: [1, 1], turn: 42 }, { side: [1, 1], turn: 42 }, { side: [1, 1], turn: 138 }, { side: [5, 2], turn: 138 }] },
  { id: 12, group: 'shapes', key: 'star5', steps: poly(5, 144) },
  { id: 13, group: 'shapes', key: 'parallelogram', steps: [{ side: [1, 1], turn: 120 }, { side: [3, 2], turn: 60 }, { side: [1, 1], turn: 120 }, { side: [3, 2], turn: 60 }] },
  { id: 14, group: 'shapes', key: 'star7', steps: poly(7, 154) },
  { id: 15, group: 'shapes', key: 'eight', steps: [{ pivot: [MOVE_SPEED, 0] }, { pivot: [0, MOVE_SPEED] }] },
];
export const FIGURE_COUNT = FIGURES.length;
export const GROUP_SIZE = 8;

export const figureAt = (id) => FIGURES[Math.max(0, Math.min(FIGURE_COUNT - 1, Math.trunc(Number(id)) || 0))];
export const groupOf = (id) => (id >= CUSTOM_ID ? 'custom' : id < GROUP_SIZE ? 'polygons' : 'shapes');
export const placeInGroup = (id) => (id >= CUSTOM_ID ? 0 : (id % GROUP_SIZE) + 1);            // what the Lego LEDs count: 1..8
export const idOf = (group, place) => (group === 'shapes' ? GROUP_SIZE : 0) + Math.max(0, Math.min(GROUP_SIZE - 1, place - 1));

// What the arrows do: left and right go round in the row, forward and backward change row (to the first figure of the other one).
export const stepSelection = (id, delta) => {
  const base = id < GROUP_SIZE ? 0 : GROUP_SIZE;
  return base + ((((id - base) + delta) % GROUP_SIZE) + GROUP_SIZE) % GROUP_SIZE;
};
export const otherGroupFirst = (id) => (id < GROUP_SIZE ? GROUP_SIZE : 0);

// ---- size, and a form of the page's own (extras: the firmware has neither) ---------------------------------------------------------
// The size is a percent of the firmware's: the sides last that much as long, and a circle's radius is that much of the firmware's (the
// wheel that the firmware stops turns forward for a bigger circle, backward for a smaller one).
export const SIZE_MIN = 40;
export const SIZE_MAX = 300;
export const SIZE_DEFAULT = 100;
export const clampSize = (v) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(Number(v) || SIZE_DEFAULT)));
const tdiv = (a, b) => Math.trunc(a / b);
export const pivotSpeeds = ([l, r], size = SIZE_DEFAULT) => {
  if (size === SIZE_DEFAULT) return [l, r];
  return l > r ? [l, tdiv(l * (size - 100), size + 100)] : [tdiv(r * (size - 100), size + 100), r];
};

// The page's own form is figure 16, which the robot's arrows do not reach: a list of sides, each a time and the turn that follows it
// (a time of 0 is a turn on the spot, for the first one). A time is told in units of 5 ms, 12 bits: up to 20 s, 797 mm.
export const CUSTOM_ID = 16;
export const CUSTOM_MAX_STEPS = 24;                // sides, with the turn on the spot that may come first
export const CUSTOM_UNIT_MS = 5;
export const CUSTOM_UNITS_MAX = 4095;
// The page's own form can be drawn several times: each time from where the last one stopped, in the heading it stopped in, so that a form
// that does not end the way it began makes a pattern. The turn after its last side is the angle it ends with (made every time, 0 by default).
export const END_ANGLE_MAX = 180;
export const clampEndAngle = (v) => Math.max(-END_ANGLE_MAX, Math.min(END_ANGLE_MAX, Math.round(Number(v) || 0)));
export const REPEAT_MIN = 1;
export const REPEAT_MAX = 50;
export const clampRepeat = (v) => Math.max(REPEAT_MIN, Math.min(REPEAT_MAX, Math.round(Number(v) || REPEAT_MIN)));

// A few forms to start from, as points in the robot's frame in mm (its pen at 0, 0, facing up; the pen goes through them in this order).
export const CUSTOM_PRESETS = {
  house: [[0, 50], [25, 75], [50, 50], [50, 0], [0, 0]],
  arrow: [[0, 60], [-15, 42], [0, 60], [15, 42]],
  zigzag: [[15, 20], [-15, 40], [15, 60], [-15, 80]],
  spiral: [[0, 15], [-15, 15], [-15, -15], [15, -15], [15, 30], [-30, 30], [-30, -30], [30, -30]],
};

// ---- states ----------------------------------------------------------------------------------------------------------
export const STATES = { 0: 'idle', 1: 'draw', 2: 'blink' };
export const STATE_CODE = { idle: 0, draw: 1, blink: 2 };

// The colours the sensor under the robot tells apart, and which of them light the body (HandleBodyColor: the others, cyan and
// black and unknown, switch it off).
export const GROUND = { r: '#e5413b', y: '#f2c200', g: '#1fae4d', c: '#18b5c9', b: '#2a6fe0', p: '#a24bd8', w: '#ffffff', k: '#111111' };
export const GROUND_CODES = Object.keys(GROUND);
export const BODY_LIGHT = { r: [1, 0, 0], y: [1, 1, 0], g: [0, 1, 0], b: [0, 0, 1], p: [1, 0, 1], w: [1, 1, 1] };

// ---- a real robot's motion: it accelerates, then brakes -------------------------------------------------------------
// The wheels do not go at once from 0 to their speed, nor back: a side told for T seconds covers `speed x (T - loss)`, where the loss (the
// time the robot would have gone without starting up and braking) is the same for every side whatever its length, and grows with the speed:
// loss = TAU300_S x speed / 300 (an acceleration of about 2600 speed units per second per second). The firmware's own "15 cm" calibration is
// made at speed 300 and has this loss in it (D ticks for 150 mm = 300 x (D - TAU300_S) of steady running), so the speed that gives mm
// per second is not 150 / (300 D) but 150 / (300 (D - TAU300_S)). TAU300_S is fitted on two squares drawn by a real robot and measured on the
// paper (2026-11-01, calibration 8 142 712): sides told for 0.78 s and 2.04 s covered 34 mm and 92 mm, where the page had planned 31 and 82.
// The two numbers it gives are 33.6 and 91.9.
export const TAU300_S = 0.115;
// What the page needs to know of the robot, for its 15 cm timer `dur15` and whether it is a real one:
//   k       mm per second of one unit of target speed (the page tells the robot a time, from a length)
//   mm      the side at 100 %, were there no start-up and braking
//   loss    the mm a timed side loses to them, whatever its length
//   rampMs  the same, as the time to add to a side to cover the length asked
export function robotModel(dur15 = FACTORY_15CM_TICKS, real = false) {
  const plain = mmPerUnit(dur15);
  if (!real) return { k: plain, mm: MOVE_SPEED * plain * (SIDE_MS / 1000), loss: 0, rampMs: 0 };
  const k = 150 / (300 * (dur15 / TICKS_PER_MS / 1000 - TAU300_S));
  const rampSec = (TAU300_S * MOVE_SPEED) / 300;
  return { k, mm: MOVE_SPEED * k * (SIDE_MS / 1000), loss: MOVE_SPEED * k * rampSec, rampMs: rampSec * 1000 };
}
