import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrPath, readQr } from '../src/qr.js';
import { encodeConfig, APP_LINKS } from '../src/share.js';
import { MAX_POINTS } from '../src/store.js';

// The matrix as the image a camera would see: dark modules black on white, a quiet zone of 4 modules, `k` pixels a module
function picture(code, k = 6, quiet = 4) {
  const side = (code.size + 2 * quiet) * k;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) {
      if (!code.dark(r, c)) continue;
      for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
        const i = (((r + quiet) * k + y) * side + (c + quiet) * k + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: side, height: side };
}

const house = encodeConfig({ lang: 'fr', figure: 16, size: 100, repeat: 4, endAngle: 0, custom: [[0, 50], [25, 75], [50, 50], [50, 0], [0, 0]] });
const biggest = encodeConfig({ lang: 'en', figure: 16, size: 300, repeat: 50, endAngle: -180, custom: Array.from({ length: MAX_POINTS }, (_, i) => [-(500 + i), -(400 + i)]) });

test('a code is read back as the text it was made for', async () => {
  for (const text of [house, biggest, 'T3D1;f=3', encodeConfig({ figure: 3, size: 100 })]) {
    const code = qrMatrix(text);
    assert.ok(code, text);
    assert.equal(await readQr(picture(code)), text);
  }
});

test('the code of a usual configuration is a small one, easy to scan across a room; the biggest one still is readable', () => {
  assert.ok(qrMatrix(house).size <= 45, `${qrMatrix(house).size} modules a side`);
  assert.ok(qrMatrix(biggest).size <= 77, `${qrMatrix(biggest).size} modules a side`);
});

test('a text that does not fit gives no code, and an image without a code gives no text', async () => {
  assert.equal(qrMatrix('x'.repeat(5000)), null);
  const blank = { data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 };
  assert.equal(await readQr(blank), null);
});

test('the path draws exactly the dark modules', () => {
  const code = qrMatrix('T3D1;f=3');
  const path = qrPath(code);
  let area = 0;
  for (const m of path.matchAll(/h(\d+)v1/g)) area += Number(m[1]);
  let dark = 0;
  for (let r = 0; r < code.size; r++) for (let c = 0; c < code.size; c++) if (code.dark(r, c)) dark++;
  assert.equal(area, dark);
});

test('the links to the application are read back, and are small codes', async () => {
  for (const [kind, link] of Object.entries(APP_LINKS)) {
    const code = qrMatrix(link);
    assert.ok(code, kind);
    assert.equal(await readQr(picture(code)), link, kind);
    assert.ok(code.size <= 41, `${kind}: ${code.size} modules a side`);
  }
});
