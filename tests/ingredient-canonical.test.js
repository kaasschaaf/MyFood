import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalIngredient,
  canonicalIngredientKey,
  canonicalIngredients,
  isUsableIngredientLine,
  parseIngredientLine,
  parseLeadingAmount,
  stripBrackets,
  stripQualifiers
} from '../js/ingredient-canonical.js';

test('"to taste salt" is just salt', () => {
  const salt = canonicalIngredient('To taste salt');
  assert.equal(salt.key, 'zout');
  assert.equal(salt.nameEn, 'salt');
  assert.equal(salt.amount, null);

  // Same line, other word order, same key.
  assert.equal(canonicalIngredient('Salt, to taste').key, 'zout');
  // Dutch source passes through unchanged.
  assert.equal(canonicalIngredient('zout naar smaak').key, 'zout');
});

test('salt and pepper become two ingredients, a dish does not', () => {
  const seasonings = canonicalIngredients('Salt and pepper to taste');
  assert.deepEqual(seasonings.map(item => item.key), ['zout', 'peper']);

  const oils = canonicalIngredients('Olive oil and butter');
  assert.deepEqual(oils.map(item => item.key), ['olijfolie', 'roomboter']);

  // A dish name must stay in one piece.
  const dish = canonicalIngredients('Chicken and rice casserole');
  assert.equal(dish.length, 1);
  // An amount applies to the whole line.
  assert.equal(canonicalIngredients('2 tbsp olive oil and lemon').length, 1);
});

test('quantities cover fractions, mixed numbers, decimals and ranges', () => {
  assert.equal(parseLeadingAmount('1/2 cup milk').amount, 0.5);
  assert.equal(parseLeadingAmount('1 1/2 cups milk').amount, 1.5);
  assert.equal(parseLeadingAmount('3/4 tsp salt').amount, 0.75);
  assert.equal(parseLeadingAmount('1,5 kg potatoes').amount, 1.5);
  assert.equal(parseLeadingAmount('2-3 cloves garlic').amount, 2.5);
  assert.equal(parseLeadingAmount('2 to 3 cloves garlic').amount, 2.5);
  assert.equal(parseLeadingAmount('to taste salt').amount, null);
});

test('units are separated from the name', () => {
  assert.deepEqual(parseIngredientLine('500 g ground beef'), { amount: 500, unit: 'g', name: 'ground beef' });
  assert.deepEqual(parseIngredientLine('2 tbsp olive oil'), { amount: 2, unit: 'tbsp', name: 'olive oil' });
  assert.equal(parseIngredientLine('2 tenen knoflook').unit, 'tenen');
  assert.equal(parseIngredientLine('2 tenen knoflook').name, 'knoflook');
  assert.equal(parseIngredientLine('1 (14 oz) can chopped tomatoes').unit, 'can');
});

test('brackets and qualifiers are dropped', () => {
  assert.equal(stripBrackets('1 1/2 cups (180 g) flour'), '1 1/2 cups flour');
  assert.equal(stripBrackets('tomatoes [drained] {optional}'), 'tomatoes');
  assert.equal(stripQualifiers('olive oil, plus more for drizzling'), 'olive oil');
  assert.equal(stripQualifiers('parsley for garnish'), 'parsley');
  assert.equal(stripQualifiers('chicken, finely chopped'), 'chicken');
});

test('a full messy line canonicalises to a Dutch key', () => {
  const flour = canonicalIngredient('1 1/2 cups (180 g) all-purpose flour, divided');
  assert.equal(flour.key, 'bloem');
  assert.equal(flour.amount, 1.5);
  assert.equal(flour.unit, 'cups');

  const beef = canonicalIngredient('500 g ground beef');
  assert.equal(beef.key, 'rundergehakt');

  const eggs = canonicalIngredient('2 large free-range eggs');
  assert.equal(eggs.key, 'eieren');
  assert.equal(eggs.amount, 2);

  const onion = canonicalIngredient('1 ui, gesnipperd');
  assert.equal(onion.key, 'ui');
  assert.equal(onion.amount, 1);
});

test('unknown names still produce a stable key', () => {
  const weird = canonicalIngredient('200 g xoconostle');
  assert.equal(weird.key, 'xoconostle');
  assert.equal(weird.amount, 200);
  assert.equal(canonicalIngredientKey('Xoconostle'), 'xoconostle');
});

test('isUsableIngredientLine rejects empty or meaningless lines', () => {
  assert.equal(isUsableIngredientLine('To taste salt'), true);
  assert.equal(isUsableIngredientLine('500 g ground beef'), true);
  assert.equal(isUsableIngredientLine(''), false);
  assert.equal(isUsableIngredientLine('   '), false);
  assert.equal(isUsableIngredientLine('a'), false);
});

test('the same ingredient written differently gets one key', () => {
  const variants = [
    '2 tbsp olive oil',
    'Olive Oil',
    '1/4 cup extra virgin olive oil',
    'olive oil, plus more for drizzling'
  ];
  const keys = new Set(variants.map(line => canonicalIngredient(line).key));
  assert.deepEqual([...keys], ['olijfolie']);
});
