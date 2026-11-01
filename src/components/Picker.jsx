import React from 'react';
import FigureIcon from './FigureIcon.jsx';
import { FIGURES, GROUPS, GROUP_SIZE, CUSTOM_ID, CUSTOM_PRESETS, REPEAT_MIN, REPEAT_MAX, END_ANGLE_MAX, groupOf, placeInGroup, idOf } from '../spec.js';
import { customLength } from '../geometry.js';
import { fmt } from '../i18n.js';
import { EraserIcon, ResetIcon, MinusIcon, PlusIcon } from '../icons.jsx';
import { num } from '../util.js';

// The robot's two menus as a picture book: a row of eight polygons and a row of eight shapes, one at a time (like the robot's forward and
// backward buttons change row, and its arrows go along the row). Under them, the robot's Lego LEDs, which count the place in the row.
// A third tab is the page's own form: its tools (models, undo, clear) instead of tiles.
export default function Picker({ t, sel, onSelect, disabled, figure, custom, repeat, endAngle, onCustom }) {
  const group = groupOf(sel);
  const place = placeInGroup(sel);
  const figures = FIGURES.filter((f) => f.group === group);
  return (
    <div className="picker">
      <div className="seg picker-groups" role="group" aria-label={t.pick.title}>
        {GROUPS.map((g) => (
          <button key={g} type="button" className={g === group ? 'on' : ''} aria-pressed={g === group} disabled={disabled}
            onClick={() => { if (g !== group) onSelect(g === 'custom' ? CUSTOM_ID : idOf(g, 1)); }}>{t.pick[g]}</button>
        ))}
      </div>
      {group === 'custom' ? (
        <CustomTools t={t} figure={figure} custom={custom} repeat={repeat} endAngle={endAngle} onCustom={onCustom} disabled={disabled} />
      ) : (
      <div className="tiles" role="group" aria-label={t.pick[group]}>
        {figures.map((f) => {
          const name = t.figures[f.key];
          const on = f.id === sel;
          return (
            <button key={f.id} type="button" className={`tile ${on ? 'on' : ''}`} aria-pressed={on} disabled={disabled} title={name}
              onClick={() => onSelect(f.id)} aria-label={`${name}. ${fmt(t.pick.place, { n: placeInGroup(f.id) })}`}>
              <span className="tile-n" aria-hidden="true">{placeInGroup(f.id)}</span>
              <FigureIcon fig={f} size={60} />
              <span className="tile-name">{name}</span>
            </button>
          );
        })}
      </div>
      )}
      <div className="lego" title={t.pick.leds}>
        {GROUPS.filter((g) => g !== 'custom').map((g) => (
          <div key={g} className={`lego-row ${g === group ? 'on' : ''}`}>
            <span className="lego-label">{t.pick.row[g]}</span>
            <span className="lego-pips" aria-hidden="true">
              {Array.from({ length: GROUP_SIZE }, (_, i) => <i key={i} className={g === group && i >= GROUP_SIZE - place ? 'lit' : ''} />)}
            </span>
          </div>
        ))}
      </div>
      <p className="muted small">{t.pick.leds}</p>
    </div>
  );
}

// The tools of the page's own form: a few models to start from, take the last point away, clear everything, and how long the form is.
function CustomTools({ t, figure, custom, repeat, endAngle, onCustom, disabled }) {
  const total = customLength(figure.steps);
  return (
    <div className="custom-tools">
      <p className="muted small">{t.custom.hint}</p>
      <div className="extra-label">{t.custom.presets}</div>
      <div className="chips">
        {Object.keys(CUSTOM_PRESETS).map((k) => (
          <button key={k} type="button" className="chip-btn" disabled={disabled} onClick={() => onCustom.preset(k)}>{t.custom[k]}</button>
        ))}
      </div>
      <div className="btn-row tight">
        <button type="button" className="btn small" disabled={disabled || !custom.length} onClick={onCustom.undo}><ResetIcon size={15} />{t.custom.undo}</button>
        <button type="button" className="btn small" disabled={disabled || !custom.length} onClick={onCustom.clear}><EraserIcon size={15} />{t.custom.clear}</button>
      </div>
      <div className="repeat-row">
        <span id="repeat-label" className="extra-label">{t.custom.repeat}</span>
        <div className="stepper" role="group" aria-labelledby="repeat-label">
          <button type="button" className="icon-btn small" disabled={disabled || repeat <= REPEAT_MIN} onClick={() => onCustom.setRepeat(repeat - 1)} aria-label="−"><MinusIcon size={16} /></button>
          <input className="num" type="number" inputMode="numeric" min={REPEAT_MIN} max={REPEAT_MAX} value={repeat} disabled={disabled} aria-labelledby="repeat-label"
            onChange={(e) => { if (e.target.value !== '') onCustom.setRepeat(Number(e.target.value)); }} />
          <button type="button" className="icon-btn small" disabled={disabled || repeat >= REPEAT_MAX} onClick={() => onCustom.setRepeat(repeat + 1)} aria-label="+"><PlusIcon size={16} /></button>
        </div>
        <span className="extra-label">{t.custom.times}</span>
      </div>
      {repeat > 1 && custom.length > 0 && <p className="muted small">{t.custom.repeatHint}</p>}
      <div className="repeat-row">
        <span id="end-label" className="extra-label">{t.custom.endAngle}</span>
        <div className="stepper" role="group" aria-labelledby="end-label">
          <button type="button" className="icon-btn small" disabled={disabled || endAngle <= -END_ANGLE_MAX} onClick={() => onCustom.setEndAngle(endAngle - 5)} aria-label="−"><MinusIcon size={16} /></button>
          <input className="num" type="number" inputMode="numeric" step="5" min={-END_ANGLE_MAX} max={END_ANGLE_MAX} value={endAngle} disabled={disabled} aria-labelledby="end-label"
            onChange={(e) => { if (e.target.value !== '') onCustom.setEndAngle(Number(e.target.value)); }} />
          <button type="button" className="icon-btn small" disabled={disabled || endAngle >= END_ANGLE_MAX} onClick={() => onCustom.setEndAngle(endAngle + 5)} aria-label="+"><PlusIcon size={16} /></button>
        </div>
        <span className="extra-label">°</span>
      </div>
      <p className="muted small">{t.custom.endAngleHint}</p>
      <p className="small">
        {custom.length ? <>{fmt(t.custom.points, { n: custom.length })} · {fmt(t.custom.total, { mm: num(total, 0) })}</> : <span className="muted">{t.custom.empty}</span>}
      </p>
      {custom.length >= onCustom.max && <p className="warn small">{fmt(t.custom.full, { n: onCustom.max })}</p>}
    </div>
  );
}
