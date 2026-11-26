// node --test tests/program.test.js
// The geometric program of the "Géométrie" tab: edited, checked, turned into the sides and turns the robot draws, written for the QR code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, MAX_DEPTH, MAX_NODES, addNode, setValue, removeNode, moveNode, cleanProgram, countNodes, compileProgram, programFigure, activeKeys, programText, parseProgram,
} from '../src/program.js';
import { CUSTOM_ID, CUSTOM_MAX_STEPS } from '../src/spec.js';
import { figurePath, closure, customMessage, figureFor, totalTurn } from '../src/geometry.js';

const f = (v) => ({ op: 'f', v });
const l = (v) => ({ op: 'l', v });
const r = (v) => ({ op: 'r', v });
const x = (v, ...body) => ({ op: 'x', v, body });
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const plain = (steps) => steps.map((s) => [s.len, s.turn]);
// programs a pupil may write, used as examples here
const SHAPES = {
  square: [x(4, f(40), l(90))],
  triangle: [x(3, f(50), l(120))],
  star: [x(5, f(60), r(144))],
  stairs: [x(4, f(20), l(90), f(20), r(90))],
  rosette: [x(8, x(4, f(30), l(90)), l(45))],
};

test('a program is edited by the paths of its instructions, without changing the one before', () => {
  const a = [];
  const b = addNode(a, [], 'x');
  const c = addNode(b, [0], 'f');
  const d = addNode(c, [0], 'l');
  assert.deepEqual(d, [x(4, f(40), l(90))]);
  assert.deepEqual(a, []);
  assert.deepEqual(b, [x(4)]);
  assert.deepEqual(setValue(d, [0], 6), [x(6, f(40), l(90))]);
  assert.deepEqual(setValue(d, [0, 0], 9999), [x(4, f(LIMITS.f.max), l(90))], 'kept in its range');
  assert.deepEqual(setValue(d, [0, 1], -3), [x(4, f(40), l(LIMITS.l.min))]);
  assert.deepEqual(moveNode(d, [0, 1], -1), [x(4, l(90), f(40))]);
  assert.deepEqual(moveNode(d, [0, 0], -1), d, 'the first cannot go higher');
  assert.deepEqual(removeNode(d, [0, 0]), [x(4, l(90))]);
  assert.deepEqual(removeNode(d, [0]), []);
});

test('loops go three deep and the program has forty instructions at most', () => {
  let p = [];
  p = addNode(p, [], 'x');
  p = addNode(p, [0], 'x');
  p = addNode(p, [0, 0], 'x');
  assert.equal(countNodes(p), MAX_DEPTH);
  assert.equal(addNode(p, [0, 0, 0], 'x'), p, 'no loop in the third loop');
  assert.equal(countNodes(addNode(p, [0, 0, 0], 'f')), 4);
  let long = [];
  for (let i = 0; i < MAX_NODES + 5; i++) long = addNode(long, [], 'f');
  assert.equal(countNodes(long), MAX_NODES);
});

test('what comes from outside is made a program: known instructions, numbers in range, the limits', () => {
  assert.deepEqual(cleanProgram(null), []);
  assert.deepEqual(cleanProgram([{ op: 'q', v: 3 }, f(1000), { op: 'l' }, { op: 'x', v: 0, body: [r('20')] }]), [f(300), l(90), x(1, r(20))]);
  assert.deepEqual(cleanProgram([x(2, x(2, x(2, x(2, f(10)))))]), [x(2, x(2, x(2)))]);
  assert.equal(countNodes(cleanProgram(Array.from({ length: 100 }, () => f(10)))), MAX_NODES);
});

test('forward moves with no turn between are one side; the turns that follow each other are one turn', () => {
  assert.deepEqual(plain(compileProgram([f(20), f(30), l(90), l(45), r(5), f(10)]).steps), [[50, 130], [10, 0]]);
  assert.deepEqual(plain(compileProgram([l(90), f(10)]).steps), [[0, 90], [10, 0]], 'a turn first is a turn on the spot');
  assert.deepEqual(plain(compileProgram([f(10), l(90), r(90), f(10)]).steps), [[10, 0], [10, 0]], 'turns that undo each other: two sides, no turn between');
  assert.deepEqual(plain(compileProgram([f(10), l(360), l(360), l(30)]).steps), [[10, 30]], 'more than a whole turn draws the same');
  assert.deepEqual(plain(compileProgram([f(10), r(200), r(200)]).steps), [[10, -40]]);
});

test('a loop around everything is counted by the robot: its body, that many times', () => {
  const sq = compileProgram([x(4, f(40), l(90))]);
  assert.equal(sq.repeat, 4);
  assert.deepEqual(plain(sq.steps), [[40, 90]]);
  const many = compileProgram([x(36, f(10), l(10))]);
  assert.equal(many.error, '');
  assert.equal(many.repeat, 36);
  assert.equal(many.steps.length, 1, 'thirty-six sides, told as one');
  const rose = compileProgram(SHAPES.rosette);
  assert.equal(rose.repeat, 8);
  assert.deepEqual(plain(rose.steps), [[30, 90], [30, 90], [30, 90], [30, 135]], 'the turn of the square and the turn of the rosette are one');
});

test('any other program is written out in full, once; too long, empty or drawing nothing is said', () => {
  const two = compileProgram([x(3, f(20), l(120)), f(50), x(2, r(90), f(10))]);
  assert.equal(two.repeat, 1);
  assert.deepEqual(plain(two.steps), [[20, 120], [20, 120], [20, 120], [50, -90], [10, -90], [10, 0]]);
  assert.equal(compileProgram([]).error, 'empty');
  assert.equal(compileProgram([l(90)]).error, 'nothing');
  assert.equal(compileProgram([x(4, l(90))]).error, 'nothing');
  assert.equal(compileProgram([x(4)]).error, 'nothing');
  assert.equal(compileProgram([x(CUSTOM_MAX_STEPS, f(10), l(10)), f(5)]).error, 'long');
  assert.equal(compileProgram([x(2, x(CUSTOM_MAX_STEPS + 1, f(10), l(10)))]).error, 'long', 'a body that is too long for the robot');
  assert.equal(compileProgram([x(CUSTOM_MAX_STEPS - 1, f(10), l(10)), f(5)]).steps.length, CUSTOM_MAX_STEPS);
  assert.deepEqual(compileProgram([x(CUSTOM_MAX_STEPS, f(10), l(10)), f(5)]).steps, [], 'nothing is drawn from a program that does not fit');
  const t0 = Date.now();
  assert.equal(compileProgram([x(50, x(50, x(50, l(1)))), f(5)]).error, '', 'a hundred thousand turns are one turn');
  assert.ok(Date.now() - t0 < 1000);
});

test('the figure of a program is the page\'s own figure for the robot, and draws the shapes it says', () => {
  const sq = programFigure(SHAPES.square);
  assert.equal(sq.id, CUSTOM_ID);
  assert.equal(sq.program, true);
  assert.equal(sq.repeat, 4);
  assert.ok(closure(sq).closes);
  assert.equal(totalTurn(sq), 360);
  const star = programFigure(SHAPES.star);
  assert.ok(closure(star).closes, JSON.stringify(closure(star)));
  assert.equal(totalTurn(star), -720);
  for (const [name, program] of Object.entries(SHAPES)) {
    const fig = programFigure(program);
    assert.equal(fig.error, '', name);
    assert.ok(fig.steps.length <= CUSTOM_MAX_STEPS, name);
    assert.deepEqual(cleanProgram(program), program, `${name} is within the limits`);
  }
  assert.ok(closure(programFigure(SHAPES.rosette)).closes);
  const p = figurePath(programFigure([f(40), l(90), f(20)])).points;
  near(p.at(-1)[0], -20, 1e-9);
  near(p.at(-1)[1], 40, 1e-9);
});

test('what the robot is told is the same as for a form of points', () => {
  const fig = programFigure([x(4, f(40), l(90))]);
  const told = customMessage(fig.steps, 0.2778, 0);
  assert.deepEqual(told.map((m) => m.turn), [90]);
  assert.ok(told[0].units > 0);
  assert.deepEqual(figureFor({ sel: 16, mine: 'program', program: [x(4, f(40), l(90))], custom: [[0, 10]], repeat: 7, endAngle: 5 }).steps, fig.steps);
  assert.equal(figureFor({ sel: 16, mine: 'points', program: [f(40)], custom: [[0, 10]], repeat: 7, endAngle: 5 }).repeat, 7);
  assert.equal(figureFor({ sel: 3, mine: 'program', program: [f(40)], custom: [], repeat: 1, endAngle: 0 }).id, 3);
});

test('the instructions the robot is on, in a side and in a turn', () => {
  const fig = programFigure([x(2, f(20), f(5), l(90), r(10)), l(5)]);
  assert.deepEqual(activeKeys(fig, 0, 's'), ['0.0', '0.1']);
  assert.deepEqual(activeKeys(fig, 0, 't'), ['0.2', '0.3']);
  assert.deepEqual(activeKeys(fig, 1, 't'), ['0.2', '0.3', '1']);
  assert.deepEqual(activeKeys(programFigure([l(30), f(10)]), 0, 's'), ['0'], 'a turn on the spot is a turn');
  assert.deepEqual(activeKeys(fig, 9, 's'), []);
});

test('a program is written as a short text and read back strictly', () => {
  for (const program of [...Object.values(SHAPES), [], [f(300), x(50, x(1, x(2)), r(1))]]) assert.deepEqual(parseProgram(programText(program)), program);
  assert.equal(programText(SHAPES.rosette), '8(4(f30l90)l45)');
  for (const bad of ['f', 'f0', 'f301', 'l361', 'q10', '4(f10', 'f10)', '4f10', '0(f10)', '51(f10)', '2(2(2(2(f10))))', 'f10 l90', 'f1000', 'f10'.repeat(MAX_NODES + 1), '(f10)', null, 7]) assert.equal(parseProgram(bad), null, String(bad));
});
