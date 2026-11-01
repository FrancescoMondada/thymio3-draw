// A virtual Thymio 3: differential drive, gyro ticks, the hardware "15 cm" timer and the firmware angle controller. The same model as
// tests/fake_drawer_robot.py (which runs the real MicroPython script), operation by operation, so that the two give the same numbers.
// Time moves in 2 ms steps; the 50 Hz firmware task runs every 20 ms.
import { FACTORY_15CM_TICKS, MM_PER_UNIT, WHEEL_BASE, ROT90_NOMINAL } from '../spec.js';

const TICKS_PER_US = 5;
const STEP_US = 2000;
const RAD_TO_DEG = 180 / Math.PI;

export class VirtualThymio {
  constructor({ mismatch = 0, durFw = FACTORY_15CM_TICKS, durBw = FACTORY_15CM_TICKS, rotFactor = 0 } = {}) {
    this.tUs = 0;
    this.x = 0;               // mm, +y straight ahead at the start
    this.y = 0;
    this.theta = 0;           // rad, counter-clockwise positive
    this.vl = 0;
    this.vr = 0;
    this.mismatch = mismatch;
    this.angleTicks = 0;
    this.dur = [durFw, durBw];
    this.rotFactor = rotFactor;
    this.rot90 = ROT90_NOMINAL + rotFactor;
    this.timerAlarm = FACTORY_15CM_TICKS;
    this.timerOn = false;
    this.timerCount = 0;
    this.rotActive = false;
    this.rotTarget = 0;
    this.rotLastErr = 0;
    this.rotMax = 0;
    this.rotLeft = -500;
    this.rotRight = 500;
    this.nextFw = 20000;
  }

  get nowMs() { return Math.floor(this.tUs / 1000); }
  get headingDeg() { return this.theta * RAD_TO_DEG; }

  // Put the robot down somewhere (the person moved it): mm, degrees counter-clockwise from "up".
  place(x, y, deg) {
    this.x = x;
    this.y = y;
    this.theta = deg / RAD_TO_DEG;
  }

  // ---- what the MicroPython API gives to the script --------------------------------------
  setSpeed(l, r) { this.vl = l; this.vr = r; }
  timerSet(ticks) { this.timerAlarm = ticks; }
  timerReset() { this.timerCount = 0; }
  timerStart() { this.timerOn = true; }
  timerPause() { this.timerOn = false; }
  timerGet() { return Math.trunc(this.timerCount); }
  angleRaw() { return Math.trunc(this.angleTicks); }
  angleDeg() { return Math.trunc((this.angleTicks * 90) / this.rot90); }
  resetAngle() { this.angleTicks = 0; }
  rotateAbsolute(angleDeg, speed) {
    const target = Math.trunc((angleDeg * this.rot90) / 90);
    this.rotTarget = target;
    this.rotMax = speed;
    if (target - this.angleRaw() < 0) { this.rotLeft = speed; this.rotRight = -speed; }
    else { this.rotLeft = -speed; this.rotRight = speed; }
    this.rotLastErr = 0;
    this.rotActive = true;
  }
  cancelRotation() { this.rotActive = false; }
  rotationCompleted() { return !this.rotActive; }

  // ---- angle_controller.c: AngleController_Update(), 50 Hz ------------------------------
  fwTask() {
    if (!this.rotActive) return;
    const measure = this.angleRaw();
    const sign = this.rotRight > this.rotLeft ? 1 : -1;
    const err = sign * Math.trunc((this.rotTarget - measure) / 182);
    let out = 8 * err + 2 * (err - this.rotLastErr);
    this.rotLastErr = err;
    out = Math.max(-this.rotMax, Math.min(this.rotMax, out));
    this.vl = Math.trunc((out * this.rotLeft) / this.rotMax);
    this.vr = Math.trunc((out * this.rotRight) / this.rotMax);
    if (out === 0) { this.rotActive = false; this.vl = 0; this.vr = 0; }
  }

  step() {
    const dt = STEP_US / 1e6;
    this.tUs += STEP_US;
    const kl = MM_PER_UNIT * (1 - this.mismatch);
    const kr = MM_PER_UNIT;
    const vl = this.vl * kl;
    const vr = this.vr * kr;
    const v = (vl + vr) / 2;
    const om = (vr - vl) / WHEEL_BASE;
    this.theta += om * dt;
    this.x += -Math.sin(this.theta) * v * dt;
    this.y += Math.cos(this.theta) * v * dt;
    this.angleTicks += (om * RAD_TO_DEG) * dt * (this.rot90 / 90);
    if (this.timerOn) {
      this.timerCount += STEP_US * TICKS_PER_US;
      if (this.timerCount >= this.timerAlarm) {      // ISR_TimerExpired()
        this.timerOn = false;
        this.timerCount = 0;
        this.vl = 0;
        this.vr = 0;
      }
    }
    if (this.tUs >= this.nextFw) { this.nextFw += 20000; this.fwTask(); }
  }
}
