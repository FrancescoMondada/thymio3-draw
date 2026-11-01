import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Sheet from './components/Sheet.jsx';
import Picker from './components/Picker.jsx';
import Recipe from './components/Recipe.jsx';
import DrawBar from './components/DrawBar.jsx';
import LinkInfo from './components/LinkInfo.jsx';
import SizeControl from './components/SizeControl.jsx';
import QrShow from './components/QrShow.jsx';
import QrScan from './components/QrScan.jsx';
import Settings from './components/Settings.jsx';
import Help from './components/Help.jsx';
import { BluetoothIcon, HelpIcon, QrIcon, ScanIcon, WarnIcon } from './icons.jsx';
import { I18N, detectLang } from './i18n.js';
import { Telemetry, DEFAULT_FIGURE, MAX_POINTS } from './store.js';
import { SimBackend } from './sim/sim-backend.js';
import { RobotBackend } from './robot/robot-backend.js';
import { supportsBluetooth } from './api.js';
import { CMD } from './protocol.js';
import { APP_LINKS, applyConfig, decodeConfig, encodeConfig } from './share.js';
import { cleanName, formatWhen, randomName } from './names.js';
import { stepSelection, otherGroupFirst, CUSTOM_ID, CUSTOM_PRESETS, clampSize, clampRepeat, clampEndAngle } from './spec.js';
import { figureOf, customMessage } from './geometry.js';

const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
// What the person is making now (the form, how many times it is drawn, the angle it ends with) is kept for this tab only: a reload finds it
// again, a new visit starts with a clean "Ma forme" (a form from another day, drawn again by a robot, was a surprise).
const loadTab = (key, fallback) => { try { const v = sessionStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; } };
const saveTab = (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* private mode */ } };

export default function App() {
  const [lang, setLang] = useState(detectLang);
  const t = I18N[lang] || I18N.fr;
  const [theme, setTheme] = useState(() => load('draw.theme', 'auto'));
  const [view, setView] = useState(() => (load('draw.view', 'zoom') === 'a4' ? 'a4' : 'zoom'));
  const [source, setSource] = useState('virtual');                  // 'virtual' | 'robot'
  const [simSpeed, setSimSpeed] = useState(1);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(() => load('draw.help', '') !== '1');
  const [log, setLog] = useState([]);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [telling, setTelling] = useState(false);                    // the start is being told to the robot (a form takes a few seconds)
  const tellingRef = useRef(false);
  const [qr, setQr] = useState(null);                                 // the QR code shown ({ show, caption }) or the scanner ({ scan })
  const [showName, setShowName] = useState(() => load('draw.pseudo.show', '0') === '1');   // the pseudonym is written under the QR code only when the adult turns it on (kept only once chosen)
  const chooseShowName = (v) => { setShowName(v); save('draw.pseudo.show', v ? '1' : '0'); };
  const [name, setName] = useState(() => { const kept = load('draw.name', null); return kept === null ? randomName() : cleanName(kept); });   // under the QR code, drawn at random the first time
  const bluetooth = supportsBluetooth();

  const tele = useRef(null);
  if (!tele.current) {
    let custom = [];
    for (const old of ['draw.custom', 'draw.repeat', 'draw.endAngle']) { try { localStorage.removeItem(old); } catch { /* private mode */ } }      // (kept for good by an earlier version)
    try { const v = JSON.parse(loadTab('draw.custom', '[]')); if (Array.isArray(v)) custom = v.filter((q) => Array.isArray(q) && q.every(Number.isFinite)).slice(0, MAX_POINTS); } catch { /* none */ }
    let sel = Number(load('draw.sel', DEFAULT_FIGURE));
    if (!Number.isInteger(sel) || sel < 0 || sel > CUSTOM_ID || (sel === CUSTOM_ID && !custom.length)) sel = DEFAULT_FIGURE;          // ("Ma forme" without its form is not where a visit begins)
    tele.current = new Telemetry(sel, { size: clampSize(Number(load('draw.size', 100))), custom, repeat: clampRepeat(Number(loadTab('draw.repeat', 1))), endAngle: clampEndAngle(Number(loadTab('draw.endAngle', 0))) });
  }
  const snap = useSyncExternalStore(tele.current.subscribe, tele.current.getSnapshot);

  const sim = useRef(null);
  const robot = useRef(null);
  const sourceRef = useRef('virtual');
  const started = useRef(false);                                    // the mode was started on the current connection
  const connecting = useRef(false);
  if (!sim.current) sim.current = new SimBackend((ev) => tele.current.push(ev));

  // (a handle for the console and the tests: window.__draw.sim.advance(ms) moves the virtual robot without waiting)
  useEffect(() => {
    if (import.meta.env?.DEV) window.__draw = { tele: tele.current, sim: sim.current, get robot() { return robot.current; } };
  }, []);

  // ---- theme, language, view ---------------------------------------------------------------------
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    save('draw.theme', theme);
  }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; save('draw.lang', lang); document.title = t.app.title; }, [lang, t.app.title]);
  useEffect(() => { save('draw.view', view); }, [view]);
  useEffect(() => { save('draw.name', name); }, [name]);
  useEffect(() => { save('draw.sel', String(snap.sel)); }, [snap.sel]);
  useEffect(() => { save('draw.size', String(snap.size)); }, [snap.size]);
  useEffect(() => { saveTab('draw.repeat', String(snap.repeat)); }, [snap.repeat]);
  useEffect(() => { saveTab('draw.endAngle', String(snap.endAngle)); }, [snap.endAngle]);
  useEffect(() => { saveTab('draw.custom', JSON.stringify(snap.custom.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]))); }, [snap.custom]);

  // ---- the virtual robot's clock ---------------------------------------------------------------------
  useEffect(() => { sim.current.speed = simSpeed; }, [simSpeed]);
  useEffect(() => {
    sim.current.start({ sel: tele.current.s.sel, size: tele.current.s.size });
    sim.current.place(tele.current.s.pose);
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (sourceRef.current === 'virtual') sim.current.advance(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); sim.current.stop(); };
  }, []);

  // the person (or the choice of a figure) put the robot down: the virtual one is told, unless it is drawing
  useEffect(() => {
    if (sourceRef.current === 'virtual' && tele.current.s.state === 'idle') sim.current.place(tele.current.s.pose);
  }, [snap.placed]);

  // ---- the real robot ------------------------------------------------------------------------------------
  const onLog = useCallback((kind, text) => setLog((l) => [...l.slice(-500), { at: Date.now(), kind, text }]), []);

  const backToVirtual = useCallback((reason = '') => {
    sourceRef.current = 'virtual';
    setSource('virtual');
    started.current = false;
    connecting.current = false;
    tele.current.clear();
    tele.current.setReal(false);
    tele.current.setLink({ status: 'idle', device: '', firmware: null });
    sim.current.start({ sel: tele.current.s.sel, size: tele.current.s.size });
    sim.current.place(tele.current.s.pose);
    setNotice(reason);
  }, []);

  const onRobotEvent = useCallback((ev) => {
    if (sourceRef.current !== 'robot') return;
    tele.current.push(ev);
    if (ev.type === 'conn') {
      if (ev.status === 'connected' && !started.current) {
        started.current = true;
        robot.current.start({ sel: tele.current.s.sel, size: tele.current.s.size }).catch((err) => {
          started.current = false;
          tele.current.push({ type: 'error', message: err?.message || String(err) });
        });
      }
      if (ev.status === 'disconnected' || ev.status === 'reconnect') {
        started.current = false;
        if (connecting.current && ev.error) backToVirtual(ev.error);
      }
    }
  }, [backToVirtual]);

  const connect = useCallback(async () => {
    if (!bluetooth) { setSettings(true); return; }
    setNotice('');
    if (!robot.current) {
      robot.current = new RobotBackend((ev) => onRobotEvent(ev), { onLog });
      robot.current.attach();
    }
    sim.current.stop();
    sourceRef.current = 'robot';
    setSource('robot');
    started.current = false;
    connecting.current = true;
    tele.current.clear();
    tele.current.setReal(true);
    tele.current.setLink({ status: 'connecting' });
    try { await robot.current.connect(); } finally { connecting.current = false; }
  }, [bluetooth, onLog, onRobotEvent]);

  const disconnect = useCallback(async () => {
    try { await robot.current?.disconnect(); } catch { /* ignore */ }
    backToVirtual('');
  }, [backToVirtual]);

  const restartMode = useCallback(() => {
    if (sourceRef.current === 'robot') {
      started.current = true;
      robot.current.start({ sel: tele.current.s.sel, size: tele.current.s.size }).catch((err) => tele.current.push({ type: 'error', message: err?.message || String(err) }));
    } else {
      tele.current.clear();
      sim.current.start({ sel: tele.current.s.sel, size: tele.current.s.size });
      sim.current.place(tele.current.s.pose);
    }
  }, []);

  // ---- what the person asks for ----------------------------------------------------------------------
  const send = useCallback(async (change) => {
    if (sourceRef.current === 'robot') {
      const b = robot.current;
      if (!b) return;
      tele.current.sending(1);
      try { await b.apply(change); } finally { tele.current.sending(-1); }
    } else {
      sim.current.apply(change);
    }
  }, []);

  const choose = useCallback((figure) => {
    if (tele.current.s.state !== 'idle') return;
    tele.current.choose(figure);
    send({ select: figure });
  }, [send]);
  const draw = useCallback(() => {
    // the figure on the screen, at the size on the screen, is the one that is drawn, even if the robot has not yet heard of it
    const s = tele.current.s;
    if (tellingRef.current) return;          // a second click would tell the robot it all again, over the drawing
    const change = { select: s.sel, size: s.size, command: CMD.START };
    if (s.sel === CUSTOM_ID) {
      const steps = figureOf(CUSTOM_ID, s.custom, s.repeat, s.endAngle).steps;
      if (!steps.length) return;
      const m = tele.current.model();
      change.custom = customMessage(steps, m.k, m.rampMs);
      change.repeat = s.repeat;
    }
    tellingRef.current = true;
    setTelling(true);
    send(change).finally(() => { tellingRef.current = false; setTelling(false); });
  }, [send]);
  const setSize = useCallback((percent) => {
    if (tele.current.s.state !== 'idle') return;
    tele.current.chooseSize(percent);
    send({ size: tele.current.s.size });
  }, [send]);
  const customApi = useMemo(() => ({
    add: (w) => tele.current.customAdd(w),
    move: (i, w) => tele.current.customMove(i, w),
    remove: (i) => tele.current.customRemove(i),
    undo: () => tele.current.customUndo(),
    clear: () => tele.current.customSet([]),
    preset: (name) => tele.current.customPreset(CUSTOM_PRESETS[name]),       // (the robot stays where it is, with the ink so far: only "Centrer" puts it back)
    setRepeat: (n) => { if (tele.current.s.state === 'idle') tele.current.chooseRepeat(n); },
    setEndAngle: (a) => { if (tele.current.s.state === 'idle') tele.current.chooseEndAngle(a); },
    max: MAX_POINTS,
  }), []);
  const stop = useCallback(() => send({ command: CMD.STOP }), [send]);
  const newSheet = useCallback(() => tele.current.newSheet(), []);
  const centre = useCallback(() => tele.current.centre(), []);
  const place = useCallback((pose) => tele.current.place(pose), []);

  // ---- the QR code of the configuration: what it shows, and what a scanned one sets up (share.js) -------------------
  const showQr = () => setQr({
    show: encodeConfig({ lang, showName, figure: snap.sel, size: snap.size, repeat: snap.repeat, endAngle: snap.endAngle, custom: snap.custom }),
    caption: { name: showName ? name.trim() : '', when: formatWhen(new Date(), lang) },
  });
  const scanQr = () => setQr({ scan: true });
  const showLink = useCallback((kind) => { if (APP_LINKS[kind]) { setSettings(false); setQr({ show: APP_LINKS[kind], link: kind }); } }, []);   // from the settings: the link to the app, for the tablets of the class
  const applyScanned = useCallback((text) => {
    const cfg = decodeConfig(text);
    const change = applyConfig(tele.current, cfg);                // (null: not one of ours, or the robot is drawing)
    if (!change) return false;
    if (cfg.lang) setLang(cfg.lang);
    if (cfg.showName != null) { setShowName(cfg.showName); save('draw.pseudo.show', cfg.showName ? '1' : '0'); }      // the setting travels, the pseudonym does not
    if (Object.keys(change).length) send(change);
    setTimeout(() => setQr(null), 700);                           // the frame goes green for a moment
    return true;
  }, [send]);

  const selfTest = useCallback(async () => {
    if (!robot.current) return;
    setTesting(true);
    try { await robot.current.selfTest(); } finally { setTesting(false); }
  }, []);

  // ---- keys ---------------------------------------------------------------------------------------------------
  const live = source === 'robot';
  const online = snap.running && (!live || snap.link.status === 'connected');
  const keyState = useRef({});
  keyState.current = { snap, online, choose, draw, stop, newSheet };
  useEffect(() => {
    const on = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.target?.closest?.('[role="slider"], .robot')) return;                                  // the robot has its own arrows
      const { snap: s, online: ok, choose: pick, draw: go, stop: halt, newSheet: fresh } = keyState.current;
      if (e.key === 'd' || e.key === 'D') { setSettings((v) => !v); return; }
      if (!ok) return;
      const busy = s.state !== 'idle';
      if (e.key === ' ' || e.key === 'Enter') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        if (busy) halt(); else go();
      } else if (!busy && e.key === 'ArrowLeft') { e.preventDefault(); pick(stepSelection(s.sel, -1)); }
      else if (!busy && e.key === 'ArrowRight') { e.preventDefault(); pick(stepSelection(s.sel, 1)); }
      else if (!busy && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); pick(otherGroupFirst(s.sel)); }
      else if (!busy && (e.key === 'n' || e.key === 'N')) fresh();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const link = snap.link;
  const lost = live && (link.status === 'disconnected' || link.status === 'reconnect') && !connecting.current;
  const starting = live && link.status === 'connected' && !snap.running && !snap.error && started.current && snap.t === 0;
  const modeEnded = live && link.status === 'connected' && !snap.running && snap.t > 0;
  const busy = snap.state !== 'idle';
  const figure = useMemo(() => figureOf(snap.sel, snap.custom, snap.repeat, snap.endAngle), [snap.sel, snap.custom, snap.repeat, snap.endAngle]);
  const canDraw = snap.sel !== CUSTOM_ID || figure.steps.length > 0;

  return (
    <div className="app">
      <div className="topbar">
        <header className="top">
          <div className="brand">
            <button type="button" className="app-icon" onClick={() => setSettings(true)} aria-label={t.head.diag} title={`${t.head.diag} (D)`} aria-haspopup="dialog">
              <img src="icon.svg" alt="" width="32" height="32" />
            </button>
            <div>
              <h1>{t.app.title}</h1>
              <p>{t.app.subtitle}</p>
            </div>
          </div>
          <div className="top-mid">
            <div className="seg source" role="group" aria-label={t.head.source}>
              <button type="button" className={!live ? 'on' : ''} aria-pressed={!live} onClick={() => live && disconnect()}>{t.head.virtual}</button>
              <button type="button" className={live ? 'on' : ''} aria-pressed={live} onClick={() => !live && connect()}>{t.head.real}</button>
            </div>
            {live && <LinkInfo t={t} link={link} battery={snap.battery} />}
          </div>
          <div className="top-end">
            {live && link.status === 'connected' && <button type="button" className="btn small" onClick={disconnect}>{t.head.disconnect}</button>}
            {!live && bluetooth && <button type="button" className="btn small hide-narrow" onClick={connect}><BluetoothIcon size={16} />{t.head.connect}</button>}
            <button type="button" className="icon-btn bar-btn" onClick={showQr} aria-label={t.qr.show} title={t.qr.show}><QrIcon /></button>
            <button type="button" className="icon-btn bar-btn scan" onClick={scanQr} disabled={!online || busy} aria-label={t.qr.scan} title={t.qr.scan}><ScanIcon /></button>
            <button type="button" className="icon-btn bar-btn" onClick={() => setHelp(true)} aria-label={t.head.help} title={t.head.help}><HelpIcon /></button>
          </div>
        </header>
      </div>

      {(lost || modeEnded || notice || snap.error || starting || snap.live.giveUp) && (
        <div className="banner" role="alert">
          <WarnIcon size={18} />
          <span>
            {lost ? t.head.lost : modeEnded ? t.head.ended : starting ? t.head.starting : snap.live.giveUp ? t.ctl.gaveUp : notice || snap.error}
          </span>
          {lost && <button type="button" className="btn small" onClick={connect}>{t.head.retry}</button>}
          {(modeEnded || snap.live.giveUp) && <button type="button" className="btn small" onClick={restartMode}>{t.head.restart}</button>}
          {!lost && !modeEnded && !starting && (notice || snap.error) && <button type="button" className="btn small" onClick={() => { setNotice(''); tele.current.push({ type: 'error', message: '' }); }}>OK</button>}
        </div>
      )}

      <main className="stage">
        <section className="card sheet-card" aria-label={t.sheet.title}>
          <header className="card-head">
            <div>
              <h2>{t.sheet.title}</h2>
              <p className="muted small">{live ? t.sheet.hintReal : t.sheet.hint}</p>
            </div>
            <div className="seg" role="group" aria-label={t.sheet.view}>
              <button type="button" className={view === 'zoom' ? 'on' : ''} aria-pressed={view === 'zoom'} onClick={() => setView('zoom')}>{t.sheet.zoom}</button>
              <button type="button" className={view === 'a4' ? 'on' : ''} aria-pressed={view === 'a4'} onClick={() => setView('a4')}>{t.sheet.a4}</button>
            </div>
          </header>
          <Sheet t={t} snap={snap} figure={figure} view={view} live={live} onPlace={place} onCustom={customApi} />
          <DrawBar
            t={t} snap={snap} figure={figure} online={online} live={live} canDraw={canDraw} telling={telling} onDraw={draw} onStop={stop} onNew={newSheet} onCentre={centre}
            simSpeed={simSpeed} onSpeed={setSimSpeed}
          />
          {live && snap.cal.known && <p className="muted small estimate">{t.sheet.estimate}</p>}
        </section>

        <div className="col side">
          <section className="card pick-card" aria-label={t.pick.title}>
            <h2>{t.pick.title}</h2>
            <Picker t={t} sel={snap.sel} onSelect={choose} disabled={busy || !online} figure={figure} custom={snap.custom} repeat={snap.repeat} endAngle={snap.endAngle} onCustom={customApi} />
            {snap.sel !== CUSTOM_ID && <SizeControl t={t} figure={figure} size={snap.size} mm={snap.mm} loss={snap.loss} onSize={setSize} disabled={busy || !online} />}
          </section>
          <section className="card recipe-card" aria-label={t.recipe.title}>
            <h2>{t.recipe.title}</h2>
            <Recipe t={t} figure={figure} size={snap.size} mm={snap.mm} loss={snap.loss} step={snap.step} phase={snap.phase} rep={snap.rep} drawing={snap.state === 'draw' && snap.drawing >= 0} />
          </section>
        </div>
      </main>

      {qr && qr.show !== undefined && <QrShow text={qr.show} t={t} label={qr.link ? { web: t.qr.link, ios: t.qr.linkIos }[qr.link] : t.qr.show} caption={qr.caption} onClose={() => setQr(null)} />}
      {qr && qr.scan && <QrScan t={t} onText={applyScanned} onClose={() => setQr(null)} />}
      {help && <Help t={t} onClose={() => { setHelp(false); save('draw.help', '1'); }} />}
      {settings && (
        <Settings
          t={t} onShowLink={showLink} lang={lang} onLang={setLang} theme={theme} onTheme={setTheme} link={link} battery={snap.battery} running={snap.running} lastError={snap.error}
          name={name} onName={(v) => setName(cleanName(v))} onNewName={() => setName(randomName())} showName={showName} onShowName={chooseShowName}
          log={log} onClearLog={() => setLog([])} onTest={selfTest} testing={testing} canTest={live && link.status === 'connected'} onClose={() => setSettings(false)} bluetooth={bluetooth}
        />
      )}
    </div>
  );
}
