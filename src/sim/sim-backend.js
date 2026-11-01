import { VirtualRobot } from './virtual-robot.js';
import { parseRobotLine, encodeMessage, itemsFor } from '../protocol.js';
import { TICK_MS } from './drawer-mode.js';

// The virtual robot as the page sees it: the same events as the real one (see robot/robot-backend-core.js), the same messages to
// choose a figure and to start or stop it. The page calls advance() with the real time that has passed; `speed` of the simulation
// says how much robot time a real second is worth.
export class SimBackend {
  constructor(emit, { robot = new VirtualRobot(), speed = 1 } = {}) {
    this.emit = emit;
    this.robot = robot;
    this.speed = speed;
    this.acc = 0;
    this.msg = 0;
    this.kind = 'virtual';
  }

  get connected() { return this.robot.running; }

  // The mode starts with this figure chosen, and draws it at once when `go` is set.
  start(init = {}) {
    const out = this.robot.start({ sel: init.sel ?? 0, go: init.go ? 1 : 0, size: init.size ?? 100 });
    this.emitLines(out.lines);
  }

  stop() {
    if (!this.robot.running) return;
    const out = this.robot.stop();
    this.emitLines(out.lines);
    this.emit({ type: 'bye', t: this.robot.clock });
  }

  emitLines(lines) {
    for (const line of lines) {
      const ev = parseRobotLine(line);
      if (ev) this.emit({ ...ev, t: this.robot.clock });
    }
  }

  // The messages to the mode go through the frames, as with the real robot (one frame at each tick).
  apply(change) {
    for (const items of itemsFor(change)) {
      this.msg = (this.msg % 15) + 1;
      this.robot.pushFrames(encodeMessage(items, this.msg));
    }
    return Promise.resolve();
  }

  // The person moved the robot (mm, degrees).
  place(pose) { this.robot.place(pose.x, pose.y, pose.h); }

  advance(realMs) {
    if (!this.robot.running) return;
    this.acc = Math.min(this.acc + realMs * this.speed, 2000);
    while (this.acc >= TICK_MS && this.robot.running) {
      this.acc -= TICK_MS;
      const out = this.robot.tick();
      if (out) this.emitLines(out.lines);
      if (this.robot.mode?.quit) { this.stop(); break; }
    }
  }
}
