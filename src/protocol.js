// The words between the page and the mode that runs on the robot (src/py/drawer_mode.py).
// Pure helpers, no import of the browser: Node can test them.
import { STATES, GROUND_CODES, CUSTOM_ID, SIZE_MIN, SIZE_MAX, clampSize, clampRepeat } from './spec.js';

// ---- robot -> page: "@@word ..." lines on stdout -------------------------------------------------
// stdout arrives in BLE notifications cut anywhere: rebuild complete lines. A line ends with a newline,
// or with \x1e (record separator): the mode pads its lines to 100 bytes and ends them that way so that
// the firmware sends them at once (see say() in drawer_mode.py).
export class LineAssembler {
  constructor() { this.rest = ''; }
  push(text) {
    const parts = (this.rest + text).split(/[\r\n\x1e]+/);
    this.rest = parts.pop();
    return parts.filter((l) => l.trim());           // blank lines go; the others keep their indentation (a Traceback has some)
  }
}

const ints = (a, n) => a.slice(0, n).map(Number);
const finite = (a) => a.every(Number.isFinite);

// One line of stdout -> an event, or null for anything else (print() of other scripts, noise).
//   @@n ms state figure step angle left right colour rearL rearR dist   every 100 ms: the time since the mode began, 0 idle / 1 drawing / 2 blinking,
//                                                                  the figure (0..15), its step in progress, the gyro's angle since the drawing began
//                                                                  (tenths of a degree), the wheels' measured speeds, the colour seen under the robot
//                                                                  (r y g c b p w k, or ?), the two rear proximity readings, the distance driven
//                                                                  since the drawing began (added up at every tick: 4 x mean speed x ticks)
//   @@sel figure                  the figure chosen (0..15, or 16 for the page's own form; changed from the robot's arrows or by the page, and every 3 s)
//   @@size percent                the size, in percent of the firmware's (40..300)
//   @@draw figure                 a drawing begins (the angle has just been reset: the page starts its dead reckoning here)
//   @@seg step s|t                a side (or a pivot) begins / a turn begins
//   @@end figure                  the drawing is done (the circle blinks next)
//   @@rep n                       the page's own form begins its n-th time (n from 1: the first time is said by @@draw)
//   @@stop                        the drawing was stopped by the page
//   @@cal fw bw rot90             the robot's own calibration: timer ticks for 15 cm forward and backward, gyro ticks in 90 degrees
//   @@state idle|draw|blink
//   @@ack msg                     the message of the page was applied
export function parseRobotLine(line) {
  const l = line.trim();
  // (a Traceback is several lines: the robot backend reads it as a whole)
  if (/^\w*(Error|Exception)\b/.test(l)) return { type: 'error', message: l };
  const m = /^@@(\w+)\s*(.*)$/.exec(l);
  if (!m) return null;
  const [, word, rest] = m;
  const a = rest.split(/\s+/).filter(Boolean);
  switch (word) {
    case 'hello': return { type: 'hello', version: Number(a[0]) || 1 };
    case 'bat': { const v = Number(a[0]); return { type: 'battery', volts: v > 100 ? v / 1000 : v }; }
    case 'cal': {
      const v = ints(a, 3);
      if (v.length < 3 || !finite(v) || v[0] <= 0) return null;
      return { type: 'cal', fw: v[0], bw: v[1], rot90: v[2] };
    }
    case 'state': return Object.values(STATES).includes(a[0]) ? { type: 'state', state: a[0] } : null;
    case 'n': {
      const v = ints(a.slice(0, 7), 7);
      if (a.length < 10 || v.length < 7 || !finite(v)) return null;
      const p = ints(a.slice(8, 10), 2);
      if (!finite(p)) return null;
      const colour = GROUND_CODES.includes(a[7]) ? a[7] : '?';
      const dist = a.length > 10 && Number.isFinite(Number(a[10])) ? Number(a[10]) : null;      // (a mode that does not say it: null)
      return { type: 'n', ms: v[0], state: STATES[v[1]] || 'idle', figure: v[2], step: v[3], angle: v[4] / 10, left: v[5], right: v[6], colour, rear: p, dist };
    }
    case 'sel': { const f = Number(a[0]); return Number.isInteger(f) && f >= 0 && f <= CUSTOM_ID ? { type: 'sel', figure: f } : null; }
    case 'draw': { const f = Number(a[0]); return Number.isInteger(f) && f >= 0 && f <= CUSTOM_ID ? { type: 'draw', figure: f } : null; }
    case 'size': { const v = Number(a[0]); return Number.isFinite(v) && v >= SIZE_MIN && v <= SIZE_MAX ? { type: 'size', size: v } : null; }
    case 'seg': { const k = Number(a[0]); return Number.isInteger(k) && k >= 0 && (a[1] === 's' || a[1] === 't') ? { type: 'seg', step: k, phase: a[1] } : null; }
    case 'end': { const f = Number(a[0]); return { type: 'end', figure: Number.isInteger(f) ? f : -1 }; }
    case 'rep': { const r = Number(a[0]); return Number.isInteger(r) && r >= 0 ? { type: 'rep', rep: r } : null; }
    case 'stop': return { type: 'stop' };
    case 'ack': return { type: 'ack', msg: Number(a[0]) };
    case 'exit': return { type: 'exit' };
    case 'bye': return { type: 'bye' };
    default: return null;
  }
}

// ---- page -> robot: messages written in the four body LEDs ------------------------------------
// The firmware stores the LEDs it is given by the Bluetooth command and the mode reads them back (see
// rx_poll in drawer_mode.py, which is the other end of this). A frame is twelve 4-bit values, one per colour
// channel of the four body LEDs: 0 message number, 1 always 15 (the mode never writes 15 on that channel),
// 2 last-frame flag (8) + frame number, 3..10 eight nibbles of the message, 11 checksum. The message: the
// number of items (two nibbles), then the items, five nibbles each: a key (two) and a value (three, signed
// 12 bits). At most eight frames: 12 items. Keys: 0 the figure to draw (0..16), 1 a command, 2 the size (percent), 3 forget the page's own
// form, 4 a side of it (units of 5 ms; 0 is a turn on the spot), 5 the turn (degrees) that follows the side told last, 6 how many times to
// draw the form (each time from where the last one stopped, in the heading it stopped in; the turn after its last side is the angle the form
// ends with, made at the end of every time).
export const KEY = { SELECT: 0, COMMAND: 1, SIZE: 2, CUSTOM_CLEAR: 3, CUSTOM_SIDE: 4, CUSTOM_TURN: 5, CUSTOM_REPEAT: 6 };
export const CMD = { START: 1, STOP: 2, QUIT: 3, REPORT: 4 };
export const LIVE_MARK = 15;
export const MAX_FRAMES = 8;
export const MAX_ITEMS = 12;

export const frameSum = (n) => { let t = 5; for (let i = 0; i < 11; i++) t += (i + 1) * n[i]; return t & 15; };
export const isFrame = (n) => !!n && n.length === 12 && n[1] === LIVE_MARK && frameSum(n) === n[11];

export const selectItem = (figure) => [KEY.SELECT, Math.max(0, Math.min(CUSTOM_ID, Math.trunc(figure)))];
export const commandItem = (code) => [KEY.COMMAND, code];
export const sizeItem = (percent) => [KEY.SIZE, clampSize(percent)];
export const repeatItem = (times) => [KEY.CUSTOM_REPEAT, clampRepeat(times)];
// The page's own form, as the items that tell it: [{ units, turn }] (see geometry.js: customMessage).
export const customItems = (steps) => [[KEY.CUSTOM_CLEAR, 0], ...steps.flatMap((s) => [[KEY.CUSTOM_SIDE, s.units], [KEY.CUSTOM_TURN, s.turn]])];

// The frames (1 to 8) that carry these [key, value] items, or null when they do not fit.
export function encodeMessage(items, msg = 1) {
  if (items.length > MAX_ITEMS) return null;
  const stream = [items.length >> 4, items.length & 15];
  for (const [key, value] of items) {
    const v = value & 0xfff;
    stream.push(key >> 4, key & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15);
  }
  const count = Math.max(1, Math.ceil(stream.length / 8));
  if (count > MAX_FRAMES) return null;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const data = stream.slice(i * 8, i * 8 + 8);
    while (data.length < 8) data.push(0);
    const frame = [msg & 15, LIVE_MARK, (i === count - 1 ? 8 : 0) | i, ...data, 0];
    frame[11] = frameSum(frame);
    frames.push(frame);
  }
  return frames;
}

// What the mode does with the frames it reads: the same as rx_poll. Returns { msg, items } when a message
// is complete, null otherwise (an incomplete message, a frame that is not one).
export class FrameReceiver {
  constructor() { this.msg = -1; this.got = new Map(); this.last = -1; }

  push(n) {
    if (n.length !== 12 || n[1] !== LIVE_MARK || frameSum(n) !== n[11]) return null;
    if (n[0] !== this.msg) { this.msg = n[0]; this.got = new Map(); this.last = -1; }
    this.got.set(n[2] & 7, n.slice(3, 11));
    if (n[2] & 8) this.last = n[2] & 7;
    if (this.last < 0) return null;
    let stream = [];
    for (let i = 0; i <= this.last; i++) {
      if (!this.got.has(i)) return null;
      stream = stream.concat(this.got.get(i));
    }
    this.got = new Map();
    this.last = -1;
    const count = stream[0] * 16 + stream[1];
    if (stream.length < 2 + 5 * count) return null;
    const items = [];
    for (let k = 0, pos = 2; k < count; k++, pos += 5) {
      let v = (stream[pos + 2] << 8) | (stream[pos + 3] << 4) | stream[pos + 4];
      if (v >= 2048) v -= 4096;
      items.push([stream[pos] * 16 + stream[pos + 1], v]);
    }
    return { msg: this.msg, items };
  }
}

// A frame as the Bluetooth command of the API wants it (thymio.setActuatorState). What the command also carries is set to
// what the mode shows anyway, or to nothing: the mode puts its own lights back at its next tick (20 ms). The motors are the
// exception: the firmware sets them to what the command says, so they are given the speeds the robot has just told the page
// ("@@n"): a message sent in the middle of a drawing does not change what the wheels do for more than the 20 ms before the
// controller writes them again.
const nib = (v) => Math.max(0, Math.min(15, Math.round(v)));
export const liveActuator = (frame, { circle = new Array(8).fill(0), lego = 0, motors = [0, 0] } = {}) => ({
  circleLEDs: circle.map(nib),
  frontLegoLEDs: Array.from({ length: 8 }, (_, i) => (i >= 8 - Math.min(lego, 8) ? 15 : 0)),
  rearLegoLEDs: Array.from({ length: 8 }, (_, i) => (i >= 16 - Math.min(lego, 16) ? 15 : 0)),
  flRGB: { r: frame[0], g: frame[1], b: frame[2] },
  frRGB: { r: frame[3], g: frame[4], b: frame[5] },
  blRGB: { r: frame[6], g: frame[7], b: frame[8] },
  brRGB: { r: frame[9], g: frame[10], b: frame[11] },
  motorLeft: Math.round(motors[0]) || 0, motorRight: Math.round(motors[1]) || 0, sound: 0,
  smallBottomRGB: { r: 0, g: 0, b: 0 }, smallBackRGB: { r: 0, g: 0, b: 0 },
  buttonLEDs: [0, 0, 0, 0], receiverLED: 0, microphoneLED: false,
});
export const liveNibbles = (a) => [a.flRGB, a.frRGB, a.blRGB, a.brRGB].flatMap((c) => [c.r, c.g, c.b]);

// What the page asks for, as the items of one or more messages. `change` is { select, size, custom, repeat, command }: the figure, the size and
// the form come before the command, which applies to the figure that is chosen once they are set. Returns arrays of at most MAX_ITEMS items.
// With a form the command is a message of its own, the last one (one frame): a form takes several messages, and the start must not depend on
// the tail of the form being heard and answered (a message that is heard again after it has started the drawing would have the page stop it
// and start it over).
export function itemsFor(change) {
  const items = [];
  if (change.select != null) items.push(selectItem(change.select));
  if (change.size != null) items.push(sizeItem(change.size));
  if (change.custom) items.push(...customItems(change.custom));
  if (change.repeat != null) items.push(repeatItem(change.repeat));
  const alone = change.custom && change.command != null;
  if (change.command != null && !alone) items.push(commandItem(change.command));
  const out = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS) out.push(items.slice(i, i + MAX_ITEMS));
  if (alone) out.push([commandItem(change.command)]);
  return out;
}
