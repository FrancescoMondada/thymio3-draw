import React from 'react';
import { SIDE_MS, WHEEL_BASE, MOVE_SPEED, CUSTOM_ID, pivotSpeeds } from '../spec.js';
import { recipeGroups, totalTurn, closure, durationSec } from '../geometry.js';
import { fmt } from '../i18n.js';
import { num } from '../util.js';

// What the robot does for the chosen figure, step by step, as the mode does it: the same table (FIGURES in spec.js is the mode's FIGS), at
// the size chosen, or the sides of the page's own form. While it draws, the step it is in is lit.
export default function Recipe({ t, figure: fig, size, mm, loss = 0, step, phase, rep = 0, drawing }) {
  const custom = fig.id === CUSTOM_ID;
  const groups = recipeGroups(fig);
  const total = totalTurn(fig);
  const close = closure(fig, { mm, loss, size });
  const halved = !custom && fig.steps.some((s) => s.side && s.side[1] === 2);
  const why = t.recipe.why[fig.id];
  const active = drawing ? step : -1;
  const last = fig.steps.length - 1;
  const times = custom ? fig.repeat || 1 : 1;

  const turnRow = (key, turn, lit, extra, note = '') => (
    <li key={key} className={`step turn ${lit ? 'now' : ''} ${extra}`}>
      <span className="glyph" aria-hidden="true">{turn > 0 ? '↺' : turn < 0 ? '↻' : '■'}</span>
      <span>{turn > 0 ? fmt(t.recipe.turn, { a: turn }) : turn < 0 ? fmt(t.recipe.turnRight, { a: -turn }) : t.recipe.noTurn}{note && <> <span className="muted">{note}</span></>}</span>
    </li>
  );

  const rows = (i, extra = '') => {
    const s = fig.steps[i];
    const lit = active === i;
    if (s.len != null) {                                          // a side of the page's own form
      const out = [];
      if (s.len > 0) {
        const secs = ((s.len + loss) * (SIDE_MS / 1000)) / mm;      // (the time the robot is told: the length, and what it loses to the start-up and braking)
        out.push(
          <li key={`${i}s`} className={`step side ${lit && phase === 's' ? 'now' : ''} ${extra}`}>
            <span className="glyph" aria-hidden="true">↑</span>
            <span>{fmt(t.recipe.side, { s: num(secs, 1) })} <span className="muted">{fmt(t.recipe.sideMm, { mm: Math.round(s.len) })}</span></span>
          </li>,
        );
      }
      if (i === last && !s.turn) {
        if (times === 1) out.push(<li key={`${i}t`} className={`step turn ${extra}`}><span className="glyph" aria-hidden="true">■</span><span>{t.recipe.noTurn}</span></li>);
      } else if (s.turn) out.push(turnRow(`${i}t`, s.turn, lit && (phase === 't' || s.len === 0), extra, i === last ? t.recipe.atEnd : ''));
      return out;
    }
    if (s.side) {
      const f = (s.side[0] / s.side[1]) * (size / 100);
      return [
        <li key={`${i}s`} className={`step side ${lit && phase === 's' ? 'now' : ''} ${extra}`}>
          <span className="glyph" aria-hidden="true">↑</span>
          <span>{fmt(t.recipe.side, { s: num((SIDE_MS / 1000) * f, 1) })} <span className="muted">{fmt(t.recipe.sideMm, { mm: Math.max(0, Math.round(mm * f - loss)) })}</span></span>
        </li>,
        turnRow(`${i}t`, s.turn, lit && phase === 't', extra),
      ];
    }
    const right = s.pivot[1] === 0;
    const [l, r] = pivotSpeeds(s.pivot, size);
    const diameter = Math.round(((l + r) / Math.abs(r - l)) * WHEEL_BASE);
    return [
      <li key={`${i}p`} className={`step turn ${lit ? 'now' : ''} ${extra}`}>
        <span className="glyph" aria-hidden="true">{right ? '↻' : '↺'}</span>
        <span>{right ? t.recipe.pivotRight : t.recipe.pivotLeft} <span className="muted">{fmt(t.recipe.diameter, { mm: diameter })}</span></span>
      </li>,
    ];
  };

  return (
    <div className="recipe">
      <h3>{t.figures[fig.key]}</h3>
      {why && <p className="muted small">{why}</p>}
      <ol className="steps">
        {times > 1 ? (
          <li className="repeat">
            <span className="repeat-n">{fmt(t.recipe.repeat, { n: times })}{drawing ? ` · ${rep + 1}/${times}` : ''}</span>
            <ol className="steps inner">{groups.flatMap((g) => rows(g.steps[0]))}</ol>
          </li>
        ) : groups.map((g) => (g.repeat > 1 ? (
          <li key={g.steps[0]} className="repeat">
            <span className="repeat-n">{fmt(t.recipe.repeat, { n: g.repeat })}</span>
            <ol className="steps inner">{rows(g.steps[0], '')}</ol>
          </li>
        ) : rows(g.steps[0])))}
      </ol>
      {fig.steps.length > 0 && (
        <dl className="facts compact">
          <dt>{fmt(t.recipe.total, { a: total })}</dt>
          <dd>{close.closes ? t.recipe.closes : fmt(t.recipe.gap, { mm: num(close.gap, close.gap < 10 ? 1 : 0) })}</dd>
          <dt>{t.recipe.duration}</dt>
          <dd>{fmt(t.recipe.time, { s: Math.round(durationSec(fig, { size, mmPerUnit: mm / (MOVE_SPEED * (SIDE_MS / 1000)) })) })}</dd>
        </dl>
      )}
      {halved && <p className="muted small">{t.recipe.halved}</p>}
      <p className="muted small">{t.recipe.pauses}</p>
      <p className="muted small">{t.recipe.precision}</p>
    </div>
  );
}
