import React from 'react';
import RobotBody from './RobotBody.jsx';
import { iconData } from './FigureIcon.jsx';
import { FIGURES } from '../spec.js';

// The drawings of the robot's manual (see Manual.jsx): the Painter mode of the firmware, with no tablet (main/mode.c and main/drawer.c).
// Each scene is an SVG of 320 x 200 that scales to its card; the few words come in as props, the rest is shapes. The robot is the one of the
// sheet (RobotBody.jsx), in its own millimetres around the middle of its body.
const INK = '#23232b', PINK = '#e0357a', MUTED = '#6f6d78', BLUE = '#1d5fe0', YELLOW = '#f2b900', RED = '#d6382f', GREEN = '#148f3f';
const BUTTON = { F: [0, -38.5], B: [0, -13.5], L: [-12.5, -26], R: [12.5, -26], C: [0, -26] };       // the pad of five touch buttons

// A ripple around what is touched
function Ripple({ x, y, r = 8 }) {
  return (
    <g fill="none" stroke={PINK} strokeLinecap="round">
      <circle cx={x} cy={y} r={r} strokeWidth="2.8" />
      <circle cx={x} cy={y} r={r + 5} strokeWidth="1.8" opacity=".5" />
    </g>
  );
}

// A straight or bent arrow, with a head that follows the way it goes at its tip
function Arrow({ from, via, to, color = PINK, width = 3.2, head = 9 }) {
  const [x0, y0] = from, [x1, y1] = to;
  const [cx, cy] = via || [(x0 + x1) / 2, (y0 + y1) / 2];
  const len = Math.hypot(x1 - cx, y1 - cy) || 1;
  const ux = (x1 - cx) / len, uy = (y1 - cy) / len;
  const bx = x1 - ux * head, by = y1 - uy * head, hw = head * 0.62;
  return (
    <g stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x0} ${y0} Q${cx} ${cy} ${bx} ${by}`} fill="none" strokeWidth={width} />
      <path d={`M${x1} ${y1} L${bx - uy * hw} ${by + ux * hw} L${bx + uy * hw} ${by - ux * hw} Z`} fill={color} strokeWidth="1.6" />
    </g>
  );
}

// The robot seen from above at (x, y), `s` times its millimetres; `menu`: its body lights as the menu shows the Painter mode (blue in front,
// yellow behind); `press`: the buttons that are touched; `children` are drawn over it, in its own frame.
function Robot({ x, y, s = 0.8, menu = false, press = [], children }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="m-robot">
      <RobotBody />
      {menu && [-34, 34].map((px) => <circle key={`f${px}`} cx={px} cy="-24" r="8.5" fill={BLUE} />)}
      {menu && [-31, 31].map((px) => <circle key={`b${px}`} cx={px} cy="46" r="8.5" fill={YELLOW} />)}
      {press.map((b) => <Ripple key={b} x={BUTTON[b][0]} y={BUTTON[b][1]} r={b === 'C' ? 7.5 : 8} />)}
      {children}
    </g>
  );
}

const Step = ({ x, y, n }) => (
  <g transform={`translate(${x} ${y})`}><circle r="10" fill={INK} /><text y="4.5" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff">{n}</text></g>
);
const Word = ({ x, y, size = 12.5, color = INK, anchor = 'middle', weight = 800, children }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color}>{children}</text>
);

// The modes of the robot as its menu shows them, in the order the arrows go through them (main/mode.c): the colours of the body lights,
// front left, front right, back right, back left. The Painter mode is the one with blue in front and yellow behind.
const MAGENTA = '#e040fb', CYAN = '#18c8d6', ORANGE = '#ff9f1c', DARK_BLUE = '#1b2f9e';
const MODES = [
  [MAGENTA, MAGENTA, CYAN, CYAN],                     // the sequence mode
  [GREEN, GREEN, GREEN, GREEN],
  [ORANGE, ORANGE, ORANGE, ORANGE],
  [RED, RED, RED, RED],
  [DARK_BLUE, DARK_BLUE, DARK_BLUE, DARK_BLUE],
  [CYAN, CYAN, CYAN, CYAN],
  [MAGENTA, MAGENTA, MAGENTA, MAGENTA],
  [BLUE, BLUE, YELLOW, YELLOW],                       // the Painter mode
  [BLUE, GREEN, YELLOW, RED],
  ['#fff', '#fff', '#fff', '#fff'],
];
const PAINTER = 7;

// All the modes in a row, the one of this manual framed
function Modes({ y }) {
  return (
    <g>
      {MODES.map((c, i) => (
        <g key={i} transform={`translate(${6 + i * 31.4} ${y})`}>
          {i === PAINTER && <rect x="-3.5" y="-4" width="32" height="34" rx="8" fill="#fde7f0" stroke={PINK} strokeWidth="2.6" />}
          <path d="M2 12 Q2 2 12.5 2 Q23 2 23 12 V22 Q23 24 21 24 H4 Q2 24 2 22 Z" fill="#e4e9f1" stroke="#8896ae" strokeWidth="1.3" />
          {[[7.5, 10], [17.5, 10], [17.5, 18.5], [7.5, 18.5]].map(([x, cy], k) => <circle key={k} cx={x} cy={cy} r="3.5" fill={c[k]} stroke="#6f6d78" strokeWidth=".6" />)}
        </g>
      ))}
    </g>
  );
}

const Lines = ({ x, y, a, b }) => (
  <g><Word x={x} y={y} size={11.5}>{a}</Word><Word x={x} y={y + 13} size={11.5}>{b}</Word></g>
);

// ---- 1. choose the mode among the others: in the menu, the arrows until blue and yellow, then the middle button ----------------------------
export function ModeArt({ labels }) {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <Step x={14} y={14} n={1} />
      <Robot x={82} y={58} s={0.76} menu press={['L', 'R']} />
      {/* the arrows go through the modes */}
      <Arrow from={[56, 38]} to={[26, 38]} />
      <Arrow from={[108, 38]} to={[138, 38]} />
      <Lines x={82} y={114} a={labels.arrows1} b={labels.arrows2} />
      <Arrow from={[148, 62]} to={[176, 62]} color={MUTED} />
      <Step x={190} y={14} n={2} />
      <Robot x={242} y={58} s={0.76} menu press={['C']} />
      <Lines x={242} y={114} a={labels.centre1} b={labels.centre2} />
      <Modes y={141} />
      <Word x={160} y={188} size={11.5}>{labels.choose}</Word>
    </svg>
  );
}

// ---- 2. choose the figure: left and right along a row, forward and backward change row; the lit LEDs count the place ---------------------
function Figure({ fig, x, y, size = 30 }) {
  const { d, viewBox, start, unit } = iconData(fig);
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={viewBox} overflow="visible">
      <path d={d} fill="none" stroke={INK} strokeWidth={4.6 * unit} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={start[0]} cy={start[1]} r={5 * unit} fill={GREEN} />
    </svg>
  );
}

const Key = ({ x, y, turn }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-13" y="-13" width="26" height="26" rx="7" fill="#fff" stroke={INK} strokeWidth="2.4" />
    <path d="M0 -7 L7 5 H-7 Z" fill={PINK} transform={`rotate(${turn})`} />
  </g>
);

const Leds = ({ x, y, lit, r = 4.2, gap = 11 }) => (
  <g>{Array.from({ length: 8 }, (_, i) => <circle key={i} cx={x + i * gap} cy={y} r={r} fill={i >= 8 - lit ? INK : '#fff'} stroke={INK} strokeWidth="1.4" />)}</g>
);

export function PickArt({ labels }) {
  const row = (from, y, label) => (
    <g>
      <Word x={4} y={y} anchor="start" color={MUTED}>{label}</Word>
      {FIGURES.slice(from, from + 8).map((fig, i) => (
        <g key={fig.id}>
          <rect x={4 + i * 39.5} y={y + 6} width="36" height="46" rx="8" fill="#f6f5f1" />
          <Figure fig={fig} x={7 + i * 39.5} y={y + 9} />
          <Word x={22 + i * 39.5} y={y + 50} size={11} color={MUTED}>{i + 1}</Word>
        </g>
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      {row(0, 12, labels.front)}
      {row(8, 78, labels.back)}
      {/* the keys */}
      <Key x={18} y={163} turn={-90} /><Key x={47} y={163} turn={90} />
      <Word x={32} y={193} size={11.5}>{labels.figure}</Word>
      <Key x={84} y={151} turn={0} /><Key x={84} y={181} turn={180} />
      <Word x={101} y={170} anchor="start" size={11.5}>{labels.row}</Word>
      {/* an example: the two rows of LEDs, four lit in front and none behind, is the fourth figure of the first row, the square */}
      <rect x="146" y="138" width="172" height="60" rx="12" fill="#f6f5f1" />
      <Word x={152} y={158} anchor="start" size={10.5} color={MUTED}>{labels.frontShort}</Word>
      <Leds x={205} y={154} lit={4} r={3.5} gap={8.8} />
      <Word x={152} y={186} anchor="start" size={10.5} color={MUTED}>{labels.backShort}</Word>
      <Leds x={205} y={182} lit={0} r={3.5} gap={8.8} />
      <Word x={277} y={174} size={16}>=</Word>
      <Figure fig={FIGURES[3]} x={284} y={153} size={30} />
    </svg>
  );
}

// ---- 3. draw: a pen in the middle hole, a hand behind the robot then taken away; at the end three blinks and a sound ----------------------
function Hand({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#ffd9b3" stroke="#c98d55" strokeWidth="2.2" strokeLinejoin="round">
      <rect x="-20" y="-2" width="40" height="28" rx="11" />
      {[-17, -6, 5, 16].map((fx, i) => <rect key={fx} x={fx - 4.2} y={-24 - (i === 1 || i === 2 ? 4 : 0)} width="8.4" height={i === 1 || i === 2 ? 30 : 26} rx="4.2" />)}
      <rect x="-30" y="6" width="9" height="20" rx="4.5" transform="rotate(-28 -26 18)" />
    </g>
  );
}

export function DrawArt({ labels }) {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="190" height="168" rx="6" fill="#fff" stroke="#c9c7bd" strokeWidth="2" />
      <Step x={22} y={24} n={1} />
      <Robot x={82} y={86} s={0.82}>
        {/* the pen, standing in the hole */}
        <g transform="translate(0 26) rotate(38)"><rect x="-5" y="-62" width="10" height="50" rx="3" fill={RED} /><path d="M-5 -12 L0 0 L5 -12 Z" fill={INK} /></g>
        {/* the two rear sensors */}
        {[-22, 22].map((px) => <circle key={px} cx={px} cy="56" r="4.6" fill="#ff9f1c" />)}
      </Robot>
      <Word x={184} y={24} anchor="end">{labels.pen}</Word>
      <Arrow from={[150, 32]} via={[144, 56]} to={[119, 66]} color={MUTED} width={2.4} head={8} />
      <Step x={22} y={158} n={2} />
      <Hand x={82} y={150} s={0.95} />
      <Arrow from={[116, 144]} via={[150, 142]} to={[160, 168]} />
      <Word x={99} y={192}>{labels.hand}</Word>
      {/* at the end: the ring blinks three times, and a sound */}
      <g transform="translate(258 78)">
        <circle r="34" fill="#f1f0ea" />
        {Array.from({ length: 8 }, (_, k) => <circle key={k} cx={24 * Math.sin((k * Math.PI) / 4)} cy={-24 * Math.cos((k * Math.PI) / 4)} r="6" fill={YELLOW} />)}
        <Word x={0} y={6} size={17}>×3</Word>
      </g>
      <Word x={292} y={46} size={24} color={PINK}>♪</Word>
      <Word x={258} y={140}>{labels.end}</Word>
    </svg>
  );
}

// ---- 4. stop: the middle button stops the robot and goes back to the choice of the mode, among the others --------------------------------
export function StopArt({ labels }) {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <Robot x={82} y={58} s={0.76} press={['C']} />
      <g transform="translate(132 22)"><circle r="16" fill={RED} /><rect x="-6.5" y="-6.5" width="13" height="13" rx="2.5" fill="#fff" /></g>
      <Lines x={82} y={114} a={labels.centre1} b={labels.centre2} />
      <Arrow from={[148, 62]} to={[176, 62]} color={MUTED} />
      <Robot x={242} y={58} s={0.76} menu />
      <Lines x={242} y={114} a={labels.menu1} b={labels.menu2} />
      <Modes y={141} />
      <Word x={160} y={188} size={11.5}>{labels.choose}</Word>
    </svg>
  );
}
