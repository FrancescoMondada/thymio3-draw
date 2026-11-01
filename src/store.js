// What the page knows about the robot, built from the events of a backend (robot or virtual): the figure chosen, where the robot is on the
// sheet, the ink it has left, how far it is in the drawing. Plain JavaScript with no React: React reads it with useSyncExternalStore
// (see useTelemetry in App.jsx) and Node can test it.
//
// The sheet is a plane in millimetres, x to the right, y up, its middle at (0, 0). The robot's pose on it is not measured by anything:
// it is where the person put the robot, followed by dead reckoning from what the robot says while it draws (geometry.js: Odometer).
import { robotModel, FACTORY_15CM_TICKS, CUSTOM_ID, CUSTOM_MAX_STEPS, SIZE_DEFAULT, clampSize, clampRepeat, clampEndAngle } from './spec.js';
import { Odometer, startPoseFor, figureOf, worldToLocal } from './geometry.js';

export const DEFAULT_FIGURE = 3;                 // a square: the first thing most people want to see
const MIN_STEP_MM = 0.4;                         // the ink gets a new point when the pen has moved this far
const HOLD_MS = 1500;                            // a figure the person has just chosen is not overwritten by the robot's older word
const MIN_SIDE_MM = 3;                           // a point of the page's own form closer than this to the one before is not a side
export const MAX_POINTS = CUSTOM_MAX_STEPS - 1;  // (the first turn on the spot may take a step of the robot's list)

const blank = () => ({ x: 0, y: 0, h: 0 });

function fresh(sel = DEFAULT_FIGURE, size = SIZE_DEFAULT, custom = [], repeat = 1, endAngle = 0) {
  const { mm, loss } = robotModel();
  return {
    version: 0,
    link: { status: 'idle', device: '', firmware: null, error: '' },
    running: false,                       // the mode has said hello and not goodbye
    state: 'idle',                        // 'idle' | 'draw' | 'blink'
    sel,                                  // the figure chosen, 0..15, or 16 for the page's own form
    size,                                 // the size, in percent of the firmware's
    custom,                               // the page's own form: points [x, y] in mm in the robot's frame (its pen at 0, 0, facing up)
    repeat,                               // the times the form is drawn
    endAngle,                             // the angle it ends with, in degrees (the turn after its last side)
    rep: 0,                               // the time it is in (0 is the first)
    drawing: -1,                          // the figure in the middle of being drawn (-1: none)
    step: 0,                              // the step in progress, and whether it is a side (or a pivot) or a turn
    phase: 's',
    angle: 0,                             // the gyroscope's angle since the drawing began, degrees
    motors: [0, 0],
    colour: '?',                          // the colour under the robot
    rear: [0, 0],                         // the two rear proximity readings: a hand
    cal: { fw: FACTORY_15CM_TICKS, bw: FACTORY_15CM_TICKS, rot90: 16384, known: false },
    mm,                                   // the length of a base side, from the robot's own calibration
    loss,                                 // what a timed side loses to the robot's start-up and braking, mm (a real robot's)
    pose: startPoseFor(figureOf(sel, custom, repeat, endAngle), { mm, size, loss }),
    placed: 0,                            // counts the times the person (or the page) put the robot down: the virtual robot follows
    autoPlace: true,                      // while the sheet is blank the robot waits where the chosen figure is in the middle
    ink: [],                              // strokes: { figure, start: the pose it began from, points: [[x, y], ...], done }
    t: 0,
    t0: 0,
    draws: 0,                             // drawings finished
    live: { failures: 0, lastMs: 0, sending: 0, giveUp: false },
    battery: 0,
    error: '',
  };
}

export class Telemetry {
  constructor(sel = DEFAULT_FIGURE, { size = SIZE_DEFAULT, custom = [], repeat = 1, endAngle = 0 } = {}) {
    this.s = fresh(sel, clampSize(size), custom, clampRepeat(repeat), clampEndAngle(endAngle));
    this.real = false;                    // the robot drawn is a real one: it accelerates and brakes (see robotModel in spec.js)
    this.odo = new Odometer();
    this.applyModel();
    this.hold = null;                     // { figure, at }
    this.holdSize = null;                 // { size, at }
    this.listeners = new Set();
    this.snap = { ...this.s };
    this.queued = false;
    this.subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    this.getSnapshot = () => this.snap;
  }

  // Forget everything but the link and the figure chosen (a new run: the other robot).
  clear() {
    const { link, sel, size, custom, repeat, endAngle } = this.s;
    this.s = fresh(sel, size, custom, repeat, endAngle);
    this.s.link = link;
    this.odo = new Odometer();
    this.applyModel();
    this.hold = null;
    this.holdSize = null;
    this.publish();
  }

  // The link only: used when the source changes (virtual / robot).
  setLink(link) { this.s.link = { ...this.s.link, ...link }; this.publish(); }

  // ---- what the person does -------------------------------------------------------------------
  // The person chooses a figure: it shows at once, and the robot's older words do not take it back for a moment.
  choose(figure) {
    const fig = Math.max(0, Math.min(CUSTOM_ID, Math.trunc(figure)));
    this.hold = { figure: fig, at: Date.now() };
    this.setSelection(fig);
    this.publish();
  }

  setSelection(fig) {
    const s = this.s;
    if (fig === s.sel) return;
    s.sel = fig;
    this.autoPlace();
  }

  // The figure on the screen: one of the sixteen, or the page's own form.
  figureNow() { return figureOf(this.s.sel, this.s.custom, this.s.repeat, this.s.endAngle); }

  // The person sets the angle the form ends with.
  chooseEndAngle(degrees) {
    this.s.endAngle = clampEndAngle(degrees);
    this.autoPlace();
    this.publish();
  }

  // The person sets how many times the form is drawn.
  chooseRepeat(times) {
    this.s.repeat = clampRepeat(times);
    this.autoPlace();
    this.publish();
  }

  // The person sets the size (percent): it shows at once, and the robot's older word does not take it back for a moment.
  chooseSize(percent) {
    const s = this.s;
    const size = clampSize(percent);
    this.holdSize = { size, at: Date.now() };
    if (size !== s.size) { s.size = size; this.autoPlace(); }
    this.publish();
  }

  // While the sheet is blank, the robot waits where the figure chosen is in the middle of the sheet.
  autoPlace() {
    const s = this.s;
    if (s.autoPlace && !s.ink.length && s.state === 'idle') {
      s.pose = startPoseFor(this.figureNow(), { mm: s.mm, loss: s.loss, h: s.pose.h, size: s.size });
      s.placed += 1;
    }
  }

  // The person put the robot down somewhere (a drag): from now on it stays there.
  place(pose) {
    const s = this.s;
    s.pose = { x: pose.x, y: pose.y, h: pose.h };
    s.autoPlace = false;
    s.placed += 1;
    this.publish();
  }

  // The figure chosen in the middle of the sheet, the robot at its start (the ink stays).
  centre() {
    const s = this.s;
    s.pose = startPoseFor(this.figureNow(), { mm: s.mm, loss: s.loss, h: 0, size: s.size });
    s.autoPlace = !s.ink.length;
    s.placed += 1;
    this.publish();
  }

  // The robot that is drawn is a real one, which accelerates and brakes, or the virtual one, which does not.
  setReal(real) {
    this.real = !!real;
    this.applyModel();
    this.autoPlace();
    this.publish();
  }

  // What the page knows of the motion of this robot (its calibration, and whether it is a real one): the side of the firmware in mm and
  // what a side loses to the start-up and the braking, the scale of the ink.
  applyModel() {
    const m = robotModel(this.s.cal.fw, this.real);
    this.s.mm = m.mm;
    this.s.loss = m.loss;
    this.odo.k = m.k;
  }

  // What the robot is told for a form: its time, a length at a time (robotModel's k and the time that each side loses).
  model() { return robotModel(this.s.cal.fw, this.real); }

  // A clean sheet: no ink, the robot back at the start of the figure chosen.
  newSheet() {
    const s = this.s;
    s.ink = [];
    s.autoPlace = true;
    s.pose = startPoseFor(this.figureNow(), { mm: s.mm, loss: s.loss, h: 0, size: s.size });
    s.placed += 1;
    this.publish();
  }

  // ---- the page's own form: points put on the sheet (world, mm), kept in the robot's frame -------------------------------------------
  // Does nothing and says false when the form is full, or the point is too close to the one before.
  customAdd(world) {
    const s = this.s;
    if (s.custom.length >= MAX_POINTS) return false;
    const l = worldToLocal(s.pose, world);
    const last = s.custom[s.custom.length - 1] || [0, 0];
    if (Math.hypot(l.x - last[0], l.y - last[1]) < MIN_SIDE_MM) return false;
    s.custom = [...s.custom, [l.x, l.y]];
    this.publish();
    return true;
  }

  customMove(index, world) {
    const s = this.s;
    if (!s.custom[index]) return;
    const l = worldToLocal(s.pose, world);
    s.custom = s.custom.map((p, i) => (i === index ? [l.x, l.y] : p));
    this.publish();
  }

  customRemove(index) {
    this.s.custom = this.s.custom.filter((_, i) => i !== index);
    this.publish();
  }

  customUndo() { this.customRemove(this.s.custom.length - 1); }

  customSet(points) {
    this.s.custom = points.slice(0, MAX_POINTS).map(([x, y]) => [x, y]);
    this.publish();
  }

  // A ready-made form (it is in the robot's frame: it goes where the robot is). The robot stays where it is, with the ink so far; only a
  // blank sheet with a robot that nobody has put anywhere has it wait where the form is in the middle.
  customPreset(points) {
    this.s.custom = points.slice(0, MAX_POINTS).map(([x, y]) => [x, y]);
    this.autoPlace();
    this.publish();
  }

  // The interface is waiting for the robot to confirm something it sent (a counter, for a small indicator).
  sending(delta) { this.s.live = { ...this.s.live, sending: Math.max(0, this.s.live.sending + delta) }; this.publish(); }

  // ---- what the robot says -----------------------------------------------------------------------
  push(ev) {
    const s = this.s;
    if (ev.t != null && ev.t > 0) {
      if (!s.t0 || ev.t < s.t0) s.t0 = ev.t;
      s.t = ev.t;
    }
    switch (ev.type) {
      case 'conn':
        s.link = { ...s.link, status: ev.status, device: ev.device ?? s.link.device, firmware: ev.firmware ?? s.link.firmware, error: ev.error ?? (ev.status === 'connected' ? '' : s.link.error) };
        if (ev.status === 'disconnected' || ev.status === 'reconnect') { s.running = false; s.state = 'idle'; s.drawing = -1; }
        break;
      case 'hello': s.running = true; s.live = { ...s.live, failures: 0, giveUp: false }; break;
      case 'battery': s.battery = ev.volts; break;
      case 'cal':
        s.cal = { fw: ev.fw, bw: ev.bw, rot90: ev.rot90, known: true };
        this.applyModel();
        this.autoPlace();
        break;
      case 'state':
        this.setState(ev.state);
        break;
      case 'sel': this.robotSelection(ev.figure); break;
      case 'size': this.robotSize(ev.size); break;
      case 'n':
        // (The robot says "@@draw", "@@seg", "@@rep", "@@end" once, and a burst of lines is cut short on its way to the page: they are
        // the first to go when a drawing begins. "@@n" is said ten times a second and tells as much: the drawing is followed from it.)
        this.robotSelection(ev.figure);
        this.setState(ev.state);
        s.motors = [ev.left, ev.right];
        s.colour = ev.colour;
        s.rear = ev.rear;
        s.angle = ev.angle;
        if (ev.state === 'draw') {
          if (s.drawing < 0) this.drawingBegan(ev.figure);              // "@@draw" did not come
          const step = Math.max(0, ev.step);
          if (step < s.step && s.sel === CUSTOM_ID && s.rep + 1 < s.repeat) s.rep += 1;         // the step goes back to the first: the form begins again ("@@rep" did not come)
          if (step !== s.step) s.phase = 's';                            // a step begins with its side ("@@seg" did not come)
          s.step = step;
          this.follow({ ms: ev.ms, angle: ev.angle, ml: ev.left, mr: ev.right, dist: ev.dist });
        }
        break;
      case 'draw':
        this.drawingBegan(ev.figure);
        break;
      case 'rep': s.rep = ev.rep; s.step = 0; s.phase = 's'; break;
      case 'seg':
        s.step = ev.step;
        s.phase = ev.phase;
        break;
      case 'end':
        if (s.drawing >= 0) s.draws += 1;                        // (once: the blink that follows it counts a drawing whose "@@end" was lost)
        this.endStroke();
        s.drawing = -1;
        break;
      case 'stop':
        this.endStroke();
        s.drawing = -1;
        s.state = 'idle';
        break;
      case 'bye': case 'exit': case 'script-ended': s.running = false; s.state = 'idle'; s.drawing = -1; break;
      case 'error': s.error = ev.message; break;
      case 'live-ok': s.live = { ...s.live, failures: 0, lastMs: ev.ms }; break;
      case 'live-failed': s.live = { ...s.live, failures: ev.failures }; break;
      case 'live-giveup': s.live = { ...s.live, giveUp: true }; break;
      default: break;
    }
    this.publish();
  }

  setState(state) {
    const s = this.s;
    if (state === s.state) return;
    s.state = state;
    if (state !== 'draw' && s.drawing >= 0) {                  // a drawing is over, whether or not "@@end" or "@@stop" came
      if (state === 'blink') s.draws += 1;
      this.endStroke();
      s.drawing = -1;
    }
  }

  // The robot begins to draw a figure.
  drawingBegan(figure) {
    const s = this.s;
    s.drawing = figure;
    s.sel = figure;
    s.step = 0;
    s.rep = 0;
    s.phase = 's';
    s.angle = 0;
    this.startStroke(figure);
  }

  // The robot says which figure is chosen; unless the person has just chosen another one.
  robotSelection(fig) {
    const h = this.hold;
    if (h) {
      if (fig === h.figure) this.hold = null;
      else if (Date.now() - h.at < HOLD_MS) return;
      else this.hold = null;
    }
    if (this.s.state === 'idle') this.setSelection(fig);
    else this.s.sel = fig;
  }

  // The robot says its size; unless the person has just set another.
  robotSize(size) {
    const h = this.holdSize;
    if (h) {
      if (size === h.size) this.holdSize = null;
      else if (Date.now() - h.at < HOLD_MS) return;
      else this.holdSize = null;
    }
    if (this.s.state === 'idle' && size !== this.s.size) { this.s.size = size; this.autoPlace(); }
  }

  startStroke(figure) {
    const s = this.s;
    this.odo.begin(s.pose);
    s.ink.push({ figure, start: { ...s.pose }, points: [[s.pose.x, s.pose.y]], done: false });
    s.autoPlace = false;
  }

  follow(sample) {
    const s = this.s;
    // A real robot is not followed on the sheet: its trace is the pen's, on the paper, and a robot that moves on the screen as well shows
    // the difference between the two. It stays where the person put it, with the dotted plan; the step in progress is all that moves.
    if (this.real) return;
    const stroke = s.ink[s.ink.length - 1];
    if (!stroke || stroke.done) return;
    const p = this.odo.push(sample);
    s.pose = p;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) >= MIN_STEP_MM) stroke.points.push([p.x, p.y]);
  }

  endStroke() {
    const s = this.s;
    const stroke = s.ink[s.ink.length - 1];
    if (!stroke || stroke.done) return;
    stroke.done = true;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(s.pose.x - last[0], s.pose.y - last[1]) > 0.05) stroke.points.push([s.pose.x, s.pose.y]);
  }

  // One snapshot per animation frame at most: the robot may say 100 things a second (a fast virtual one). A timer backs the frame up:
  // a page in the background gets no frames, and the interface must not stay behind what the robot has said.
  publish() {
    if (this.queued) return;
    this.queued = true;
    let raf = 0;
    let timer = 0;
    const run = () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      clearTimeout(timer);
      this.queued = false;
      this.s.version += 1;
      this.snap = { ...this.s };
      for (const fn of this.listeners) fn();
    };
    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(run);
      timer = setTimeout(run, 120);
    } else {
      Promise.resolve().then(run);
    }
  }
}
