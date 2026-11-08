import assert from 'node:assert/strict';
import { test } from 'node:test';

import { translateIngredientToDutch, GLOSSARY_SIZE } from '../js/ingredient-dutch.js';

test('the glossary covers a useful amount of TheMealDB vocabulary', () => {
  // TheMealDB lists ~1000 distinct ingredient names; the glossary is meant to
  // catch the common ones so the on-device model is only a safety net.
  assert.ok(GLOSSARY_SIZE > 400, `expected a large glossary, got ${GLOSSARY_SIZE}`);
});

test('translateIngredientToDutch maps whole phrases to one Dutch product', () => {
  assert.equal(translateIngredientToDutch('Ground Beef').text, 'rundergehakt');
  assert.equal(translateIngredientToDutch('chicken breasts').text, 'kipfilet');
  assert.equal(translateIngredientToDutch('Sirloin steak').text, 'biefstuk');
  assert.equal(translateIngredientToDutch('Chopped Tomatoes').text, 'tomatenblokjes');
  assert.equal(translateIngredientToDutch('Sesame Seed Oil').text, 'sesamolie');
});

test('translateIngredientToDutch ignores preparation words', () => {
  const result = translateIngredientToDutch('1 lb Freshly Ground Black Pepper');
  assert.equal(result.text, 'zwarte peper');
  assert.equal(result.complete, true);
});

test('translateIngredientToDutch only keeps words it understands', () => {
  // "high heat cooking" are qualifiers; the query must stay searchable.
  const result = translateIngredientToDutch('High Heat Cooking Oil');
  assert.equal(result.text, 'olie');
  assert.equal(result.changed, true);
});

test('translateIngredientToDutch normalises hyphens and word order', () => {
  assert.equal(translateIngredientToDutch('Sun-Dried Tomatoes').text, 'gedroogde tomaten');
  assert.equal(translateIngredientToDutch('Sun Dried Tomatoes').text, 'gedroogde tomaten');
});

test('translateIngredientToDutch leaves unknown names untouched', () => {
  const result = translateIngredientToDutch('Xoconostle');
  assert.equal(result.text, 'Xoconostle');
  assert.equal(result.changed, false);
  assert.equal(result.complete, false);
});

test('translateIngredientToDutch survives empty input', () => {
  assert.deepEqual(translateIngredientToDutch(''), { text: '', complete: false, changed: false });
  assert.deepEqual(translateIngredientToDutch(null), { text: '', complete: false, changed: false });
});
