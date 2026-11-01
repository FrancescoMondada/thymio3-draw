// The drawing mode for the virtual robot: a port of src/py/drawer_mode.py, statement by statement, so that it prints the same lines at the
// same times and moves the same wheels. tests/drawer.test.js checks it against what the Python mode did on the Python virtual robot
// (tests/golden-drawer.json); keep the two in step.
//
// tick(input) runs one tick of the mode (20 ms of the robot's life). input: { buttons: [back, left, centre, forward, right],
// rear: [left, right] (the two rear proximity readings), ground: the colour letter under the robot, frame: the 12 nibbles a Bluetooth
// command wrote in the body LEDs, or null }. What the mode says goes to `say(text)`, its sounds to `sound(id)`.
import {
  FIGURES, MOVE_SPEED, ROT_SPEED, SIDE_TICKS, TICKS_PER_MS, STOP_MS, AFTER_TURN_TICKS, HAND_NEAR, HAND_FAR, MAXB, TICK_MS, STATE_CODE,
  ROT90_NOMINAL, BODY_LIGHT, GROUND_CODES, CUSTOM_ID, CUSTOM_MAX_STEPS, CUSTOM_UNIT_MS, clampSize, clampRepeat, pivotSpeeds,
} from '../spec.js';
import { FrameReceiver, KEY, CMD, isFrame } from '../protocol.js';

export { TICK_MS };
const GUARD_TICKS = 150000;
const S_KP = 0.1, S_KI = 0.2, S_MAX_I = 1000, S_LIMIT = 600;
const HEARTBEAT_TICKS = 150;
const LATE_TICKS = 10;
const NET_TICKS = 5;
const LED_DELAY = 15;
const SND_END = 11;
const CUSTOM_TICKS = CUSTOM_UNIT_MS * TICKS_PER_MS;
const ST = { idle: 0, draw: 1, blink: 2 };
const STATE_NAMES = ['idle', 'draw', 'blink'];
const PH = { init: 0, side: 1, wside: 2, wturn: 3, go: 4, wpiv: 5 };

const tdiv = (a, b) => Math.trunc(a / b);
const clamp = (v, l) => Math.max(-Math.abs(l), Math.min(Math.abs(l), v));
const rnd = (v) => (v < 0 ? Math.trunc(v - 0.5) : Math.trunc(v + 0.5));

// The figures as the mode holds them: ['S', num, den, turn] or ['P', left, right] (the same table as FIGS in drawer_mode.py).
export const FIGS = FIGURES.map((f) => f.steps.map((s) => (s.side ? ['S', s.side[0], s.side[1], s.turn] : ['P', s.pivot[0], s.pivot[1]])));

class Edge {
  constructor() { this.prev = 0; }
  call(cond) {
    const c = cond ? 1 : 0;
    const r = c && !this.prev;
    this.prev = c;
    return !!r;
  }
}

export class DrawerMode {
  constructor(robot, { sel = 0, go = 0, size = 100, custom = [], reps = 1, say = () => {}, sound = () => {} } = {}) {
    this.r = robot;
    this.say = (...parts) => say(`@@${parts.join(' ')}`);
    this.sound = sound;
    this.sel = sel >= 0 && sel <= CUSTOM_ID ? sel : 0;
    this.go = go;
    this.size = clampSize(size);
    this.runSize = this.size;
    this.custom = custom.slice(0, CUSTOM_MAX_STEPS).map((c) => [c[0] & 4095, c[1]]);
    this.reps = clampRepeat(reps);                      // times the custom form is drawn, and the time it is in
    this.runReps = 1;
    this.rep = 0;
    this.state = ST.idle;
    this.quit = false;
    this.ticks = 0;
    this.t0 = robot.nowMs;
    this.fig = null;
    this.phase = PH.init;
    this.k = 0;
    this.heading = 0;
    this.delay = 0;
    this.motionInProgress = false;
    this.motionRunning = false;
    this.tStop = 0;
    this.alarm = 0;
    this.lastEl = 0;
    this.tMove = 0;
    this.rot90 = ROT90_NOMINAL + robot.rotFactor;
    this.sOn = false;
    this.sTarget = 0;
    this.sBase = 0;
    this.sMaxCorr = 0;
    this.sInt = 0;
    this.sLastUs = 0;
    this.pulse = 0;
    this.colour = '?';
    this.laState = 0;
    this.laCount = 0;
    this.legoDirty = true;
    this.handState = 0;
    this.handCount = 0;
    this.p5 = 0;
    this.p6 = 0;
    this.pl = 0;                                       // the wheels' measured speeds at the last tick
    this.pr = 0;
    this.dsum = 0;                                     // the distance driven since the drawing began
    this.beat = 0;
    this.eLeft = new Edge();
    this.eRight = new Edge();
    this.eFwd = new Edge();
    this.eBack = new Edge();
    this.eCenter = new Edge();
    this.rx = new FrameReceiver();
    // what the robot's lights show (for the avatar)
    this.leds = { body: [0, 0, 0], circle: new Array(8).fill(0), front: 0, back: 0 };
  }

  // What run() says before its first tick.
  start() {
    this.say('hello', 1);
    this.say('cal', this.r.dur[0], this.r.dur[1], this.rot90);
    this.say('bat', 4012);
    this.reportAll();
  }

  // cleanup(): the motors, the timer, a turn, the lights.
  stop() {
    this.r.timerPause();
    this.r.setSpeed(0, 0);
    this.r.cancelRotation();
    this.r.setSpeed(0, 0);
    this.leds = { body: [0, 0, 0], circle: new Array(8).fill(0), front: 0, back: 0 };
    this.say('bye');
  }

  // ---- reports ---------------------------------------------------------------
  reportAll() {
    this.say('sel', this.sel);
    this.say('size', this.size);
    this.say('state', STATE_NAMES[this.state]);
    this.beat = 0;
  }

  reportN() {
    const r = this.r;
    this.say('n', r.nowMs - this.t0, this.state, this.sel, this.k, tdiv(r.angleRaw() * 900, this.rot90), this.pl, this.pr, this.colour, this.p5, this.p6, this.dsum);
  }

  setState(state) {
    if (state !== this.state) {
      this.state = state;
      this.say('state', STATE_NAMES[state]);
    }
  }

  // ---- the page's messages -----------------------------------------------------------
  select(fig) {
    if (this.state === ST.idle && fig >= 0 && fig <= CUSTOM_ID) this.changeSelection(fig);
  }

  setSize(size) {
    size = clampSize(size);
    if (this.state === ST.idle && size !== this.size) {
      this.size = size;
      this.say('size', size);
    }
  }

  changeSelection(fig) {
    if (fig !== this.sel) {
      this.sel = fig;
      this.legoDirty = true;
      this.say('sel', fig);
    }
  }

  command(code) {
    if (code === CMD.START) {
      if (this.state === ST.idle) this.begin();
    } else if (code === CMD.STOP) {
      if (this.state !== ST.idle) this.abort();
    } else if (code === CMD.QUIT) {
      this.say('exit');
      this.quit = true;
    } else if (code === CMD.REPORT) {
      this.reportAll();
    }
  }

  item(key, v) {
    if (key === KEY.SELECT) this.select(v);
    else if (key === KEY.COMMAND) this.command(v);
    else if (key === KEY.SIZE) this.setSize(v);
    else if (key === KEY.CUSTOM_CLEAR) this.custom = [];
    else if (key === KEY.CUSTOM_SIDE) { if (this.custom.length < CUSTOM_MAX_STEPS) this.custom.push([v & 4095, 0]); }
    else if (key === KEY.CUSTOM_TURN) { if (this.custom.length) this.custom[this.custom.length - 1][1] = v; }
    else if (key === KEY.CUSTOM_REPEAT) this.reps = clampRepeat(v);
  }

  rxPoll(frame) {
    if (!isFrame(frame)) return;                    // (a frame is marked by a 15 in its second value and carries a checksum)
    this.legoDirty = true;                          // the frame has set the Lego LEDs too: they are drawn again
    const got = this.rx.push(frame);
    if (!got) return;
    for (const [key, v] of got.items) this.item(key, v);
    this.say('ack', got.msg);
    this.beat = HEARTBEAT_TICKS - LATE_TICKS;
  }

  // ---- straight controller (straight_controller.c) ----------------------------------
  straightStart(headingDeg, speed) {
    this.sTarget = tdiv(headingDeg * this.rot90, 90);
    this.sBase = speed;
    this.sMaxCorr = Math.abs(speed);
    this.sInt = 0;
    this.sLastUs = this.r.tUs;
    this.sOn = true;
  }

  applySpeeds(base, corr) {
    let left = base - corr;
    let right = base + corr;
    const over = Math.max(left, right) - S_LIMIT;
    if (over > 0) { left -= over; right -= over; }
    const under = -S_LIMIT - Math.min(left, right);
    if (under > 0) { left += under; right += under; }
    this.r.setSpeed(rnd(left), rnd(right));
  }

  straightUpdate() {
    if (!this.sOn) return;
    if (!this.motionRunning) { this.sOn = false; return; }
    const el = this.r.timerGet();
    const late = this.r.nowMs - this.tMove > Math.floor(this.alarm / TICKS_PER_MS) + 150;
    const done = el >= this.alarm || el < this.lastEl || late;
    this.lastEl = el;
    if (done) { this.endMove(); return; }
    if (el >= this.alarm - GUARD_TICKS) return;
    const now = this.r.tUs;
    let dt = (now - this.sLastUs) / 1000000;
    this.sLastUs = now;
    if (dt <= 0 || dt > 0.1) dt = 0.02;
    const err = this.sTarget - this.r.angleRaw();
    this.sInt = clamp(this.sInt + err * dt, S_MAX_I);
    const corr = clamp(S_KP * err + S_KI * this.sInt, this.sMaxCorr);
    this.applySpeeds(this.sBase, corr);
  }

  startMove(dur) {
    this.r.timerSet(dur);
    this.r.timerReset();
    this.r.timerStart();
    this.alarm = dur;
    this.lastEl = 0;
    this.tMove = this.r.nowMs;
    this.motionInProgress = true;
    this.motionRunning = true;
    this.straightStart(this.heading, MOVE_SPEED);
    this.straightUpdate();
  }

  endMove() {
    this.motionRunning = false;
    this.sOn = false;
    this.r.setSpeed(0, 0);
    this.r.timerPause();
    this.tStop = this.r.nowMs;
  }

  rotateToNext(stepDeg) {
    this.heading += stepDeg;
    this.r.rotateAbsolute(this.heading, ROT_SPEED);
  }

  // ---- starting, stopping ------------------------------------------------------------------
  begin() {
    const fig = this.sel === CUSTOM_ID ? this.custom.map((c) => ['C', c[0], c[1]]) : FIGS[this.sel];
    if (!fig.length) return;                          // a form with no side: nothing to draw
    this.fig = fig;
    this.runSize = this.size;
    this.runReps = this.sel === CUSTOM_ID ? this.reps : 1;
    this.state = ST.draw;
    this.say('state', 'draw');
    this.phase = PH.init;
    this.handState = 0;
    this.handCount = 0;
  }

  finish() {
    this.laCount = 0;
    this.laState = 0;
    this.phase = PH.init;
    this.k = 0;
    this.say('end', this.sel);
    this.setState(ST.blink);
    this.sound(SND_END);
  }

  abort() {
    this.r.timerPause();
    this.r.setSpeed(0, 0);
    this.r.cancelRotation();
    this.r.setSpeed(0, 0);
    this.sOn = false;
    this.motionRunning = false;
    this.motionInProgress = false;
    this.phase = PH.init;
    this.k = 0;
    this.leds.circle = new Array(8).fill(0);
    this.legoDirty = true;
    this.say('stop');
    this.setState(ST.idle);
  }

  // ---- a drawing ---------------------------------------------------------------------------------------
  draw() {
    const fig = this.fig;
    const ph = this.phase;
    if (ph === PH.init) {
      this.r.resetAngle();
      this.heading = 0;
      this.k = 0;
      this.rep = 0;
      this.dsum = 0;
      this.say('draw', this.sel);
      this.phase = fig[0][0] === 'P' ? PH.go : PH.side;
    } else if (ph === PH.side) {
      const step = fig[this.k];
      this.say('seg', this.k, 's');
      const dur = step[0] === 'S' ? Math.trunc((Math.trunc(SIDE_TICKS / 100) * step[1] * this.runSize) / step[2]) : step[1] * CUSTOM_TICKS;
      if (dur > 0) this.startMove(dur);                // (a side of no time is a turn on the spot)
      this.phase = PH.wside;
    } else if (ph === PH.wside) {
      if (!this.motionInProgress) {
        const step = fig[this.k];
        let turn;
        if (step[0] === 'S') {
          turn = step[3];
          if (turn === 0) { this.finish(); return; }
        } else {
          turn = step[2];
          if (turn === 0) { this.nextStep(); return; }          // no turn: on to the next side, the form's next time, or the end
        }
        this.say('seg', this.k, 't');
        this.rotateToNext(turn);
        this.delay = 0;
        this.phase = PH.wturn;
      }
    } else if (ph === PH.wturn) {
      if (this.r.rotationCompleted()) {
        this.delay += 1;
        if (this.delay === AFTER_TURN_TICKS) this.nextStep();
      }
    } else if (ph === PH.go) {
      const step = fig[this.k];
      this.say('seg', this.k, 's');
      this.r.setSpeed(...pivotSpeeds([step[1], step[2]], this.runSize));
      this.delay = 0;
      this.phase = PH.wpiv;
    } else if (ph === PH.wpiv) {
      if (Math.abs(this.r.angleDeg()) >= 360) {
        this.r.setSpeed(0, 0);
        this.delay += 1;
        if (this.delay === AFTER_TURN_TICKS) {
          this.k += 1;
          if (this.k === fig.length) {
            this.finish();
          } else {
            this.r.resetAngle();
            const step = fig[this.k];
            this.say('seg', this.k, 's');
            this.r.setSpeed(...pivotSpeeds([step[1], step[2]], this.runSize));
            this.delay = 0;
          }
        }
      }
    }
  }

  nextStep() {
    this.k += 1;
    if (this.k === this.fig.length) {
      if (this.rep + 1 >= this.runReps) { this.finish(); return; }
      this.rep += 1;                                    // the form again
      this.k = 0;
      this.say('rep', this.rep);
    }
    this.phase = this.fig[this.k][0] === 'P' ? PH.go : PH.side;
  }

  // ---- the three blinks of the circle at the end ----------------------------------------------------
  blink() {
    const s = this.laState;
    if (s === 0) {
      this.leds.circle = new Array(8).fill(MAXB);
      this.laCount = 0;
      this.laState = 1;
      return;
    }
    this.laCount += 1;
    if (this.laCount >= LED_DELAY) {
      this.laCount = 0;
      this.leds.circle = new Array(8).fill(s & 1 ? 0 : MAXB);
      if (s === 5) {
        this.laState = 0;
        this.setState(ST.idle);
      } else {
        this.laState = s + 1;
      }
    }
  }

  // ---- the idle state: the arrows and the hand ----------------------------------------------------------
  hand() {
    if (this.handState === 0) {
      if (this.p5 > HAND_NEAR && this.p6 > HAND_NEAR) {
        this.handCount += 1;
        if (this.handCount === 5) this.handState = 1;
      } else {
        this.handCount = 0;
      }
    } else if (this.p5 < HAND_FAR && this.p6 < HAND_FAR) {
      this.handCount += 1;
      if (this.handCount === 25) {
        this.handState = 0;
        this.handCount = 0;
        return true;
      }
    } else {
      this.handCount = 0;
    }
    return false;
  }

  idle(status) {
    let s = this.sel;
    const base = s < 8 ? 0 : 8;
    if (this.eLeft.call(status[1])) {
      this.changeSelection(base + ((s - base + 7) % 8));
      s = this.sel;
    }
    if (this.eRight.call(status[4])) this.changeSelection(base + ((s - base + 1) % 8));
    if (this.eFwd.call(status[3])) this.changeSelection(this.sel < 8 ? 8 : 0);
    if (this.eBack.call(status[0])) this.changeSelection(this.sel < 8 ? 8 : 0);
    if (this.hand()) this.begin();
  }

  // ---- lights ---------------------------------------------------------------------------
  body() {
    this.pulse += 1;
    let b;
    if (this.pulse > 0) {
      b = this.pulse >> 2;
      if (this.pulse >= MAXB << 2) this.pulse = -(MAXB << 3);
    } else {
      b = -(this.pulse >> 3);
    }
    const light = BODY_LIGHT[this.colour];
    this.leds.body = light ? [b * light[0], b * light[1], b * light[2]] : [0, 0, 0];
  }

  lego() {
    if (this.sel < 8) { this.leds.front = this.sel + 1; this.leds.back = 0; }
    else { this.leds.front = 0; this.leds.back = this.sel === CUSTOM_ID ? 0 : this.sel - 7; }
    this.legoDirty = false;
  }

  // ---- one tick of the mode (Drawer_Run) -----------------------------------------------------
  tick({ buttons = [0, 0, 0, 0, 0], rear = [0, 0], ground = '?', frame = null } = {}) {
    if (this.eCenter.call(buttons[2])) {
      this.say('exit');
      this.quit = true;
      return;
    }
    this.rxPoll(frame);
    if (this.quit) return;
    this.p5 = rear[0];
    this.p6 = rear[1];
    this.colour = GROUND_CODES.includes(ground) ? ground : '?';
    this.body();
    if (this.state === ST.idle) {
      if (this.go) { this.go = 0; this.begin(); }
      else this.idle(buttons);
    }
    if (this.legoDirty) this.lego();
    if (this.state === ST.draw) this.draw();
    else if (this.state === ST.blink) this.blink();
    this.straightUpdate();
    if (this.motionInProgress && !this.motionRunning) {
      if (this.r.nowMs - this.tStop >= STOP_MS) this.motionInProgress = false;
    }
    const before = this.pl + this.pr;                  // (the speed set at the last tick drove the tick that has passed; if it has dropped, the wheels stopped half way)
    const after = this.r.vl + this.r.vr;
    this.dsum += Math.abs(after) < Math.abs(before) ? before + after : 2 * before;
    this.pl = this.r.vl;
    this.pr = this.r.vr;
    this.ticks += 1;
    if (this.ticks % NET_TICKS === 0) this.reportN();
    this.beat += 1;
    if (this.beat >= HEARTBEAT_TICKS) this.reportAll();
  }
}

export { STATE_CODE };
