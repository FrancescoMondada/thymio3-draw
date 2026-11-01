import React from 'react';
import { PlayIcon, StopIcon, EraserIcon, TargetIcon, HandIcon } from '../icons.jsx';
import { GROUND, HAND_NEAR } from '../spec.js';
import { fmt } from '../i18n.js';

const SPEEDS = [1, 2, 5, 10];

// Under the sheet: draw / stop, what the robot is doing, a new sheet; for the virtual robot the speed of its time, for
// the real one the colour it sees and the hand over its rear sensors. (The virtual robot has no colour sensor.)
export default function DrawBar({ t, snap, figure, online, live, canDraw, telling, onDraw, onStop, onNew, onCentre, simSpeed, onSpeed }) {
  const busy = snap.state !== 'idle';
  const fig = figure;
  const n = fig.steps.length;
  const k = Math.max(0, Math.min(Math.max(snap.step, 0), n - 1));
  let progress = '';
  if (snap.state === 'draw' && snap.drawing >= 0) {
    if (fig.steps[k]?.pivot) progress = n > 1 ? `${t.bar.pivot} (${k + 1}/${n})` : t.bar.pivot;
    else progress = snap.phase === 't' ? fmt(t.bar.turnOf, { k: k + 1, n }) : fmt(t.bar.side, { k: k + 1, n });
    if (fig.repeat > 1) progress += ` · ${fmt(t.bar.rep, { r: snap.rep + 1, n: fig.repeat })}`;
  }
  const sending = live && online && snap.state === 'idle' && telling;      // the page is telling the robot to start (a form takes a few seconds)
  const status = !online ? t.bar.state.offline : sending ? t.bar.state.sending : t.bar.state[snap.state];
  const hand = live && snap.rear[0] > HAND_NEAR && snap.rear[1] > HAND_NEAR;
  const seen = snap.colour;

  return (
    <div className="drawbar">
      <div className="drawbar-main">
        {busy ? (
          <button type="button" className="btn big stop" onClick={onStop}><StopIcon size={22} />{t.bar.stop}</button>
        ) : (
          <button type="button" className="btn big primary" onClick={onDraw} disabled={!online || !canDraw || sending}><PlayIcon size={22} />{t.bar.draw}</button>
        )}
        <div className="status" role="status" aria-live="polite">
          <b className={`state ${online ? (sending ? 'draw' : snap.state) : 'offline'}`}>{status}</b>
          {progress && <span className="muted">{progress}</span>}
          {snap.state === 'draw' && snap.drawing >= 0 && (
            <span className="pips" aria-hidden="true">
              {Array.from({ length: n }, (_, i) => <i key={i} className={i < k ? 'done' : i === k ? 'now' : ''} />)}
            </span>
          )}
          {hand && <span className="chip hand"><HandIcon size={15} />{t.bar.hand}</span>}
        </div>
        <div className="drawbar-tools">
          <button type="button" className="btn small" onClick={onCentre} disabled={busy} title={t.bar.centre}><TargetIcon size={16} /><span className="hide-narrow">{t.bar.centre}</span></button>
          <button type="button" className="btn small" onClick={onNew} disabled={busy} title={t.bar.newSheet}><EraserIcon size={16} /><span className="hide-narrow">{t.bar.newSheet}</span></button>
        </div>
      </div>

      <div className="drawbar-extra">
        {!live && (
          <>
            <div className="extra-group">
              <span className="extra-label">{t.bar.speed}</span>
              <div className="seg" role="group" aria-label={t.bar.speed}>
                {SPEEDS.map((s) => <button key={s} type="button" className={simSpeed === s ? 'on' : ''} aria-pressed={simSpeed === s} onClick={() => onSpeed(s)}>×{s}</button>)}
              </div>
            </div>
          </>
        )}
        {live && online && (
          <div className="extra-group" title={t.bar.groundHint}>
            <span className="extra-label">{t.bar.colourSeen}</span>
            <span className="chip"><i className={`swatch-dot ${seen === '?' ? 'none' : ''}`} style={seen !== '?' ? { background: GROUND[seen] } : undefined} />{t.colours[seen]}</span>
          </div>
        )}
        {live && !hand && online && !busy && <p className="muted small hand-hint">{t.bar.handHint}</p>}
      </div>
    </div>
  );
}
