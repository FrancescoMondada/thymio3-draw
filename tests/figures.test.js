// The table of figures of the Python mode (FIGS in src/py/drawer_mode.py) is the one of the page (src/spec.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FIGURES } from '../src/spec.js';
import { FIGS } from '../src/sim/drawer-mode.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the Python mode, the JavaScript twin and the page hold the same sixteen figures', () => {
  const res = spawnSync('python3', ['-I', path.join(here, 'test_drawer_mode.py'), '--figures'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const py = JSON.parse(res.stdout);
  assert.equal(py.length, 16);
  const fromSpec = FIGURES.map((f) => f.steps.map((s) => (s.side ? ['S', s.side[0], s.side[1], s.turn] : ['P', s.pivot[0], s.pivot[1]])));
  assert.deepEqual(py, fromSpec);
  assert.deepEqual(FIGS, fromSpec);
});
