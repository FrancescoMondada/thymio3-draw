import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LineAssembler, parseRobotLine, encodeMessage, FrameReceiver, frameSum, isFrame, itemsFor, liveActuator, liveNibbles, selectItem, commandItem, CMD, KEY, MAX_ITEMS,
} from '../src/protocol.js';
import { buildModuleFrom, minify, moduleNameFor, hash32 } from '../src/script-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('stdout lines are rebuilt from notification chunks', () => {
  const asm = new LineAssembler();
  assert.deepEqual(asm.push('@@hel'), []);
  assert.deepEqual(asm.push('lo 1\n@@sel 4\r\n@@en'), ['@@hello 1', '@@sel 4']);
  assert.deepEqual(asm.push('d 4\n'), ['@@end 4']);
  assert.deepEqual(new LineAssembler().push('@@a 1' + ' '.repeat(95) + '\x1e@@b 2' + ' '.repeat(95) + '\x1e'), ['@@a 1' + ' '.repeat(95), '@@b 2' + ' '.repeat(95)], 'padded lines end with a record separator');
  assert.deepEqual(new LineAssembler().push('Traceback (most recent call last):\r\n  File "x", line 3\r\nKeyboardInterrupt: \r\n'), ['Traceback (most recent call last):', '  File "x", line 3', 'KeyboardInterrupt: ']);
});

test('the words of the mode', () => {
  assert.deepEqual(parseRobotLine('@@hello 1'), { type: 'hello', version: 1 });
  assert.deepEqual(parseRobotLine('@@cal 9000000 9360000 16384'), { type: 'cal', fw: 9000000, bw: 9360000, rot90: 16384 });
  assert.equal(parseRobotLine('@@cal 0 0 0'), null);
  assert.deepEqual(parseRobotLine('@@bat 4012'), { type: 'battery', volts: 4.012 });
  assert.deepEqual(parseRobotLine('@@sel 12'), { type: 'sel', figure: 12 });
  assert.deepEqual(parseRobotLine('@@sel 16'), { type: 'sel', figure: 16 }, 'the page\'s own form');
  assert.equal(parseRobotLine('@@sel 17'), null);
  assert.deepEqual(parseRobotLine('@@size 150'), { type: 'size', size: 150 });
  assert.equal(parseRobotLine('@@size 20'), null);
  assert.equal(parseRobotLine('@@size 400'), null);
  assert.equal(parseRobotLine('@@sel x'), null);
  assert.deepEqual(parseRobotLine('@@draw 3'), { type: 'draw', figure: 3 });
  assert.deepEqual(parseRobotLine('@@seg 2 t'), { type: 'seg', step: 2, phase: 't' });
  assert.equal(parseRobotLine('@@seg 2 x'), null);
  assert.deepEqual(parseRobotLine('@@end 3'), { type: 'end', figure: 3 });
  assert.deepEqual(parseRobotLine('@@stop'), { type: 'stop' });
  assert.deepEqual(parseRobotLine('@@rep 2'), { type: 'rep', rep: 2 });
  assert.equal(parseRobotLine('@@rep x'), null);
  assert.deepEqual(parseRobotLine('@@state blink'), { type: 'state', state: 'blink' });
  assert.equal(parseRobotLine('@@state asleep'), null);
  assert.deepEqual(parseRobotLine('@@ack 7'), { type: 'ack', msg: 7 });
  assert.equal(parseRobotLine('@@exit').type, 'exit');
  assert.equal(parseRobotLine('@@bye').type, 'bye');
  assert.equal(parseRobotLine('hello world'), null);
  assert.equal(parseRobotLine('@@nonsense 1'), null);
  assert.equal(parseRobotLine('ValueError: Target angle must be between -32768 and 32767').type, 'error');
});

test('the progress line', () => {
  assert.deepEqual(parseRobotLine('@@n 1200 1 3 2 -905 140 140 r 12 1900'), {
    type: 'n', ms: 1200, state: 'draw', figure: 3, step: 2, angle: -90.5, left: 140, right: 140, colour: 'r', rear: [12, 1900], dist: null,
  });
  assert.equal(parseRobotLine('@@n 1200 1 3 2 -905 140 140 r 12 1900 56000').dist, 56000, 'the distance driven, when the mode says it');
  assert.equal(parseRobotLine('@@n 1200 1 3 2 -905 140 140 r 12 1900 x').dist, null);
  assert.equal(parseRobotLine('@@n 0 0 0 0 0 0 0 ? 0 0').colour, '?');
  assert.equal(parseRobotLine('@@n 0 0 0 0 0 0 0 z 0 0').colour, '?', 'a colour that is none of the eight');
  assert.equal(parseRobotLine('@@n 0 2 0 0 0 0 0 k 0 0').state, 'blink');
  assert.equal(parseRobotLine('@@n 1 2 3'), null, 'too short');
  assert.equal(parseRobotLine('@@n a b c d e f g h i j'), null);
});

test('messages: frames go back to the same items, whatever the number of frames', () => {
  for (const items of [[selectItem(5)], [selectItem(15), commandItem(CMD.START)], [selectItem(0), commandItem(CMD.STOP), commandItem(CMD.QUIT), commandItem(CMD.REPORT)],
    Array.from({ length: MAX_ITEMS }, (_, i) => [i & 1, i])]) {
    const frames = encodeMessage(items, 9);
    assert.ok(frames.every((f) => f.length === 12 && f.every((v) => v >= 0 && v <= 15)));
    assert.ok(frames.every(isFrame));
    assert.ok(frames.every((f) => f[1] === 15), 'the mark');
    const rx = new FrameReceiver();
    let got = null;
    for (const f of frames) got = rx.push(f) || got;
    assert.deepEqual(got, { msg: 9, items });
  }
  assert.equal(encodeMessage(Array.from({ length: MAX_ITEMS + 1 }, () => [0, 0])), null);
});

test('a frame with a bad sum or no mark is not a frame; frames can come in any order', () => {
  const [a, b, c] = encodeMessage([[0, 1], [1, 2], [0, 3], [1, 4]], 3);
  const bad = [...a];
  bad[4] = (bad[4] + 1) & 15;
  const rx = new FrameReceiver();
  assert.equal(rx.push(bad), null);
  assert.equal(rx.push(Object.assign([...a], { 1: 3 })), null);
  assert.equal(rx.push(c), null, 'the last frame alone is not the message');
  assert.equal(rx.push(a), null);
  assert.deepEqual(rx.push(b)?.items.length, 4);
  assert.equal(frameSum(a), a[11]);
});

test('the figure is clamped to 0..16 and a command is a command', () => {
  assert.deepEqual(selectItem(99), [KEY.SELECT, 16]);
  assert.deepEqual(selectItem(15), [KEY.SELECT, 15]);
  assert.deepEqual(selectItem(-4), [KEY.SELECT, 0]);
  assert.deepEqual(selectItem(7.9), [KEY.SELECT, 7]);
  assert.deepEqual(itemsFor({ select: 4, command: CMD.START }), [[[0, 4], [1, 1]]]);
  assert.deepEqual(itemsFor({ command: CMD.STOP }), [[[1, 2]]]);
  assert.deepEqual(itemsFor({}), []);
  assert.deepEqual(itemsFor({ custom: [{ units: 5, turn: 90 }], repeat: 3, command: CMD.START }), [[[3, 0], [4, 5], [5, 90], [6, 3]], [[1, 1]]], 'the form and how many times, then go in a message of its own');
  assert.deepEqual(itemsFor({ custom: [{ units: 5, turn: 90 }], repeat: 3 }), [[[3, 0], [4, 5], [5, 90], [6, 3]]], 'a form without a start has no message for it');
  assert.deepEqual(itemsFor({ repeat: 999 }), [[[6, 50]]]);
});

test('the Bluetooth command carries the frame in the body LEDs and the last speeds of the wheels', () => {
  const frame = encodeMessage([selectItem(3)], 2)[0];
  const a = liveActuator(frame, { motors: [140.4, -139.6] });
  assert.deepEqual(liveNibbles(a), frame);
  assert.equal(a.motorLeft, 140);
  assert.equal(a.motorRight, -140);
  assert.equal(a.circleLEDs.length, 8);
});

test('the module for the robot is the source without what the interpreter ignores', () => {
  const source = fs.readFileSync(path.join(here, '..', 'src', 'py', 'drawer_mode.py'), 'utf8');
  const mod = buildModuleFrom(source);
  assert.ok(mod.length < source.length * 0.75);
  assert.ok(mod.length < 17000, `${mod.length} bytes`);
  assert.ok(!/^\s*#/m.test(mod));
  assert.match(moduleNameFor(mod), /^draw_[0-9a-f]{8}$/);
  assert.ok(moduleNameFor(mod).length + 3 <= 30, 'a file name of the robot is at most 30 bytes');
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('a'), hash32('b'));
  assert.ok(minify('a = 1  # one\nb = "#"  # two\n\n# c\n').startsWith('a = 1\nb = "#"  # two\n'));
  assert.equal(minify('if x:\n    if y:\n        z = 1\n'), 'if x:\n if y:\n  z = 1\n');
});
