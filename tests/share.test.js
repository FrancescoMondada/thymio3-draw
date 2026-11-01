import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFIX, MAX_TEXT, POINT_MAX, APP_URL, APP_LINKS, encodeConfig, decodeConfig, applyConfig } from '../src/share.js';
import { Telemetry, MAX_POINTS } from '../src/store.js';
import { figureOf } from '../src/geometry.js';

const HOUSE = [[0, 50], [25, 75], [50, 50], [50, 0], [0, 0]];
const FULL = { lang: 'fr', figure: 16, size: 100, repeat: 4, endAngle: 0, custom: HOUSE };

test('the configuration is one short line: the format, then letter=value fields', () => {
  assert.equal(encodeConfig(FULL), 'T3D1;l=fr;f=16;z=100;r=4;e=0;c=0:50,25:75,50:50,50:0,0:0');
  assert.equal(PREFIX, 'T3D1');
  assert.equal(encodeConfig({ lang: 'en' }), 'T3D1;l=en');
  assert.equal(encodeConfig({}), 'T3D1');
  assert.equal(encodeConfig({ lang: 'xx', figure: 3 }), 'T3D1;f=3', 'a language that is not offered is left out');
});

test('what is written is read back, whole', () => {
  assert.deepEqual(decodeConfig(encodeConfig(FULL)), FULL);
  const other = { lang: 'de', figure: 4, size: 250, repeat: 1, endAngle: -72, custom: [[-12, 30], [-40, -35]] };
  assert.deepEqual(decodeConfig(encodeConfig(other)), other);
  assert.deepEqual(decodeConfig('T3D1;f=8;z=300'), { figure: 8, size: 300 }, 'a field that is missing leaves that part alone');
  assert.deepEqual(decodeConfig('T3D1;z=50;f=2'), { size: 50, figure: 2 }, 'the order does not matter');
});

test('numbers are brought back into their range and made whole when written', () => {
  assert.equal(encodeConfig({ figure: 99, size: 9999, repeat: 0, endAngle: 500 }), 'T3D1;f=16;z=300;r=1;e=180');
  assert.equal(encodeConfig({ size: 5, endAngle: -500 }), 'T3D1;z=40;e=-180');
  assert.equal(encodeConfig({ custom: [[12.6, -0.4], [9000, -9000]] }), `T3D1;c=13:0,${POINT_MAX}:${-POINT_MAX}`);
  assert.equal(encodeConfig({ custom: [] }), 'T3D1;c=', 'a form with no point is said');
  assert.equal(encodeConfig({ custom: Array.from({ length: 40 }, () => [1, 1]) }).split(',').length, MAX_POINTS, 'at most as many points as the page holds');
});

test('what is read is data, read strictly: a field that is not valid is dropped, the others are kept', () => {
  assert.deepEqual(decodeConfig('T3D1;f=17;z=300'), { size: 300 });
  assert.deepEqual(decodeConfig('T3D1;z=20;r=1'), { repeat: 1 });
  assert.deepEqual(decodeConfig('T3D1;z=301;f=3'), { figure: 3 });
  assert.deepEqual(decodeConfig('T3D1;r=0;e=180'), { endAngle: 180 });
  assert.deepEqual(decodeConfig('T3D1;r=51;e=181;f=1'), { figure: 1 });
  assert.deepEqual(decodeConfig('T3D1;f=1.5;z=abc;r=;e=--3;l=xx'), null);
  assert.deepEqual(decodeConfig('T3D1;c=1:2:3,4:5;f=2'), { figure: 2 }, 'a point must be x:y');
  assert.deepEqual(decodeConfig('T3D1;c=1:2,x:5;f=2'), { figure: 2 });
  assert.deepEqual(decodeConfig('T3D1;c=1:2,601:5;f=2'), { figure: 2 }, 'a point further than the sheet');
  assert.deepEqual(decodeConfig(`T3D1;c=${Array.from({ length: MAX_POINTS + 1 }, () => '1:1').join(',')};f=2`), { figure: 2 }, 'too many points: the whole form is dropped');
  assert.deepEqual(decodeConfig('T3D1;c=;f=2'), { custom: [], figure: 2 });
  assert.deepEqual(decodeConfig('T3D1;q=1;f=2;zz=4'), { figure: 2 }, 'a field of a later version is ignored');
  assert.deepEqual(decodeConfig('  T3D1;f=2  '), { figure: 2 });
});

test('a text that is not one of ours is not read, whatever it says', () => {
  for (const text of ['T3C1;l=fr', 'T3L1;s=30;l=fr', 't3d1;f=3', 'hello', 'T3D2;f=3', ';f=3', '', null, undefined, 42, {}, 'T3D1']) assert.equal(decodeConfig(text), null, String(text));
  assert.equal(decodeConfig(`T3D1;f=3;${'x'.repeat(MAX_TEXT)}`), null, 'too long');
  assert.deepEqual(decodeConfig('T3D1;f=3;<script>alert(1)</script>=1'), { figure: 3 }, 'text that is not a field is ignored, never run');
});

test('the biggest configuration fits the limit by a wide margin', () => {
  const widest = encodeConfig({ lang: 'en', figure: 16, size: 300, repeat: 50, endAngle: -180, custom: Array.from({ length: MAX_POINTS }, () => [-600, -600]) });
  assert.ok(widest.length < MAX_TEXT, `${widest.length} characters`);
  assert.deepEqual(decodeConfig(widest).custom.length, MAX_POINTS);
});

test('a configuration read is set up in the page: the form, the times, the end angle, the size, the figure, and the robot is told', () => {
  const t = new Telemetry(3);
  const change = applyConfig(t, decodeConfig(encodeConfig({ ...FULL, size: 160, endAngle: 36 })));
  assert.equal(t.s.sel, 16);
  assert.equal(t.s.size, 160);
  assert.equal(t.s.repeat, 4);
  assert.equal(t.s.endAngle, 36);
  assert.deepEqual(t.s.custom, HOUSE);
  assert.deepEqual(change, { select: 16, size: 160 });
  const fig = figureOf(16, t.s.custom, t.s.repeat, t.s.endAngle);
  assert.equal(fig.steps.at(-1).turn, 36);
  assert.equal(t.s.autoPlace, true, 'the figure is in the middle of the sheet, the robot at its start');
  // a code that holds only a size changes only that
  const only = applyConfig(t, decodeConfig('T3D1;z=80'));
  assert.deepEqual(only, { size: 80 });
  assert.equal(t.s.sel, 16);
  assert.equal(t.s.size, 80);
  assert.deepEqual(t.s.custom, HOUSE);
  // a form that is empty empties the form
  applyConfig(t, decodeConfig('T3D1;c='));
  assert.deepEqual(t.s.custom, []);
});

test('nothing is set up while the robot draws, or from something that is not a configuration', () => {
  const t = new Telemetry(3);
  t.push({ type: 'state', state: 'draw', t: 1 });
  assert.equal(applyConfig(t, decodeConfig('T3D1;f=8;z=200')), null);
  assert.equal(t.s.sel, 3);
  assert.equal(applyConfig(new Telemetry(3), null), null);
});

test('the links to the application: the plain address, and the one that opens Bluefy on an iPad', () => {
  assert.equal(APP_LINKS.web, APP_URL);
  assert.match(APP_URL, /^https:\/\/.+\/$/);
  assert.equal(APP_LINKS.ios, `bluefy://open?url=${encodeURIComponent(APP_URL)}`);
  assert.equal(decodeURIComponent(APP_LINKS.ios.split('url=')[1]), APP_URL, 'the address is in it, whole');
  assert.deepEqual(Object.keys(APP_LINKS).sort(), ['ios', 'web'], 'two codes: no intent:// one for Chrome, a Samsung camera does not open it');
  for (const link of Object.values(APP_LINKS)) assert.ok(!/^intent:/.test(link), link);
  for (const link of Object.values(APP_LINKS)) assert.equal(decodeConfig(link), null, 'a link is not a configuration');
});

test('the setting "show the pseudonym" travels in the code, the pseudonym does not', () => {
  assert.equal(encodeConfig({ lang: 'fr', showName: true, figure: 3 }), 'T3D1;l=fr;p=1;f=3');
  assert.equal(encodeConfig({ showName: false }), 'T3D1;p=0');
  assert.equal(encodeConfig({ figure: 3 }), 'T3D1;f=3', 'a page that does not say it leaves it out');
  assert.deepEqual(decodeConfig('T3D1;p=1;f=3'), { showName: true, figure: 3 });
  assert.deepEqual(decodeConfig('T3D1;p=0'), { showName: false });
  for (const bad of ['p=2', 'p=', 'p=yes', 'p=-1', 'p=true']) assert.equal(decodeConfig(`T3D1;${bad}`), null, bad);
  assert.deepEqual(decodeConfig('T3D1;p=2;f=3'), { figure: 3 }, 'a value that is not 0 or 1 is dropped, the rest is kept');
  const both = { ...FULL, showName: true };
  assert.deepEqual(decodeConfig(encodeConfig(both)), both);
  assert.ok(!/name|pseudo/i.test(encodeConfig({ ...both, name: 'NeonFalcon42' })), 'the pseudonym is not written in the code');
});
