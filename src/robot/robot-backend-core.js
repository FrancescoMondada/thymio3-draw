import { LineAssembler, parseRobotLine, encodeMessage, itemsFor, liveActuator, CMD, KEY } from '../protocol.js';
import { CUSTOM_ID, SIZE_DEFAULT, clampSize, clampRepeat } from '../spec.js';

// The real robot. The mode (src/py/drawer_mode.py) runs on the robot, drives the motors itself and prints "@@..." lines
// that become the same events as the virtual robot's (see SimBackend).
//
// A running script cannot receive anything over Bluetooth (the file and Python services are served by the task that runs
// it), so the page tells it things through the only channel that reaches a running script: the Bluetooth command of the
// actuators, whose body LEDs the mode reads back (see liveActuator and rx_poll in drawer_mode.py). The mode is installed once
// on the robot as a module (`draw_<hash>.py`, ~4 s to send, then it stays); a start is then a two-line script,
// `import draw_x; draw_x.run(3, 0)` (the figure to start with, and whether to draw it at once). When the module cannot be used,
// the whole mode is sent instead.
//
// `thymio` is the API of thymio3-ts-api, `events` its DOM event names. They are injected, with the module
// (`module: { name, text }`), so that tests can run this without Bluetooth.
// `onLog(kind, text)` receives everything that happens on the link, for the journal of the settings page: kind is
// 'info', 'out' (to the robot), 'in' (from the robot) or 'err'.

// A very small script to tell "the link works" from "the mode does not": it does not import anything big, it blinks the
// four top LEDs in green and prints two lines.
export const SELF_TEST_SCRIPT = `import thymio
import time
beh = thymio.BEHAVIORS()
rgb = [thymio.LEDS_RGB(i) for i in range(4)]
print("@@test start")
beh.disable_behaviors()
try:
 for v in (0, 16, 0, 16, 0):
  for l in rgb:
   l.set_intensity(0, v, 0)
  time.sleep_ms(300)
finally:
 beh.enable_behaviors()
print("@@test done")
`;

const withTimeout = (promise, ms, what) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${what}: no answer after ${ms} ms`)), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

// Errors of the Bluetooth link itself (as opposed to a script that does not work).
export const isLinkError = (err) => /GATT|NetworkError|NotSupported|disconnected|InvalidState/i.test(`${err?.name} ${err?.message || err}`);

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const utf8Length = (text) => new TextEncoder().encode(text).length;
const bare = (name) => String(name).replace(/^\/+/, '');

// The arguments of run(): the figure to start with (0..16), whether to draw it at once, and the size in percent.
// The page's own form, if any, as a text: "units:turn,units:turn" (init.custom is [{ units, turn }]), and the times it is drawn.
export const runArgs = (init = {}) => {
  const form = (init.custom || []).map((s) => `${s.units}:${s.turn}`).join(',');
  return `${Math.max(0, Math.min(CUSTOM_ID, Math.trunc(init.sel ?? 0)))}, ${init.go ? 1 : 0}, ${clampSize(init.size ?? SIZE_DEFAULT)}${form ? `, "${form}", ${clampRepeat(init.repeat ?? 1)}` : ''}`;
};

// Changes that wait to be sent: merged while they carry no command (a command applies to the figure that came before it).
export function mergeChange(list, change) {
  const last = list[list.length - 1];
  if (!last || last.command != null) { list.push({ ...change }); return list; }
  for (const k of ['select', 'size', 'custom', 'repeat']) if (change[k] != null) last[k] = change[k];
  if (change.command != null) last.command = change.command;
  return list;
}

export class RobotBackendCore {
  constructor(emit, {
    thymio, events, module, doc, win, onLog, minimalScript,
    helloTimeoutMs = 10000, haltTimeoutMs = 3000, firmwareTimeoutMs = 6000, fileTimeoutMs = 8000, moduleUploadTimeoutMs = 40000,
    unknownHaltMs = 700, moduleHelloTimeoutMs = 5000, uploadTimeoutMs = 30000, byeGraceMs = 40, liveAckMs = 800, liveAttempts = 2, liveGapMs = 60, frameGapMs = 40,
  }) {
    this.thymio = thymio;
    this.EVENTS = events;
    this.module = module || null;
    this.minimalScript = minimalScript || null;
    this.doc = doc || document;
    this.win = win || window;
    this.opt = { helloTimeoutMs, haltTimeoutMs, firmwareTimeoutMs, fileTimeoutMs, moduleUploadTimeoutMs, unknownHaltMs, moduleHelloTimeoutMs, uploadTimeoutMs, byeGraceMs, liveAckMs, liveAttempts, liveGapMs, frameGapMs };
    this.liveMsg = 0;              // the number of the last message to the mode (1..15)
    this.emit = (ev) => emit({ t: clock(), ...ev });
    this.log = (kind, text) => onLog?.(kind, text);
    this.lines = new LineAssembler();
    this.lineHooks = new Set();
    this.traceback = null;
    this.quietErrors = 0;          // > 0 while an attempt whose failure is handled here must not alarm the interface
    this.scriptRunning = false;
    this.modeRunning = false;      // the mode has said hello and not goodbye
    this.connected = false;
    this.attached = false;
    this.moduleName = null;        // set once the module is known to be on the robot
    this.queue = Promise.resolve();
    this.known = { sel: null, size: null };         // what the mode last said it holds
    this.motors = [0, 0];                           // what it last said the wheels are told
    this.pending = [];                              // changes not sent yet
    this.flushTimer = 0;
    this.sending = false;
    this.failures = 0;
  }

  get kind() { return 'robot'; }

  // One operation on the robot at a time: stopping, uploading, starting and testing must not overlap.
  enqueue(label, fn) {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    const E = this.EVENTS;
    // The API sends "connected" twice per connection (once from connect(), once from
    // requestAndConnect()), and again after every automatic reconnection.
    this.onConnected = (e) => {
      if (!e.detail) {
        this.log('info', 'link: disconnected');
        this.connected = false;
        this.scriptRunning = false;
        this.modeRunning = false;
        this.moduleName = null;
        this.pending = [];
        this.emit({ type: 'conn', status: 'disconnected' });
        return;
      }
      if (this.connected) { this.log('info', 'link: "connected" repeated, ignored'); return; }
      this.connected = true;
      const device = this.thymio.getDeviceName?.() || 'Thymio 3';
      this.log('info', `link: connected to ${device}`);
      // Before anything is started: stop whatever the robot may still be running (a previous page), and make sure the
      // module is on it. Queued first: what the interface starts on "connected" comes after.
      this.enqueue('prepare', async () => { await this.prepare(); this.fetchFirmware(device); });
      this.emit({ type: 'conn', status: 'connected', device, firmware: null });
    };
    this.onReconnect = () => { this.log('err', 'link: automatic reconnection gave up'); this.emit({ type: 'conn', status: 'reconnect' }); };
    this.onStdout = (e) => {
      const text = String(e.detail ?? '');
      this.log('in', `stdout ${JSON.stringify(text.replace(/ {4,}/g, '␣'))}`);
      for (const line of this.lines.push(text)) this.handleLine(line);
    };
    this.onStatus = (e) => {
      this.log('info', `script: ${e.detail ? 'loaded' : 'ended'}`);
      if (e.detail === false) {
        this.scriptRunning = false;
        this.modeRunning = false;
        this.emit({ type: 'script-ended' });
      }
    };
    this.onLoad = (e) => this.log(e.detail?.success ? 'info' : 'err', `upload result: ${e.detail?.message} (code ${e.detail?.code})`);
    // The robot of the next connection must not wait for the timeout of the last one.
    this.onUnload = () => { if (this.thymio.isConnected()) this.thymio.disconnect().catch(() => {}); };
    this.doc.addEventListener(E.connected, this.onConnected);
    this.doc.addEventListener(E.manualReconnect, this.onReconnect);
    this.doc.addEventListener(E.stdout, this.onStdout);
    this.doc.addEventListener(E.pyStatus, this.onStatus);
    if (E.pyLoad) this.doc.addEventListener(E.pyLoad, this.onLoad);
    this.win.addEventListener('pagehide', this.onUnload);
    this.win.addEventListener('beforeunload', this.onUnload);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    const E = this.EVENTS;
    this.doc.removeEventListener(E.connected, this.onConnected);
    this.doc.removeEventListener(E.manualReconnect, this.onReconnect);
    this.doc.removeEventListener(E.stdout, this.onStdout);
    this.doc.removeEventListener(E.pyStatus, this.onStatus);
    if (E.pyLoad) this.doc.removeEventListener(E.pyLoad, this.onLoad);
    this.win.removeEventListener('pagehide', this.onUnload);
    this.win.removeEventListener('beforeunload', this.onUnload);
  }

  // One line of what the robot printed. A Traceback is several lines, read as one: the exception
  // it ends with. KeyboardInterrupt is how a script we stop ends: expected, not an error.
  handleLine(line) {
    for (const hook of this.lineHooks) hook(line);
    if (this.traceback) {
      if (/^\s/.test(line)) { this.traceback.push(line.trim()); return; }
      const where = [...this.traceback].reverse().find((l) => /^File /.test(l)) || '';
      const last = line.trim();
      this.traceback = null;
      if (/^KeyboardInterrupt/.test(last)) { this.log('info', 'script interrupted (stop)'); return; }
      const message = `${last}${where ? ` (${where})` : ''}`;
      this.log('err', `script error: ${message}`);
      if (!this.quietErrors) this.emit({ type: 'error', message });
      return;
    }
    if (/^Traceback/.test(line)) { this.traceback = [line.trim()]; return; }
    const ev = parseRobotLine(line);
    if (!ev) return;
    if (ev.type === 'error' && this.quietErrors) { this.log('err', `script error: ${ev.message}`); return; }
    if (ev.type === 'hello') { this.modeRunning = true; this.failures = 0; }
    else if (ev.type === 'bye' || ev.type === 'exit') this.modeRunning = false;
    if (ev.type === 'sel') this.known.sel = ev.figure;
    else if (ev.type === 'size') this.known.size = ev.size;
    else if (ev.type === 'n') { this.motors = [ev.left, ev.right]; this.known.sel = ev.figure; }
    this.emit(ev);
  }

  // The robot answers when it can, which may be never: not a reason to hold the connection back.
  async fetchFirmware(device) {
    try {
      const firmware = await withTimeout(this.thymio.getFirmwareInfo(), this.opt.firmwareTimeoutMs, 'firmware info');
      this.log('info', `firmware: ${JSON.stringify(firmware)}`);
      if (this.connected) this.emit({ type: 'conn', status: 'connected', device, firmware });
    } catch (err) {
      this.log('err', `firmware: ${err.message}`);
    }
  }

  // The API does not throw when the connection fails: it writes the error to the console and
  // announces "disconnected". Listen to the console while it connects, to know why.
  async connect() {
    this.log('info', 'link: asking the browser for a robot');
    this.emit({ type: 'conn', status: 'connecting' });
    const seen = [];
    const original = console.error;
    console.error = (...args) => { seen.push(...args); original.apply(console, args); };
    let failure = null;
    try {
      await this.thymio.requestAndConnect();
    } catch (err) {
      failure = err;
    } finally {
      console.error = original;
    }
    failure = failure || seen.find((a) => a instanceof Error) || null;
    if (failure) {
      const name = failure.name || 'Error';
      const message = failure.message || String(failure);
      this.log('err', `link: ${name}: ${message}`);
      this.emit({ type: 'conn', status: 'disconnected', error: message, errorName: name });
    }
  }

  async disconnect() {
    try { await this.halt(); } catch { /* ignore */ }
    try { await this.thymio.disconnect(); } catch { /* ignore */ }
    this.connected = false;
    this.emit({ type: 'conn', status: 'disconnected' });
  }

  // ---- stopping ---------------------------------------------------------------------------------
  // Stop whatever script is running (the script's own cleanup stops the motors and gives the
  // robot back to its firmware) and wait until the robot says it is done.
  async halt() {
    if (!this.scriptRunning) return;
    this.log('out', 'stop the running script');
    await this.stopAndWait(this.opt.haltTimeoutMs, true);
    this.scriptRunning = false;
  }

  // Stopping is confirmed by the API's notification that the script ended, or by the script's own
  // last words ("@@bye", the KeyboardInterrupt that ends it): that notification does not always come,
  // and the last words do, in order with everything else the script printed. A moment is left after
  // them for the robot to be free again (the upload of the next script takes longer than that anyway).
  async stopAndWait(ms, complain) {
    const E = this.EVENTS;
    let ended = false;
    let hook;
    const done = new Promise((resolve) => {
      let timer = 0, grace = 0;
      const finish = () => {
        clearTimeout(timer); clearTimeout(grace);
        this.doc.removeEventListener(E.pyStatus, on);
        this.lineHooks.delete(hook);
        resolve();
      };
      const on = (e) => { if (e.detail === false) { ended = true; finish(); } };
      hook = (line) => {
        if (!grace && (line.startsWith('@@bye') || /^KeyboardInterrupt/.test(line.trim()))) {
          grace = setTimeout(() => { ended = true; finish(); }, this.opt.byeGraceMs);
        }
      };
      timer = setTimeout(() => {
        if (complain) this.log('err', 'the script did not confirm it stopped');
        finish();
      }, ms);
      this.doc.addEventListener(E.pyStatus, on);
      this.lineHooks.add(hook);
    });
    await this.once(() => this.thymio.stopScriptExecution(), 'stop');
    await done;
    return ended;
  }

  // A write that fails for a moment (the link is busy) is tried a second time.
  async once(fn, label) {
    try {
      return await fn();
    } catch (err) {
      if (!isLinkError(err)) throw err;
      this.log('err', `${label}: ${err?.message || err}: trying once more`);
      await new Promise((r) => setTimeout(r, 300));
      return fn();
    }
  }

  // At connection the robot may still run the script of a previous page. Stopping nothing is harmless
  // (the firmware discards a stop that finds no script), so stop first and see whether it answers.
  async haltUnknown() {
    this.log('out', 'stop: whatever may run on the robot');
    const ended = await this.stopAndWait(this.opt.unknownHaltMs, false);
    this.log('info', ended ? 'a script was running and has stopped' : 'nothing was running');
    this.scriptRunning = false;
  }

  // ---- the module on the robot ---------------------------------------------------------------------
  async prepare() {
    this.moduleName = null;
    // The firmware keeps the sensor streams that a previous client switched on (the cockpit does) and
    // does not reset them when it disconnects: it then sends sensor packets at 50 Hz to whoever
    // connects next, and the link has no room left for anything else (writes fail, nothing answers,
    // an upload takes half a minute). This interface does not use the streams: switch them off first.
    try {
      this.log('out', 'sensor streaming off (a previous client may have left it on)');
      await this.once(() => this.thymio.stopSensorStreaming?.(), 'sensor streaming off');
    } catch (err) { this.log('err', `sensor streaming off: ${err?.message || err}`); }
    try { await this.haltUnknown(); } catch (err) { this.log('err', `stop: ${err?.message || err}`); }
    if (!this.module) return;
    try {
      await this.ensureModule();
    } catch (err) {
      this.log('err', `module: ${err?.message || err}: the whole mode will be sent at each start instead`);
      this.moduleName = null;
    }
  }

  async ensureModule() {
    const { name, text } = this.module;
    const file = `${name}.py`;
    const size = utf8Length(text);
    const list = async () => (await withTimeout(this.thymio.listFiles(), this.opt.fileTimeoutMs, 'list files')).map((f) => ({ name: bare(f.name), size: f.size }));
    const files = await list();
    this.log('info', `files on the robot: ${files.map((f) => `${f.name} (${f.size})`).join(', ') || 'none'}`);
    if (files.some((f) => f.name === file && f.size === size)) {
      this.log('info', `module ${file} is on the robot`);
      this.moduleName = name;
      return;
    }
    const t0 = clock();
    this.log('out', `upload module ${file}: ${size} bytes (once)`);
    await withTimeout(this.thymio.uploadFile(new File([text], file, { type: 'text/x-python' })), this.opt.moduleUploadTimeoutMs, 'upload module');
    await withTimeout(this.thymio.saveFile(file), this.opt.fileTimeoutMs, 'save module');
    try { await this.thymio.freeMemory?.(); } catch { /* the copy in RAM is not needed any more, but harmless */ }
    const after = await list();
    if (!after.some((f) => f.name === file && f.size === size)) throw new Error(`module ${file} is not on the robot after saving`);
    this.log('info', `module saved in ${Math.round(clock() - t0)} ms`);
    // older versions of the module are of no use
    for (const f of files) {
      if (f.name !== file && /^draw_[0-9a-f]+\.py$/.test(f.name)) {
        try { await withTimeout(this.thymio.deleteFile(f.name), this.opt.fileTimeoutMs, 'delete old module'); this.log('info', `old module ${f.name} deleted`); } catch (err) { this.log('err', String(err?.message || err)); }
      }
    }
    this.moduleName = name;
  }

  // ---- starting ----------------------------------------------------------------------------------
  // Upload a script and start it. Resolves when it has been started.
  async send(script, label) {
    const t0 = clock();
    this.log('out', `upload ${label}: ${script.length} bytes`);
    try {
      // A link that has stopped answering must not hold the interface for long.
      await withTimeout(this.thymio.sendPythonScript(script), this.opt.uploadTimeoutMs, 'upload');
      this.log('info', `upload done in ${Math.round(clock() - t0)} ms`);
      this.scriptRunning = true;
      await this.once(() => this.thymio.executeLoadedScript(), 'execute');
      this.log('out', 'execute');
    } catch (err) {
      this.scriptRunning = false;
      this.log('err', `upload failed after ${Math.round(clock() - t0)} ms: ${err?.message || err}`);
      throw err;
    }
  }

  // Send a script and wait for the mode's first words. The wait starts once the script has been
  // sent and started: a slow upload must not count in it.
  async startScript(script, label, timeoutMs) {
    this.lines = new LineAssembler();
    this.traceback = null;
    let hook, arm;
    const hello = new Promise((resolve, reject) => {
      let timer = 0, settled = false;
      const settle = () => { settled = true; clearTimeout(timer); this.lineHooks.delete(hook); };
      let t0 = clock();
      hook = (line) => {
        if (settled) return;
        if (line.startsWith('@@hello')) {
          settle();
          this.log('info', `hello after ${Math.round(clock() - t0)} ms`);
          resolve();
        } else if (/^ImportError|no module named/i.test(line)) {
          settle();
          reject(new Error('import-failed'));
        }
      };
      arm = () => {
        if (settled) return;
        t0 = clock();
        timer = setTimeout(() => {
          settle();
          this.log('err', `no "hello" from the script after ${timeoutMs} ms`);
          reject(new Error('no-answer'));
        }, timeoutMs);
      };
      this.lineHooks.add(hook);
    });
    hello.catch(() => {});                      // reported by the await below, once
    try {
      await this.send(script, label);
    } catch (err) {
      this.lineHooks.delete(hook);
      throw err;
    }
    arm();
    await hello;
  }

  // Start the mode on the robot, with this figure chosen (`init`: { sel, go }, both optional: go draws it at once). Resolves when the
  // mode has said hello.
  start(init = {}) {
    return this.enqueue('start', async () => {
      await this.halt();
      this.pending = [];
      this.modeRunning = false;
      this.known = { sel: init.sel ?? null, size: init.size ?? null };
      const args = runArgs(init);
      if (this.moduleName) {
        this.quietErrors++;
        try {
          await this.startScript(`import ${this.moduleName}\n${this.moduleName}.run(${args})\n`, `launcher (${args})`, this.opt.moduleHelloTimeoutMs);
          return;
        } catch (err) {
          // a failing link would fail the whole mode too, and the whole mode is a lot more to send
          if (isLinkError(err)) throw err;
          this.log('err', `the module does not start (${err.message}): sending the whole mode`);
          this.moduleName = null;
          await this.halt().catch(() => {});
        } finally {
          this.quietErrors--;
        }
      }
      if (!this.module) throw new Error('no mode to send');
      await this.startScript(`${this.module.text}\nrun(${args})\n`, `mode (${args})`, this.opt.helloTimeoutMs);
    });
  }

  stop() {
    this.pending = [];
    return this.enqueue('stop', async () => {
      try { await this.halt(); } catch (err) { console.warn('stop failed', err); }
    });
  }

  // ---- telling the mode that runs what to do --------------------------------------------------------------
  // `change`: { select: figure, command }. Changes that come quickly (a person who goes through the figures) are merged and sent
  // together, a message after another, each answered by the mode ("@@ack n").
  apply(change) {
    if (!this.connected || !this.modeRunning) return Promise.resolve();
    mergeChange(this.pending, change);
    return this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = new Promise((resolve) => {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = 0;
        this.flushPromise = null;
        this.enqueue('live update', () => this.flush()).then(resolve, resolve);
      }, this.opt.liveGapMs);
    });
    return this.flushPromise;
  }

  async flush() {
    while (this.pending.length) {
      const change = this.pending.shift();
      for (const items of itemsFor(change)) {
        try {
          await this.liveMessage(items);
          this.failures = 0;
        } catch (err) {
          this.log('err', `live update: ${err.message}`);
          this.failures += 1;
          this.emit({ type: 'live-failed', message: err.message, failures: this.failures });
          if (this.failures >= 2) { this.pending = []; this.emit({ type: 'live-giveup' }); return; }
          // the mode may have missed the message: start it again from what it said it held, with the change
          await this.restartWith(change);
          break;
        }
      }
    }
  }

  // The mode, started again from its last known state plus this change. Used when messages are not acknowledged. The figure, the size,
  // the page's own form and the start all go in the arguments, so that nothing depends on the link that has just failed. A stop is the
  // script's own: the robot stops, the mode starts again idle; a quit leaves it stopped.
  async restartWith(change) {
    const init = {
      sel: change.select ?? this.known.sel ?? 0, size: change.size ?? this.known.size ?? SIZE_DEFAULT,
      custom: change.custom, repeat: change.repeat, go: change.command === CMD.START ? 1 : 0,
    };
    this.log('info', 'live update failed: starting the mode again with the change');
    await this.halt();
    if (change.command === CMD.QUIT) return;
    const args = runArgs(init);
    const script = this.moduleName ? `import ${this.moduleName}\n${this.moduleName}.run(${args})\n` : `${this.module.text}\nrun(${args})\n`;
    await this.startScript(script, `restart (${args})`, this.moduleName ? this.opt.moduleHelloTimeoutMs : this.opt.helloTimeoutMs);
  }

  // One message: its frames written in the LEDs, then the answer of the mode. A message can be lost (the firmware keeps one
  // command at a time), so it is sent again once, with another number. The mode reads the LEDs once in each of its ticks (20 ms): a frame
  // is left for two ticks before the next one is written over it, whatever the speed of the link. A message that starts the drawing is
  // also answered by the drawing itself: the mode that has heard it and whose answer was lost has not to be stopped and started again.
  async liveMessage(items) {
    if (typeof this.thymio.setActuatorState !== 'function') throw new Error('the API cannot write the LEDs');
    const t0 = clock();
    for (let attempt = 1; attempt <= this.opt.liveAttempts; attempt++) {
      this.liveMsg = (this.liveMsg % 15) + 1;
      const frames = encodeMessage(items, this.liveMsg);
      if (!frames) throw new Error('the message does not fit in eight frames');
      const ack = this.expectAck(this.liveMsg, items.some(([key, v]) => key === KEY.COMMAND && v === CMD.START));
      this.log('out', `live update: ${items.length} item${items.length > 1 ? 's' : ''}, ${frames.length} frame${frames.length > 1 ? 's' : ''}, message ${this.liveMsg}${attempt > 1 ? ' (again)' : ''}`);
      try {
        let written = 0;
        for (const frame of frames) {
          const wait = this.opt.frameGapMs - (clock() - written);
          if (written && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          await withTimeout(this.thymio.setActuatorState(liveActuator(frame, { motors: this.motors })), this.opt.uploadTimeoutMs, 'live update');
          written = clock();
        }
        if (await ack.wait(this.opt.liveAckMs)) {
          const ms = Math.round(clock() - t0);
          this.log('in', `live update acknowledged after ${ms} ms`);
          this.emit({ type: 'live-ok', ms });
          return ms;
        }
        this.log('err', `live update: no "@@ack ${this.liveMsg}" within ${this.opt.liveAckMs} ms`);
      } finally {
        ack.cancel();
      }
    }
    throw new Error('not acknowledged');
  }

  // Wait for the mode to say it applied this message ("@@ack n"): hooked before anything is sent, so that a quick answer is
  // not missed; the time is counted from wait(). `starts`: the message starts the drawing, which is an answer too: whichever of its lines
  // comes first ("@@draw", "@@state draw", an "@@n" that says draw), the end of a burst is lost on the way to the page.
  expectAck(msg, starts = false) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    let timer = 0;
    const hook = (line) => {
      const ev = parseRobotLine(line);
      if ((ev?.type === 'ack' && ev.msg === msg) || (starts && (ev?.type === 'draw' || ((ev?.type === 'state' || ev?.type === 'n') && ev.state === 'draw')))) resolve(true);
    };
    this.lineHooks.add(hook);
    return {
      wait: (ms) => { timer = setTimeout(() => resolve(false), ms); return promise; },
      cancel: () => { clearTimeout(timer); this.lineHooks.delete(hook); },
    };
  }

  // Upload the tiny script, see it start and end. Returns what happened, step by step.
  selfTest() {
    return this.enqueue('self test', async () => {
      const report = { upload: null, started: null, done: null, error: '' };
      this.lines = new LineAssembler();
      const t0 = clock();
      const waiting = new Promise((resolve) => {
        const timer = setTimeout(() => { this.lineHooks.delete(hook); resolve(); }, 8000);
        const hook = (line) => {
          if (line.startsWith('@@test start')) report.started = Math.round(clock() - t0);
          if (line.startsWith('@@test done')) { report.done = Math.round(clock() - t0); clearTimeout(timer); this.lineHooks.delete(hook); resolve(); }
        };
        this.lineHooks.add(hook);
      });
      try {
        await this.halt();
        const t1 = clock();
        await this.send(this.minimalScript || SELF_TEST_SCRIPT, 'self test');
        report.upload = Math.round(clock() - t1);
        await waiting;
      } catch (err) {
        report.error = String(err?.message || err);
      }
      this.log(report.done != null ? 'info' : 'err', `self test: ${JSON.stringify(report)}`);
      return report;
    });
  }
}
