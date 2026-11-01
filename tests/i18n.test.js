import test from 'node:test';
import assert from 'node:assert/strict';
import { I18N, LANGS, detectLang, fmt } from '../src/i18n.js';
import { FIGURES, GROUND_CODES } from '../src/spec.js';

const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
const words = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('four languages are offered, in this order, each under its own name', () => {
  assert.deepEqual(LANGS.map((l) => l.id), ['it', 'fr', 'de', 'en']);
  assert.deepEqual(LANGS.map((l) => l.label), ['Italiano', 'Français', 'Deutsch', 'English']);
  for (const l of LANGS) assert.ok(I18N[l.id], l.id);
});

test('every language has the same keys and the same {words} to fill in as French', () => {
  const fr = Object.fromEntries(leaves(I18N.fr));
  for (const { id } of LANGS) {
    const dict = Object.fromEntries(leaves(I18N[id]));
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(fr).sort(), `${id}: same keys`);
    for (const [key, text] of Object.entries(dict)) {
      assert.ok(String(text).trim() !== '', `${id}.${key} is empty`);
      assert.equal(words(text), words(fr[key]), `${id}.${key}: {words}`);
    }
  }
});

test('the lists have the same length in every language, and every figure and colour has a name', () => {
  for (const { id } of LANGS) {
    const t = I18N[id];
    assert.equal(t.help.steps.length, I18N.fr.help.steps.length, id);
    assert.equal(t.diag.shortcuts.length, I18N.fr.diag.shortcuts.length, id);
    for (const f of FIGURES) assert.ok(t.figures[f.key], `${id}: figure ${f.key}`);
    for (const c of [...GROUND_CODES, '?']) assert.ok(t.colours[c], `${id}: colour ${c}`);
  }
});

test('the language of the browser is used when it is one of the four, French otherwise', () => {
  const nav = (language) => { Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true }); return detectLang(); };
  assert.equal(nav('it-CH'), 'it');
  assert.equal(nav('de-AT'), 'de');
  assert.equal(nav('en-GB'), 'en');
  assert.equal(nav('fr-FR'), 'fr');
  assert.equal(nav('es-ES'), 'fr');
});

test('fmt fills the words in and leaves unknown ones alone', () => {
  assert.equal(fmt('Côté {k} sur {n}', { k: 2, n: 4 }), 'Côté 2 sur 4');
  assert.equal(fmt('{a} {b}', { a: 1 }), '1 {b}');
});

// A real robot is not perfect (its pen moves a little in its hole): a length that the page gives is "about", and nothing is "exactly".
test('the lengths are given as "about", and nothing is said to be exact, in every language', () => {
  const about = { fr: /environ/i, en: /about/i, it: /circa/i, de: /etwa/i };
  const exact = /exactement|exactly|esattamente|\bgenau\b|précisément|precisely/i;
  for (const l of LANGS) {
    const t = I18N[l.id];
    for (const [key, text] of [['recipe.sideMm', t.recipe.sideMm], ['recipe.diameter', t.recipe.diameter], ['recipe.gap', t.recipe.gap], ['size.figure', t.size.figure], ['custom.total', t.custom.total], ['recipe.time', t.recipe.time]]) {
      assert.match(text, about[l.id], `${l.id} ${key}`);
    }
    assert.match(t.custom.length, /≈/, `${l.id} the lengths on the sheet`);
    assert.ok(t.recipe.precision.length > 40, `${l.id} the note under the recipe`);
    for (const [key, text] of leaves(t)) assert.doesNotMatch(String(text), exact, `${l.id} ${key}`);
  }
  assert.equal(I18N.fr.recipe.closes, 'Il revient au départ.');
});
