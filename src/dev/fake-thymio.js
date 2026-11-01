// A demonstration robot with the interface of thymio3-ts-api (used with `?fakerobot` in the address).
//
// It stands in for Web Bluetooth and the robot, so that the whole link (connection, module on the robot, launcher,
// messages through the body LEDs, acknowledgements, stop) runs in a browser with no hardware: the same DOM events, the
// delays of the real link (an upload of 10 KB takes ~3 s), the firmware's habits (stdout sent in batches, a Traceback
// when a script is stopped, the module kept in the robot's files, the Bluetooth command that also sets the wheels). The
// mode itself is the JavaScript twin of the Python one (sim/drawer-mode.js) on the virtual robot (sim/virtual-robot.js).
//
// window.fakeRobot lets a test play the robot's side: press(button), hand(true), ground('r'), flags.live = 'drop' | 'garble', robot (the VirtualRobot)...
import { VirtualRobot } from '../sim/virtual-robot.js';
import { liveNibbles } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));
const bytes = (text) => new TextEncoder().encode(text).length;

const KEY = 'fakerobot.draw.files';
const files = new Map();
try { for (const [k, v] of JSON.parse(localStorage.getItem(KEY) || '[]')) files.set(k, v); } catch { /* none */ }
if (!files.size) files.set('boot.py', '# boot\n'.padEnd(139, ' '));
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify([...files])); } catch { /* private mode */ } };

let connected = false;
let ram = '';
let loaded = '';
let run = null;                             // the script that runs: { timer, kind }
const robot = new VirtualRobot();
const flags = { dropStatus: false, slow: 1, live: 'ok', ackDelay: 0, writeMs: 90, acks: 0, muteAckAfter: Infinity, lose: null, byteMs: 0.33 };   // byteMs: 15 KB in ~5 s, as measured on a robot; live: 'ok', 'drop' (the frames are lost) or 'garble' (one value is wrong)

// ---- what the robot prints ---------------------------------------------------------------------
// The firmware sends stdout at 100 bytes or after 1 s of silence; the mode pads its lines to 100 bytes
// and ends them with \x1e so that they go at once. Lines that are not padded wait for the second.
let pending = '';
let flushTimer = 0;
const flush = () => {
  clearTimeout(flushTimer);
  flushTimer = 0;
  while (pending.length) { fire('thymio-std-out-values', pending.slice(0, 240)); pending = pending.slice(240); }
};
const print = (text, padded) => {
  pending += text;
  if (padded || pending.length >= 100) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 1000);
};
const say = (line) => print(`${line}${' '.repeat(Math.max(0, 99 - line.length))}\x1e`, true);

// ---- the mode running on the "robot" ----------------------------------------------------------------
// (flags.muteAckAfter: the mode's answers "@@ack n" are lost once that many have been said; the rest of what it says is heard)
// (flags.lose: a pattern for the lines that never reach the page, as a burst of lines is cut short on a real robot)
const sayAll = (lines) => { for (const l of lines) if ((!l.startsWith('@@ack') || ++flags.acks <= flags.muteAckAfter) && !flags.lose?.test(l)) say(l); };

function stopRun(withTraceback) {
  if (!run) return;
  const r = run;
  run = null;
  clearInterval(r.timer);
  if (r.kind === 'test') { print('@@test done\r\n', true); setTimeout(() => fire('thymio-python-execution-status', false), 40); return; }
  sayAll(robot.stop().lines);                       // (the mode says its last word, @@bye)
  if (withTraceback) {
    setTimeout(() => print('Traceback (most recent call last):\r\n  File "mp_script", line 2, in <module>\r\n  File "draw_fake.py", line 700, in run\r\nKeyboardInterrupt: \r\n', false), 300);
    setTimeout(() => flush(), 1300);                // not padded: it leaves with the next batch, a second later
  }
  // (a robot says a script has ended when it ends: not once another has already begun)
  if (!flags.dropStatus) setTimeout(() => { if (!run) fire('thymio-python-execution-status', false); }, 120);
}

// One tick of the robot (20 ms of its life): the mode runs, what it says is printed.
function stepOnce(r) {
  if (run !== r) return;
  const out = robot.tick();
  if (!out) return;
  sayAll(out.lines);
  if (robot.mode?.quit) stopRun(false);
}

function startMode(sel, go, size, custom, reps) {
  const r = { kind: 'mode', timer: 0 };
  run = r;
  setTimeout(() => {                                // the interpreter compiles the module and starts
    if (run !== r) return;
    sayAll(robot.start({ sel, go, size, custom: parseForm(custom), reps: reps ? Number(reps) : 1 }).lines);
    r.timer = setInterval(() => stepOnce(r), 20 / flags.slow);
  }, 350);
}

const LAUNCHER = /^import (draw_\w+)\s+\1\.run\((\d+), (\d+), (\d+)(?:, "([-0-9:,]*)", (\d+))?\)/m;
const WHOLE = /\nrun\((\d+), (\d+), (\d+)(?:, "([-0-9:,]*)", (\d+))?\)\s*$/;
const parseForm = (text) => (text ? text.split(',').map((p) => p.split(':').map(Number)) : []);

function execute(script) {
  const launcher = LAUNCHER.exec(script);
  const whole = WHOLE.exec(script);
  if (launcher) {
    if (![...files.keys()].includes(`${launcher[1]}.py`)) {
      print(`Traceback (most recent call last):\r\n  File "mp_script", line 1, in <module>\r\nImportError: no module named '${launcher[1]}'\r\n`, true);
      setTimeout(() => fire('thymio-python-execution-status', false), 100);
      return;
    }
    startMode(Number(launcher[2]), Number(launcher[3]), Number(launcher[4]), launcher[5], launcher[6]);
  } else if (whole && script.includes('def run(')) {
    startMode(Number(whole[1]), Number(whole[2]), Number(whole[3]), whole[4], whole[5]);
  } else if (script.includes('@@test start')) {
    run = { kind: 'test', timer: 0 };
    print('@@test start\r\n', true);
    setTimeout(() => stopRun(false), 1500);
  } else {
    setTimeout(() => fire('thymio-python-execution-status', false), 50);
  }
}

// ---- the API ----------------------------------------------------------------------------------------------
export async function requestAndConnect() {
  await sleep(600);
  connected = true;
  fire('thymio-connected', true);
  fire('thymio-connected', true);                   // the real API says it twice
}
export const isConnected = () => connected;
export async function disconnect() {
  stopRun(false);
  connected = false;
  fire('thymio-connected', false);
}
export const getDeviceName = () => 'THYMIO3-FAKE';
export async function getFirmwareInfo() { await sleep(150); return { esp32_ver: '1.10.2', stm32_ver: 0 }; }
export async function stopSensorStreaming() { await sleep(40); }
export async function listFiles() { await sleep(80); return [...files].map(([name, text]) => ({ name, size: bytes(text) })); }
export async function uploadFile(file) { const text = await file.text(); await sleep(bytes(text) * flags.byteMs); ram = text; }
export async function saveFile(name) { await sleep(150); files.set(name, ram); persist(); }
export async function deleteFile(name) { files.delete(name); persist(); }
export async function freeMemory() { ram = ''; }
export async function sendPythonScript(text) {
  await sleep(40 + bytes(text) * flags.byteMs);
  loaded = text;
  fire('thymio-python-load-result', { success: true, code: 0, message: 'Script loaded successfully' });
  fire('thymio-python-execution-status', true);
}
export async function executeLoadedScript() {
  await sleep(100);
  if (run) return;                                  // "Another script was already running"
  execute(loaded);
}
// The Bluetooth command of the API: two writes with response (the LEDs and the others). The mode reads the body LEDs back,
// in frames (see rx_poll in drawer_mode.py): here they wait for the mode's next tick. The firmware also sets the wheels to
// the speeds of the command, and the mode sets them again at its next tick.
export async function setActuatorState(data) {
  await sleep(flags.writeMs + flags.ackDelay);
  if (!connected || flags.live === 'drop') return;
  const n = liveNibbles(data);
  if (flags.live === 'garble') n[5] = (n[5] + 1) & 15;
  if (run?.kind === 'mode') {
    robot.pushFrames([n]);
    robot.poke(data.motorLeft, data.motorRight);
  }
}
export async function stopScriptExecution() {
  await sleep(60);
  if (run) stopRun(true);
}

// ---- the robot's own side, for tests ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.fakeRobot = {
    flags,
    robot,
    get files() { return [...files.keys()]; },
    get running() { return Boolean(run); },
    // a press on one of the robot's buttons: 0 backward, 1 left, 2 centre, 3 forward, 4 right
    press(button, ms = 100) {
      robot.buttons[button] = 1;
      setTimeout(() => { robot.buttons[button] = 0; }, ms);
    },
    // a hand over the two rear sensors (true) or taken away (false)
    hand(on) { robot.rear = on ? [2400, 2400] : [0, 0]; },
    // the colour of the floor under the robot: r y g c b p w k, or ? for none of them
    ground(letter) { robot.ground = letter; },
    // n ticks at once (a browser that runs a page in the background gives its timers one tick a second)
    step(n = 1) { for (let i = 0; i < n && run?.kind === 'mode'; i++) stepOnce(run); },
    exit() { if (run?.kind === 'mode') { say('@@exit'); stopRun(false); } },
    reset() { files.clear(); persist(); },
  };
}
