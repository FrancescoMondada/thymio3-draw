import React, { useEffect, useRef, useState } from 'react';
import { LIMITS, OPS, MAX_DEPTH, MAX_NODES, countNodes, pathKey } from '../program.js';
import { CUSTOM_MAX_STEPS } from '../spec.js';
import { fmt } from '../i18n.js';
import { num } from '../util.js';
import { ChevronIcon, CloseIcon, EraserIcon, MinusIcon, PlusIcon } from '../icons.jsx';

// The "Géométrie" tab: the pupil's own program, written from nothing (no ready-made shapes). A list of instructions (forward, left, right, repeat, with its own list inside), each
// with its number, that can be moved up or taken away; under each list, the buttons that add one at its end. While the robot draws, the
// instruction it is on is lit.
const GLYPH = { f: '↑', l: '↺', r: '↻', x: '×' };

export default function Program({ t, program, figure, onProgram, active, disabled }) {
  const g = t.geo;
  const sides = figure.steps.filter((s) => s.len > 0);
  const total = sides.reduce((sum, s) => sum + s.len, 0) * figure.repeat;
  const shared = { g, onProgram, active, disabled, full: countNodes(program) >= MAX_NODES };
  return (
    <div className="program">
      <p className="muted small">{g.hint}</p>
      <h3>{t.figures.geometry}</h3>
      <List {...shared} list={program} path={[]} />
      <div className="btn-row tight">
        <button type="button" className="btn small" disabled={disabled || !program.length} onClick={onProgram.clear}><EraserIcon size={15} />{g.clear}</button>
      </div>
      {shared.full && <p className="warn small">{fmt(g.full, { max: MAX_NODES })}</p>}
      {figure.error
        ? <p className={figure.error === 'long' ? 'warn small' : 'muted small'} role="status">{fmt(g[figure.error], { max: CUSTOM_MAX_STEPS })}</p>
        : <p className="small" role="status">{fmt(g.total, { n: sides.length * figure.repeat, mm: num(total, 0) })}</p>}
    </div>
  );
}

// The instructions of the program, or of a loop (`path`: where that loop is), and the buttons that add one at their end.
function List(props) {
  const { g, list, path, onProgram, disabled, full } = props;
  return (
    <ol className={`prog-list ${path.length ? 'inner' : ''}`}>
      {list.map((node, i) => <Row key={`${i}${node.op}`} {...props} node={node} path={[...path, i]} />)}
      <li className="prog-add" aria-label={path.length ? g.addInLoop : g.addHere}>
        <span className="extra-label">{path.length ? g.addInLoop : g.addHere}</span>
        {OPS.map((op) => (
          <button key={op} type="button" className={`chip-btn op-${op}`} disabled={disabled || full || (op === 'x' && path.length >= MAX_DEPTH)}
            onClick={() => onProgram.add(path, op)} title={g.ops[op]}>
            <span className="glyph" aria-hidden="true">{GLYPH[op]}</span>{g.short[op]}
          </button>
        ))}
      </li>
    </ol>
  );
}

function Row(props) {
  const { g, node, path, onProgram, active, disabled } = props;
  const i = path[path.length - 1];
  const key = pathKey(path);
  const lit = active.includes(key);
  const name = g.ops[node.op];
  return (
    <li className={`prog-row op-${node.op} ${lit ? 'now' : ''}`}>
      <div className="prog-line">
        <span className="glyph" aria-hidden="true">{GLYPH[node.op]}</span>
        <span className="prog-name" title={name}>{g.short[node.op]}</span>
        <Value value={node.v} limits={LIMITS[node.op]} label={name} disabled={disabled} onValue={(v) => onProgram.set(path, v)} />
        <span className="prog-unit">{g.units[node.op]}</span>
        <span className="prog-actions">
          <button type="button" className="icon-btn small up" disabled={disabled || i === 0} onClick={() => onProgram.move(path, -1)} aria-label={`${g.up}: ${name}`} title={g.up}><ChevronIcon size={15} /></button>
          <button type="button" className="icon-btn small" disabled={disabled} onClick={() => onProgram.remove(path)} aria-label={`${g.remove}: ${name}`} title={g.remove}><CloseIcon size={15} /></button>
        </span>
      </div>
      {node.op === 'x' && <List {...props} list={node.body} path={path} />}
    </li>
  );
}

// A number with − and +; it can be typed too, and is taken when one leaves the field (or presses Enter).
function Value({ value, limits, label, disabled, onValue }) {
  const [text, setText] = useState(String(value));
  const [typing, setTyping] = useState(false);
  const dropped = useRef(false);                    // Escape: what was typed is not taken when the field is left
  useEffect(() => { if (!typing) setText(String(value)); }, [value, typing]);
  const commit = () => {
    setTyping(false);
    const v = Number(String(text).replace(',', '.'));
    if (!dropped.current && String(text).trim() !== '' && Number.isFinite(v)) onValue(v);
    setText(String(value));                         // (the new value, if there is one, comes back through the effect)
    dropped.current = false;
  };
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn small" disabled={disabled || value <= limits.min} onClick={() => onValue(value - limits.step)} aria-label="−"><MinusIcon size={15} /></button>
      <input className="num" type="text" inputMode="numeric" value={text} disabled={disabled} aria-label={label}
        onFocus={(e) => { setTyping(true); e.target.select(); }} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { dropped.current = true; e.currentTarget.blur(); } }} />
      <button type="button" className="icon-btn small" disabled={disabled || value >= limits.max} onClick={() => onValue(value + limits.step)} aria-label="+"><PlusIcon size={15} /></button>
    </div>
  );
}
