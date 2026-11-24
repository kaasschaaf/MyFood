import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cuisineFor, cuisineWords } from '../js/cuisine.js';

test('a cuisine is detected from the title', () => {
  assert.equal(cuisineFor({ title: 'Creamy Spinach Lasagne' }), 'Italian');
  assert.equal(cuisineFor({ title: 'Chicken Tikka Masala', ingredientNames: ['garam masala', 'yoghurt'] }), 'Indian');
  assert.equal(cuisineFor({ title: 'Beef Tacos', ingredientNames: ['tortilla', 'salsa'] }), 'Mexican');
  assert.equal(cuisineFor({ title: 'Thai Green Curry', ingredientNames: ['kokosmelk', 'vissaus'] }), 'Thai');
});

test('ingredients alone can place a dish', () => {
  assert.equal(cuisineFor({ title: 'Weeknight dinner', ingredientNames: ['feta', 'tzatziki', 'olijven'] }), 'Greek');
  assert.equal(cuisineFor({ title: 'Weeknight dinner', ingredientNames: ['miso', 'nori', 'sake'] }), 'Japanese');
});

test('a dish without a clear origin stays international', () => {
  assert.equal(cuisineFor({ title: 'Kip met rijst en groenten' }), 'International');
  assert.equal(cuisineFor({ title: '' }), 'International');
  assert.equal(cuisineFor({}), 'International');
  // "curry" on its own is too weak to claim Indian.
  assert.equal(cuisineFor({ title: 'Curry' }), 'International');
});

test('the detected name is canonical, matching the app filter values', () => {
  const names = new Set(Object.keys(cuisineWords()));
  for (const name of ['Italian', 'Mexican', 'Chinese', 'Indian', 'Greek', 'Thai', 'French']) {
    assert.ok(names.has(name), `${name} must be a usable cuisine`);
  }
  // Never a Dutch word: the app maps canonical names to labels itself.
  assert.deepEqual([...names].filter(name => /aans$|iaans$|eens$/.test(name)), []);
});

test('detection is deterministic', () => {
  const input = { title: 'Spicy Szechuan Noodles', ingredientNames: ['soy sauce', 'sesame'] };
  assert.equal(cuisineFor(input), cuisineFor(input));
});
