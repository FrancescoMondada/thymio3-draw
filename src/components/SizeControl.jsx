import React, { useEffect, useState } from 'react';
import { ResetIcon } from '../icons.jsx';
import { SIZE_MIN, SIZE_MAX, SIZE_DEFAULT, WHEEL_BASE } from '../spec.js';
import { figurePath, bounds } from '../geometry.js';
import { fmt } from '../i18n.js';

const A4 = { w: 297, h: 210 };

// The size of the drawing: a slider in percent of the firmware's size, and the same in millimetres (the first side, or the first circle's
// diameter), which can be typed. Under them, how big the whole figure comes out, and a warning when it is bigger than the A4 sheet.
export default function SizeControl({ t, figure, size, mm, loss = 0, onSize, disabled }) {
  const first = figure.steps[0];
  const pivot = !!first.pivot;
  const ref = pivot ? WHEEL_BASE : (mm * first.side[0]) / first.side[1];            // at 100 %, with no start-up and no braking
  const cut = pivot ? 0 : loss;                                                      // (what a side of a real robot loses to them, whatever its size)
  const shown = Math.max(0, Math.round((ref * size) / 100 - cut));
  const [text, setText] = useState(String(shown));
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setText(String(shown)); }, [shown, typing]);

  const b = bounds(figurePath(figure, { mm, loss, size }).points);
  const w = Math.round(b.maxX - b.minX);
  const h = Math.round(b.maxY - b.minY);
  const tooBig = w > A4.w || h > A4.h;
  const commit = () => {
    setTyping(false);
    const v = Number(String(text).replace(',', '.'));
    if (Number.isFinite(v) && v > 0) onSize(Math.round(((v + cut) / ref) * 100));
    else setText(String(shown));
  };

  return (
    <div className={`size-control ${disabled ? 'off' : ''}`}>
      <div className="size-head">
        <label htmlFor="size-range"><b>{t.size.title}</b></label>
        <output htmlFor="size-range">{fmt(t.size.percent, { n: size })}</output>
      </div>
      <div className="size-row">
        <input id="size-range" type="range" min={SIZE_MIN} max={SIZE_MAX} step="5" value={size} disabled={disabled}
          style={{ '--pct': `${((size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)) * 100}%` }} onChange={(e) => onSize(Number(e.target.value))} />
        <button type="button" className="icon-btn small" onClick={() => onSize(SIZE_DEFAULT)} disabled={disabled || size === SIZE_DEFAULT} title={t.size.reset} aria-label={t.size.reset}><ResetIcon size={16} /></button>
      </div>
      <div className="size-fields">
        <label className="size-field">
          <span>{pivot ? t.size.diameter : t.size.side}</span>
          <input className="num" type="text" inputMode="decimal" value={text} disabled={disabled} aria-label={pivot ? t.size.diameter : t.size.side}
            onFocus={() => setTyping(true)} onChange={(e) => setText(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTyping(false); setText(String(shown)); e.currentTarget.blur(); } }} />
          <span>{t.size.mm}</span>
        </label>
        <span className={`size-dims ${tooBig ? 'big' : 'muted'}`}>{fmt(t.size.figure, { w, h })}</span>
      </div>
      {tooBig && <p className="warn small">{t.size.tooBig}</p>}
      <p className="muted small">{t.size.hint}</p>
    </div>
  );
}
