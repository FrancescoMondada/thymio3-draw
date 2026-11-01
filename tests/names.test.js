import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_MAX, NAME_COUNT, NAME_WORDS, composeName, randomParts, randomName, cleanName, formatWhen } from '../src/names.js';

const { prefixes, creatures } = NAME_WORDS;

test('a pseudonym is a word of science or speed, a creature and two digits, glued like an online handle', () => {
  assert.equal(composeName(0, 0, 0), `${prefixes[0]}${creatures[0]}10`);
  for (let i = 0; i < 3000; i++) {
    const n = randomName();
    assert.match(n, /^[A-Z][a-z]+[A-Z][a-z]+[1-9]\d$/, n);
    assert.ok(n.length <= NAME_MAX, n);
  }
});

test('there are tens of thousands of them, from words that are all different', () => {
  assert.equal(NAME_COUNT, prefixes.length * creatures.length * 90);
  assert.ok(NAME_COUNT > 100000);
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.equal(new Set(creatures).size, creatures.length);
  assert.equal(new Set([...prefixes, ...creatures]).size, prefixes.length + creatures.length, 'no word is both');
  for (const w of [...prefixes, ...creatures]) assert.match(w, /^[A-Z][a-z]+$/, w);
});

test('the draw reaches every piece, the first and the last included, and never goes out of the lists', () => {
  assert.deepEqual(randomParts(() => 0), { prefix: 0, creature: 0, number: 0 });
  assert.deepEqual(randomParts(() => 0.999999), { prefix: prefixes.length - 1, creature: creatures.length - 1, number: 89 });
  assert.deepEqual(randomParts(() => 1), { prefix: prefixes.length - 1, creature: creatures.length - 1, number: 89 }, 'even a draw of exactly 1');
  const seenPrefix = new Set(), seenCreature = new Set();
  for (let i = 0; i < 20000; i++) { const p = randomParts(); seenPrefix.add(p.prefix); seenCreature.add(p.creature); }
  assert.equal(seenPrefix.size, prefixes.length);
  assert.equal(seenCreature.size, creatures.length);
});

test('a pseudonym that is typed is kept as text, in one line, at most NAME_MAX characters', () => {
  assert.equal(cleanName('Zoé\n ça\t va'), 'Zoé  ça  va');
  assert.equal(cleanName('x'.repeat(100)).length, NAME_MAX);
  assert.equal(cleanName(null), '');
});

test('the date and the time are one short line in the language of the page', () => {
  const d = new Date('2026-10-29T11:42:00Z');
  for (const lang of ['fr', 'en', 'de', 'it']) {
    const s = formatWhen(d, lang, 'UTC');
    assert.match(s, /2026/, lang);
    assert.match(s, /11:42/, lang);
  }
});
