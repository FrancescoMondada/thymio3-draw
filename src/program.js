// The "Géométrie" form of the page: a geometric program, a list of instructions that the person writes instead of putting points on the sheet.
//
//   { op: 'f', v: mm }                    forward v millimetres (the pen draws a side)
//   { op: 'l', v: degrees }               turn left, on the spot
//   { op: 'r', v: degrees }               turn right, on the spot
//   { op: 'x', v: times, body: [...] }    repeat the instructions of the body v times (loops can hold loops)
//
// It is not a new thing for the robot: it is turned (compileProgram) into the list of sides and turns that the mode already draws for the
// page's own form, with the number of times it is drawn. Pure data and functions, no import but the numbers, so that Node can test them.
import { CUSTOM_ID, CUSTOM_MAX_STEPS } from './spec.js';

export const LIMITS = {                   // of each instruction's number: smallest, largest, the step of the + and − buttons, the one a new one gets
  f: { min: 1, max: 300, step: 5, start: 40 },
  l: { min: 1, max: 360, step: 5, start: 90 },
  r: { min: 1, max: 360, step: 5, start: 90 },
  x: { min: 1, max: 50, step: 1, start: 4 },
};
export const OPS = Object.keys(LIMITS);
export const MAX_DEPTH = 3;               // loops inside loops, three deep
export const MAX_NODES = 40;              // instructions in the whole program (the QR code carries them all)

export const clampValue = (op, v) => {
  const { min, max, start } = LIMITS[op];
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : start;
};

export const countNodes = (list) => list.reduce((n, node) => n + 1 + (node.op === 'x' ? countNodes(node.body) : 0), 0);

// Whatever comes from the outside (the tab's memory, a code): only what is a program, with numbers in their range, within the limits.
export function cleanProgram(list) {
  let room = MAX_NODES;
  const walk = (items, depth) => {
    const out = [];
    for (const node of Array.isArray(items) ? items : []) {
      if (!node || !OPS.includes(node.op) || room <= 0) continue;
      if (node.op === 'x' && depth >= MAX_DEPTH) continue;
      room -= 1;
      out.push(node.op === 'x' ? { op: 'x', v: clampValue('x', node.v), body: walk(node.body, depth + 1) } : { op: node.op, v: clampValue(node.op, node.v) });
    }
    return out;
  };
  return walk(list, 0);
}

// ---- editing: an instruction is found by its path, the places from the top: [2] the third one, [2, 0] the first one inside it --------
export const pathKey = (path) => path.join('.');

// The program with the list that holds the instructions of `path` (a loop's body; [] is the program itself) replaced by change(list).
const withList = (program, path, change) => (path.length === 0
  ? change(program)
  : program.map((node, i) => (i === path[0] && node.op === 'x' ? { ...node, body: withList(node.body, path.slice(1), change) } : node)));

// A new instruction at the end of the body of the loop at `into` ([] is the end of the program). Unchanged when there is no room for it.
export function addNode(program, into, op) {
  if (!OPS.includes(op) || countNodes(program) >= MAX_NODES || (op === 'x' && into.length >= MAX_DEPTH)) return program;
  const node = op === 'x' ? { op, v: LIMITS.x.start, body: [] } : { op, v: LIMITS[op].start };
  return withList(program, into, (list) => [...list, node]);
}

export const setValue = (program, path, v) => withList(program, path.slice(0, -1), (list) => list.map((node, i) => (i === path[path.length - 1] ? { ...node, v: clampValue(node.op, v) } : node)));

export const removeNode = (program, path) => withList(program, path.slice(0, -1), (list) => list.filter((_, i) => i !== path[path.length - 1]));

// One place up (delta -1) or down (+1) among the instructions of the same list.
export const moveNode = (program, path, delta) => withList(program, path.slice(0, -1), (list) => {
  const i = path[path.length - 1];
  const j = i + delta;
  if (!list[i] || !list[j]) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
});

// ---- from the program to what the robot draws -----------------------------------------------------------------------------------
// The sides and turns of a list of instructions: [{ len (mm), turn (degrees, left is positive), from: [path keys of the side],
// turnFrom: [path keys of the turn] }]. Two "forward" with no turn between them make one side; the turns that follow each other make one
// turn; a turn before the first side is a side of no length. Stops, and says so, past `most` sides.
function unroll(list, path, steps, most) {
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    const key = pathKey([...path, i]);
    if (node.op === 'x') {
      for (let n = 0; n < node.v; n++) {
        if (!unroll(node.body, [...path, i], steps, most)) return false;
      }
      continue;
    }
    const last = steps[steps.length - 1];
    if (node.op === 'f') {
      if (last && last.len > 0 && !last.turnFrom.length) {
        last.len += node.v;
        if (!last.from.includes(key)) last.from.push(key);
      } else steps.push({ len: node.v, turn: 0, from: [key], turnFrom: [] });
    } else {
      if (!last) steps.push({ len: 0, turn: 0, from: [], turnFrom: [] });
      const step = steps[steps.length - 1];
      step.turn += node.op === 'l' ? node.v : -node.v;
      if (!step.turnFrom.includes(key)) step.turnFrom.push(key);
    }
    if (steps.length > most) return false;
  }
  return true;
}

const whole = (turn) => (Math.abs(turn) > 360 ? turn % 360 : turn);        // more than a whole turn draws the same
const finish = (steps) => steps.map((s) => ({ ...s, turn: whole(s.turn) }));

// What the robot is told: { steps, repeat, error }. A program that is one loop around everything is the loop's body drawn that many times
// (the robot counts the times itself, so that a loop of 36 costs it one body). Any other is written out in full, once. The robot holds at
// most CUSTOM_MAX_STEPS sides. error: '' | 'empty' (no instruction) | 'nothing' (no side: nothing would be drawn) | 'long'.
export function compileProgram(program) {
  const none = (error) => ({ steps: [], repeat: 1, error });
  if (!program.length) return none('empty');
  const loop = program.length === 1 && program[0].op === 'x' ? program[0] : null;
  const steps = [];
  const fits = loop ? unroll(loop.body, [0], steps, CUSTOM_MAX_STEPS) : unroll(program, [], steps, CUSTOM_MAX_STEPS);
  if (!fits) return none('long');
  if (!steps.some((s) => s.len > 0)) return none('nothing');
  return { steps: finish(steps), repeat: loop ? loop.v : 1, error: '' };
}

// The figure of a program, like the others (see geometry.js): the page's own figure, number 16 for the robot.
export function programFigure(program) {
  const { steps, repeat, error } = compileProgram(program);
  return { id: CUSTOM_ID, group: 'geometry', key: 'geometry', program: true, steps, repeat, endAngle: 0, error };
}

// The instructions that the robot is carrying out in the step `step`, in its side ('s') or its turn ('t'): their path keys.
export function activeKeys(figure, step, phase) {
  const s = figure.steps[step];
  if (!s) return [];
  return phase === 't' || s.len === 0 ? s.turnFrom : s.from;
}

// ---- a few programs to start from -----------------------------------------------------------------------------------------------
const f = (v) => ({ op: 'f', v });
const l = (v) => ({ op: 'l', v });
const r = (v) => ({ op: 'r', v });
const x = (v, ...body) => ({ op: 'x', v, body });
export const PROGRAM_PRESETS = {
  square: [x(4, f(40), l(90))],
  triangle: [x(3, f(50), l(120))],
  star: [x(5, f(60), r(144))],
  stairs: [x(4, f(20), l(90), f(20), r(90))],
  rosette: [x(8, x(4, f(30), l(90)), l(45))],
};

// ---- the program as a short text, for the QR code: f40 l90 r144, and a loop 4(...) -------------------------------------------------
export const programText = (list) => list.map((n) => (n.op === 'x' ? `${n.v}(${programText(n.body)})` : `${n.op}${n.v}`)).join('');

// Read strictly: null for anything that is not a program of the page, with every number in its range and within the limits.
export function parseProgram(text) {
  if (typeof text !== 'string' || text.length > MAX_NODES * 6) return null;
  let at = 0;
  let count = 0;
  const number = () => {
    const m = /^\d{1,3}/.exec(text.slice(at));
    if (!m) return NaN;
    at += m[0].length;
    return Number(m[0]);
  };
  const list = (depth) => {
    const out = [];
    while (at < text.length && text[at] !== ')') {
      if (++count > MAX_NODES) return null;
      if (/\d/.test(text[at])) {
        const v = number();
        if (depth >= MAX_DEPTH || text[at] !== '(' || v < LIMITS.x.min || v > LIMITS.x.max) return null;
        at += 1;
        const body = list(depth + 1);
        if (!body || text[at] !== ')') return null;
        at += 1;
        out.push({ op: 'x', v, body });
      } else {
        const op = text[at++];
        if (op !== 'f' && op !== 'l' && op !== 'r') return null;
        const v = number();
        if (!(v >= LIMITS[op].min && v <= LIMITS[op].max)) return null;
        out.push({ op, v });
      }
    }
    return out;
  };
  const out = list(0);
  return out && at === text.length ? out : null;
}
