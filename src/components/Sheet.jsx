import React, { useMemo, useRef, useState } from 'react';
import RobotBody, { PEN } from './RobotBody.jsx';
import { BODY_LIGHT, GROUND, CUSTOM_ID } from '../spec.js';
import { figurePath, bounds, dirOf, localToWorld } from '../geometry.js';
import { fmt } from '../i18n.js';

// The sheet of paper seen from above, in millimetres (x to the right, y up, flipped for the screen): the robot, what it is going to draw
// (dotted), and the ink it has left (solid). With a real robot there is neither ink nor movement: its trace is the pen's, on the paper, and the
// robot on the screen stays where it was put (the page only lights the step in progress on the dotted line). The robot can be dragged and turned while it is waiting: it draws from where it stands.
// With the page's own form chosen, a touch on the paper puts a point (a point can be dragged, a double touch takes it away) and the
// robot is only moved by its pen: its body would be in the way of the points under it.
const A4 = { w: 297, h: 210 };
const BOX = [[-58, 110], [58, 110], [58, -34], [-58, -34]];  // the robot and its handle round the pen: x to its right, y ahead
const robotBox = (pose) => {
  const [fx, fy] = dirOf(pose.h);
  return BOX.map(([x, y]) => [pose.x + fy * x + fx * y, pose.y - fx * x + fy * y]);
};
const HANDLE = 98;                              // mm in front of the pen: the handle that turns the robot
const MIN_VIEW = { w: 150, h: 105 };

const d = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${(-y).toFixed(2)}`).join('');
const unionBounds = (a, b) => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) });
const snapMm = (w) => ({ x: Math.round(w.x / 5) * 5, y: Math.round(w.y / 5) * 5 });
// The turning handle's picture, round its own centre (0, 0): a circular arrow, an arc of about 270 degrees clockwise on the screen with a head.
const TURN_R = 3.6;
const at = (deg) => [TURN_R * Math.cos((deg * Math.PI) / 180), TURN_R * Math.sin((deg * Math.PI) / 180)];
const TURN_FROM = -40;
const TURN_TO = 215;
const TURN_ARC = `M${at(TURN_FROM).map((v) => v.toFixed(2)).join(',')} A${TURN_R},${TURN_R} 0 1 1 ${at(TURN_TO).map((v) => v.toFixed(2)).join(',')}`;
const TURN_HEAD = (() => {                                             // a small triangle at the end of the arc, along the way it goes
  const [x, y] = at(TURN_TO);
  const a = (TURN_TO * Math.PI) / 180;
  const tan = [-Math.sin(a), Math.cos(a)];                             // clockwise on the screen
  const nor = [Math.cos(a), Math.sin(a)];
  const p = (k, n) => `${(x + tan[0] * k + nor[0] * n).toFixed(2)},${(y + tan[1] * k + nor[1] * n).toFixed(2)}`;
  return `M${p(2.6, 0)} L${p(-0.9, 2.2)} L${p(-0.9, -2.2)} Z`;
})();
// The end angle at the end of a time of the form: an arc with an arrow from the heading before it to the heading after, its angle, and a
// short arrow along the heading the robot stops in (strong at the very end). World coordinates (mm), y up; `d` flips them.
const END_R = 11;
const END_LEN = 17;
const onHeading = (x, y, h, r) => [x - Math.sin((h * Math.PI) / 180) * r, y + Math.cos((h * Math.PI) / 180) * r];
function endMark(e) {
  const delta = e.to - e.from;
  const out = { heading: [[e.x, e.y], onHeading(e.x, e.y, e.to, END_LEN)], head: null, arc: null, label: null };
  // the arrow's head at the end of the heading line
  const tip = onHeading(e.x, e.y, e.to, END_LEN + 3);
  const left = onHeading(e.x, e.y, e.to, END_LEN - 1);
  const side = [Math.cos((e.to * Math.PI) / 180), Math.sin((e.to * Math.PI) / 180)];
  out.head = [tip, [left[0] + side[0] * 2.4, left[1] + side[1] * 2.4], [left[0] - side[0] * 2.4, left[1] - side[1] * 2.4]];
  if (Math.abs(delta) >= 1) {
    const n = Math.max(2, Math.ceil(Math.abs(delta) / 6));
    out.arc = Array.from({ length: n + 1 }, (_, i) => onHeading(e.x, e.y, e.from + (delta * i) / n, END_R));
    const a = e.to;
    const dir = Math.sign(delta);                                       // the way the arc goes at its end (the derivative of the point with the heading)
    const t = [-Math.cos((a * Math.PI) / 180) * dir, -Math.sin((a * Math.PI) / 180) * dir];
    const p = out.arc[n];
    const nor = [-t[1], t[0]];
    out.arcHead = [[p[0] + t[0] * 3.2, p[1] + t[1] * 3.2], [p[0] + nor[0] * 2.3, p[1] + nor[1] * 2.3], [p[0] - nor[0] * 2.3, p[1] - nor[1] * 2.3]];
    out.label = { at: onHeading(e.x, e.y, e.from + delta / 2, END_R + 6), text: `${delta > 0 ? '+' : '−'}${Math.round(Math.abs(delta))}°` };
  }
  return out;
}
const poly = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${(-y).toFixed(2)}`).join('') + 'Z';
const norm = (h) => ((((h + 180) % 360) + 360) % 360) - 180;

export default function Sheet({ t, snap, figure, view, live, onPlace, onCustom }) {
  const svgRef = useRef(null);
  const drag = useRef(null);
  const [frozen, setFrozen] = useState(null);

  const busy = snap.state !== 'idle';
  const drawing = busy && snap.drawing >= 0;
  const last = snap.ink[snap.ink.length - 1];
  const anchor = drawing && last ? last.start : snap.pose;
  const isCustom = figure.id === CUSTOM_ID;
  const editing = isCustom && !busy;
  const figKey = isCustom ? JSON.stringify([snap.custom, snap.repeat, snap.endAngle]) : figure.id;
  const preview = useMemo(
    () => figurePath(figure, { pose: { x: anchor.x, y: anchor.y, h: anchor.h }, mm: snap.mm, loss: snap.loss, size: snap.size }),
    [figKey, snap.size, anchor.x, anchor.y, anchor.h, snap.mm, snap.loss],
  );

  // the part of the plane in view: the whole A4 sheet, or the figure, the ink and the robot at its start with a margin. While the robot
  // draws, the view only grows (it keeps whatever the robot has needed), so that the picture does not shake.
  const reach = useRef(null);
  const idleFrame = useMemo(() => {
    const pts = [...preview.points, ...(preview.ends || []).flatMap((e) => [onHeading(e.x, e.y, e.to, END_LEN + 4), onHeading(e.x, e.y, e.from, END_R + 12)]), ...robotBox(anchor)];
    if (!live) for (const s of snap.ink) for (const p of s.points) pts.push(p);          // (a real robot's trace is the pen's, on the paper: none here)
    return bounds(pts);
  }, [preview, anchor.x, anchor.y, anchor.h, snap.ink, snap.version, live]);
  if (!busy) reach.current = null;
  else reach.current = unionBounds(reach.current || idleFrame, bounds(robotBox(snap.pose)));
  const frame = useMemo(() => {
    if (view === 'a4') return { x: -A4.w / 2 - 8, y: -A4.h / 2 - 8, w: A4.w + 16, h: A4.h + 16 };
    const b = busy && reach.current ? unionBounds(reach.current, idleFrame) : idleFrame;
    const pad = 10;
    const w = Math.max(b.maxX - b.minX + 2 * pad, MIN_VIEW.w);
    const h = Math.max(b.maxY - b.minY + 2 * pad, MIN_VIEW.h);
    return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h };
  }, [view, idleFrame, busy, snap.pose.x, snap.pose.y, snap.pose.h]);
  const f = frozen || frame;

  // grid: every 10 mm, a stronger line every 50 mm, over the frame and a margin (the picture is letterboxed)
  const grid = useMemo(() => {
    const span = Math.max(f.w, f.h) * 1.6;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const step = span / 10 > 80 ? 50 : 10;
    const lines = [];
    for (let x = Math.ceil((cx - span / 2) / step) * step; x <= cx + span / 2; x += step) lines.push({ key: `x${x}`, x1: x, y1: -(cy + span / 2), x2: x, y2: -(cy - span / 2), major: x % 50 === 0 });
    for (let y = Math.ceil((cy - span / 2) / step) * step; y <= cy + span / 2; y += step) lines.push({ key: `y${y}`, x1: cx - span / 2, y1: -y, x2: cx + span / 2, y2: -y, major: y % 50 === 0 });
    return lines;
  }, [f.x, f.y, f.w, f.h]);

  // ---- moving and turning the robot -----------------------------------------------------------------
  const canMove = !busy;
  const toWorld = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: -p.y };
  };
  const down = (kind, index) => (e) => {
    if (!canMove) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const w = toWorld(e);
    drag.current = { kind, index, dx: snap.pose.x - w.x, dy: snap.pose.y - w.y };
    setFrozen(frame);
  };
  // (a tap, not the start of a scroll: a click)
  const paperDown = (e) => {
    if (!editing) return;
    onCustom.add(snapMm(toWorld(e)));
  };
  const move = (e) => {
    const g = drag.current;
    if (!g) return;
    const w = toWorld(e);
    if (g.kind === 'point') {
      onCustom.move(g.index, snapMm(w));
    } else if (g.kind === 'move') {
      onPlace({ x: w.x + g.dx, y: w.y + g.dy, h: snap.pose.h });
    } else {
      let h = (Math.atan2(-(w.x - snap.pose.x), w.y - snap.pose.y) * 180) / Math.PI;
      const near = Math.round(h / 15) * 15;
      if (Math.abs(h - near) < 4) h = near;
      onPlace({ x: snap.pose.x, y: snap.pose.y, h: norm(h) });
    }
  };
  const up = () => { drag.current = null; setFrozen(null); };
  const key = (e) => {
    if (!canMove) return;
    const step = e.shiftKey ? 1 : 5;
    const p = snap.pose;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); onPlace({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1], h: p.h }); }
    else if (e.key === '[' || e.key === ']') { e.preventDefault(); onPlace({ ...p, h: norm(p.h + (e.key === '[' ? 15 : -15)) }); }
  };

  const light = BODY_LIGHT[snap.colour] ? GROUND[snap.colour] : '';
  const p = snap.pose;
  const [hx, hy] = dirOf(p.h);
  const handle = [Math.round((p.x + hx * HANDLE) * 100) / 100, Math.round((p.y + hy * HANDLE) * 100) / 100];
  const text = Math.max(f.w, f.h) / 38;
  const vb = `${f.x.toFixed(2)} ${(-(f.y + f.h)).toFixed(2)} ${f.w.toFixed(2)} ${f.h.toFixed(2)}`;
  // (a form of the page's own may begin with a turn on the spot, which has no leg)
  const legsPerTime = isCustom ? figure.steps.filter((s) => s.len !== 0).length : figure.steps.length;
  const legIndex = isCustom ? snap.rep * legsPerTime + figure.steps.slice(0, snap.step + 1).filter((s) => s.len !== 0).length - 1 : snap.step;
  const activeLeg = drawing ? preview.legs[Math.max(0, Math.min(legIndex, preview.legs.length - 1))] : null;
  const corners = isCustom ? [] : preview.legs.map((l, i) => (figure.steps[i].side ? l[l.length - 1] : null)).filter(Boolean);
  const start = preview.points[0] || [anchor.x, anchor.y];             // (a form with no point yet has no path)
  const cpts = editing ? snap.custom.map(([x, y]) => localToWorld(p, { x, y })) : [];
  const chain = [p, ...cpts];

  return (
    <div className={`sheet ${view} ${busy ? 'busy' : ''} ${live ? 'live' : ''} ${editing ? 'custom-edit' : ''}`}>
      <svg ref={svgRef} viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t.sheet.title} className="sheet-svg"
        onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <rect className="desk" x={f.x - 1000} y={-(f.y + f.h) - 1000} width={f.w + 2000} height={f.h + 2000} onClick={paperDown} />
        <rect className="paper" onClick={paperDown} x={view === 'a4' ? -A4.w / 2 : f.x - 1000} y={view === 'a4' ? -A4.h / 2 : -(f.y + f.h) - 1000} width={view === 'a4' ? A4.w : f.w + 2000} height={view === 'a4' ? A4.h : f.h + 2000} />
        <g className="grid" aria-hidden="true">
          {grid.map((l) => <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.major ? 'major' : 'minor'} />)}
        </g>

        <g className={`robot ${canMove && !editing ? 'movable' : ''}`} role="button" tabIndex={canMove && !editing ? 0 : -1} aria-label={t.sheet.robot}
          onPointerDown={editing ? undefined : down('move')} onKeyDown={key}
          style={{ transform: `translate(${p.x}px, ${-p.y}px) rotate(${-p.h}deg) translate(${-PEN.x}px, ${-PEN.y}px)`, touchAction: 'none', pointerEvents: editing ? 'none' : undefined }}>
          <RobotBody light={light} />
        </g>

        <g className="ghost" aria-hidden="true">
          <path d={d(preview.points)} className="ghost-line" />
          {corners.map(([x, y], i) => <circle key={i} cx={x} cy={-y} r="1.5" className="ghost-corner" />)}
          {activeLeg && <path d={d(activeLeg)} className="ghost-active" />}
          <circle cx={start[0]} cy={-start[1]} r="2.6" className="ghost-start" />
          {isCustom && (preview.ends || []).map((e, i) => {
            const m = endMark(e);
            return (
              <g key={`end${i}`} className={`end-mark ${e.last ? 'final' : ''}`}>
                {m.arc && <path d={d(m.arc)} className="end-arc" />}
                {m.arcHead && <path d={poly(m.arcHead)} className="end-head" />}
                <path d={d(m.heading)} className="end-heading" />
                <path d={poly(m.head)} className="end-head" />
                {m.label && <text x={m.label.at[0]} y={-m.label.at[1] + text * 0.28} textAnchor="middle" className="end-label" style={{ fontSize: text * 0.82 }}>{m.label.text}</text>}
              </g>
            );
          })}
        </g>

        {!live && (
          <g className="ink" aria-hidden="true">
            {snap.ink.map((s, i) => <path key={i} d={d(s.points)} className="ink-line" />)}
          </g>
        )}

        {editing && (
          <g className="points">
            {chain.slice(1).map((q, i) => {
              const a = chain[i];
              const len = Math.hypot(q.x - a.x, q.y - a.y);
              return len > 12 ? <text key={`l${i}`} className="seg-len" x={(a.x + q.x) / 2} y={-(a.y + q.y) / 2 - 2.2} textAnchor="middle" style={{ fontSize: text * 0.8 }}>{fmt(t.custom.length, { n: Math.round(len) })}</text> : null;
            })}
            {cpts.map((q, i) => (
              <g key={i} className="cpoint" role="button" tabIndex={0} aria-label={`${i + 1}`} style={{ touchAction: 'none' }}
                onPointerDown={down('point', i)} onDoubleClick={() => onCustom.remove(i)}
                onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onCustom.remove(i); } }}>
                <circle cx={q.x} cy={-q.y} r="9" className="cpoint-hit" />
                <circle cx={q.x} cy={-q.y} r="4.6" className="cpoint-dot" />
                <text x={q.x} y={-q.y + 1.9} textAnchor="middle" className="cpoint-n">{i + 1}</text>
              </g>
            ))}
            <g className="grip" role="button" tabIndex={0} aria-label={t.sheet.robot} onPointerDown={down('move')} onKeyDown={key} style={{ touchAction: 'none' }}>
              <circle cx={p.x} cy={-p.y} r="11" className="grip-ring" />
              <circle cx={p.x} cy={-p.y} r="3" className="ghost-start" />
            </g>
          </g>
        )}

        {canMove && (
          <g className="handle-wrap" aria-hidden="false">
            <line x1={p.x} y1={-p.y} x2={handle[0]} y2={-handle[1]} className="handle-line" />
            <g className="handle" role="slider" tabIndex={0} aria-label={t.sheet.rotate} aria-valuemin={-180} aria-valuemax={180} aria-valuenow={Math.round(p.h)}
              onPointerDown={down('turn')} onKeyDown={key} style={{ touchAction: 'none' }}>
              <circle cx={handle[0]} cy={-handle[1]} r="12" className="handle-hit" />
              <g transform={`translate(${handle[0]} ${-handle[1]})`}>
                <circle r="8" className="handle-dot" />
                <g transform="translate(0.83 0.29)">                  {/* (the arrow's box is a little left of its circle's middle: put it back at the middle of the badge) */}
                  <path d={TURN_ARC} className="handle-arrow" />
                  <path d={TURN_HEAD} className="handle-head" />
                </g>
              </g>
            </g>
          </g>
        )}

        <g className="scale" aria-hidden="true">
          <path d={`M${f.x + 8},${-(f.y + 8)} h50 m0,-2 v4 m-50,-4 v4`} className="scale-line" />
          <text x={f.x + 8 + 25} y={-(f.y + 8) - 4} textAnchor="middle" style={{ fontSize: text }}>{fmt(t.sheet.scale, { n: 5 })}</text>
        </g>
      </svg>
    </div>
  );
}
