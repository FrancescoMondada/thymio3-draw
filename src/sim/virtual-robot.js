// The virtual Thymio: the physics (sim/physics.js) with the JavaScript twin of the mode in it (sim/drawer-mode.js), on a sheet of paper.
// One tick() is 20 ms of the robot's life: the mode decides, then the physics moves the body in ten steps of 2 ms.
import { VirtualThymio } from './physics.js';
import { DrawerMode, TICK_MS } from './drawer-mode.js';

const STEPS_PER_TICK = (TICK_MS * 1000) / 2000;

export class VirtualRobot {
  constructor(options = {}) {
    this.body = new VirtualThymio(options);
    this.mode = null;
    this.queue = [];                  // frames that the page wrote, one is read at each tick
    this.buttons = [0, 0, 0, 0, 0];
    this.rear = [0, 0];               // the two rear proximity readings (a hand)
    this.ground = '?';                // the colour under the robot: only a demonstration robot or a test sets it (this one has no colour sensor)
    this.lines = [];                  // what the mode said, since the last take()
    this.sounds = [];
  }

  get running() { return !!this.mode; }
  get clock() { return this.body.nowMs; }

  // Start the mode: returns what it says at once. `init`: { sel, go, size, custom: [[units, turn], ...], reps }.
  start(init = {}) {
    this.body.setSpeed(0, 0);
    this.body.timerPause();
    this.body.cancelRotation();
    this.queue = [];
    this.mode = new DrawerMode(this.body, {
      sel: init.sel ?? 0,
      go: init.go ?? 0,
      size: init.size ?? 100,
      custom: init.custom ?? [],
      reps: init.reps ?? 1,
      say: (text) => this.lines.push(text),
      sound: (id) => this.sounds.push([this.body.nowMs, id]),
    });
    this.mode.start();
    return this.take();
  }

  stop() {
    if (this.mode) this.mode.stop();
    this.mode = null;
    this.queue = [];
    return this.take();
  }

  pushFrames(frames) { this.queue.push(...frames); }

  // The Bluetooth command of the page also sets the wheels, to the speeds in it; the mode (or the angle controller) sets them again
  // at its next tick.
  poke(left, right) { this.body.setSpeed(left, right); }

  // Put the robot down somewhere (mm, degrees counter-clockwise from "up").
  place(x, y, deg) { this.body.place(x, y, deg); }

  take() {
    const out = { lines: this.lines, sounds: this.sounds };
    this.lines = [];
    this.sounds = [];
    return out;
  }

  tick() {
    let out = null;
    if (this.mode) {
      const frame = this.queue.length ? this.queue.shift() : null;
      this.mode.tick({ buttons: this.buttons, rear: this.rear, ground: this.ground, frame });
      out = this.take();
    }
    for (let i = 0; i < STEPS_PER_TICK; i++) this.body.step();
    return out;
  }
}
