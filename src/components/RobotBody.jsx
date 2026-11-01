import React from 'react';

// The Thymio 3 seen from above, front up, in millimetres around the middle of the body, drawn after the pictures of the robot (its
// box and its underside): a rounded nose (a half ellipse), straight sides, a cut-out on each side where the wheel sits, and a flat
// tail behind the wheels. On top: the round pad of five touch buttons near the nose, the Lego studs, 8 mm apart, the round button
// and the contacts at the back. The wheels are on the sides, 26 mm behind the middle of the body, 96 mm apart, a little proud of
// the body: 40 mm long, 16 mm wide, 80 mm across from tyre to tyre. The round hole in the middle (for the pen) is on the line of the
// wheels' axle: the point the drawing follows.
export const BODY = 'M-55,52 Q-55,56 -51,56 L51,56 Q55,56 55,52 L55,47 L40,47 L40,1 L51.5,1 L51.5,-13 A51.5,43 0 0 0 -51.5,-13 L-51.5,1 L-40,1 L-40,47 L-55,47 Z';
export const WHEEL = { x: 47.8, y: 26, w: 16.4, h: 40 };
export const PEN = { x: 0, y: WHEEL.y };                     // in the drawing's own frame

const STUD_ROWS = [[0, 1, 8, 9], [0, 1, 8, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 6, 7, 8, 9]];
const STUDS = STUD_ROWS.flatMap((cols, j) => cols.map((k) => [(k - 4.5) * 8, -9 + 8 * j]));
const PAD = { x: 0, y: -26, r: 24 };

// `light`: a colour (CSS) the body lights show, or '' for none.
export default function RobotBody({ light = '', details = true, wheels = true, className = '' }) {
  return (
    <g className={`robot-body ${className}`}>
      <path d={BODY} className="body" />
      {light && <path d={BODY} className="glow" style={{ fill: light }} />}
      {details && (
        <g className="details" aria-hidden="true">
          <circle cx={PAD.x} cy={PAD.y} r={PAD.r} className="line" />
          <ellipse cx={PAD.x} cy={PAD.y - 12.5} rx="5.5" ry="6.4" className="line" />
          <ellipse cx={PAD.x} cy={PAD.y + 12.5} rx="5.5" ry="6.4" className="line" />
          <ellipse cx={PAD.x - 12.5} cy={PAD.y} rx="6.4" ry="5.5" className="line" />
          <ellipse cx={PAD.x + 12.5} cy={PAD.y} rx="6.4" ry="5.5" className="line" />
          <circle cx={PAD.x} cy={PAD.y} r="6.2" className="line" />
          {STUDS.map(([x, y], k) => <circle key={k} cx={x} cy={y} r="2.1" className="stud" />)}
          <rect x="-5.5" y="49.6" width="11" height="2.6" rx="1.3" className="line" />
          <circle cx="0" cy="45.6" r="0.9" className="stud" />
        </g>
      )}
      {wheels && [-1, 1].map((side) => (
        <g key={side} transform={`translate(${side * WHEEL.x} ${WHEEL.y})`} className="wheel-side">
          <rect x={-WHEEL.w / 2} y={-WHEEL.h / 2} width={WHEEL.w} height={WHEEL.h} rx="5" className="tyre" />
          {[-14, -8.5, -3, 2.5, 8, 13.5].map((y) => <path key={y} d={`M${-WHEEL.w / 2 + 3},${y} H${WHEEL.w / 2 - 3}`} className="rib" />)}
        </g>
      ))}
      <circle cx={PEN.x} cy={PEN.y} r="6" className="pen-hole" />
    </g>
  );
}
