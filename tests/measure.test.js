import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatAmount,
  formatQuantity,
  isMetricUnit,
  normalizeUnit,
  roundAmount,
  toMetric,
  unitLabel
} from '../js/measure.js';

test('units are normalised before lookup', () => {
  assert.equal(normalizeUnit('  Fl. Oz. '), 'fl oz');
  assert.equal(isMetricUnit('g'), true);
  assert.equal(isMetricUnit('ML'), true);
  assert.equal(isMetricUnit('cup'), false);
});

test('grams stay grams and pounds become grams', () => {
  assert.deepEqual(toMetric(250, 'g'), { amount: 250, unit: 'g' });
  assert.deepEqual(toMetric(76, 'grams'), { amount: 76, unit: 'g' });
  assert.deepEqual(toMetric(1, 'lb'), { amount: 454, unit: 'g' });
  assert.deepEqual(toMetric('4', 'oz'), { amount: 113, unit: 'g' });
});

test('a thousand grams becomes one kilo', () => {
  assert.deepEqual(toMetric(2, 'kg'), { amount: 2, unit: 'kg' });
  assert.deepEqual(toMetric(1500, 'g'), { amount: 1.5, unit: 'kg' });
});

test('cups and spoons become millilitres and litres', () => {
  assert.deepEqual(toMetric(1, 'cup'), { amount: 240, unit: 'ml' });
  assert.deepEqual(toMetric(0.5, 'cups'), { amount: 120, unit: 'ml' });
  assert.deepEqual(toMetric(2, 'tbsp'), { amount: 30, unit: 'ml' });
  assert.deepEqual(toMetric(1, 'teaspoon'), { amount: 5, unit: 'ml' });
  assert.deepEqual(toMetric(1, 'tl'), { amount: 5, unit: 'ml' });
  assert.deepEqual(toMetric(5, 'cups'), { amount: 1.2, unit: 'l' });
});

test('counted units keep their number and get a canonical name', () => {
  assert.deepEqual(toMetric(2, 'cloves'), { amount: 2, unit: 'clove' });
  assert.deepEqual(toMetric(1, 'blikje'), { amount: 1, unit: 'can' });
  assert.deepEqual(toMetric(3, 'slices'), { amount: 3, unit: 'slice' });
  assert.deepEqual(toMetric(1, 'bunch'), { amount: 1, unit: 'bunch' });
  // Half a can is one can: "0,5 blikje" reads worse than "1 blikje".
  assert.deepEqual(toMetric(0.4, 'cans'), { amount: 1, unit: 'can' });
});

test('an unknown unit is dropped instead of displayed', () => {
  assert.deepEqual(toMetric(2, 'large'), { amount: 2, unit: '' });
});

test('a counted word without a number stays a word', () => {
  assert.deepEqual(toMetric(null, 'pinch'), { amount: null, unit: 'pinch' });
  assert.deepEqual(toMetric(null, 'cup'), { amount: null, unit: '' });
});

test('unit labels are localised', () => {
  assert.equal(unitLabel('clove', 2, 'nl'), 'teentjes');
  assert.equal(unitLabel('clove', 1, 'nl'), 'teentje');
  assert.equal(unitLabel('clove', 2, 'en'), 'cloves');
  assert.equal(unitLabel('can', 3, 'nl'), 'blikjes');
  assert.equal(unitLabel('g', 250, 'nl'), 'g');
  assert.equal(unitLabel('kg', 2, 'en'), 'kg');
});

test('amounts are written the way the language writes them', () => {
  assert.equal(formatAmount(1.5, 'nl'), '1,5');
  assert.equal(formatAmount(1.5, 'en'), '1.5');
  assert.equal(formatAmount(250, 'nl'), '250');
});

test('amounts round to cooking precision', () => {
  assert.equal(roundAmount(0.25), 0.3);
  assert.equal(roundAmount(12.4), 12.5);
  assert.equal(roundAmount(453.592), 454);
  assert.equal(roundAmount(0), 0);
});

test('quantities render as metric amounts', () => {
  assert.equal(formatQuantity(250, 'g', 'nl'), '250 g');
  assert.equal(formatQuantity(2, 'cloves', 'nl'), '2 teentjes');
  assert.equal(formatQuantity(2, 'cloves', 'en'), '2 cloves');
  assert.equal(formatQuantity(1, 'cup', 'nl'), '240 ml');
  assert.equal(formatQuantity(null, 'pinch', 'nl'), 'snufje');
});

test('no imperial label ever reaches the page', () => {
  const imperial = /cup|tbsp|tsp|oz\b|ounce|pound|pint|quart|gallon|fluid/i;
  ['cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'pound', 'pounds', 'pint', 'quart', 'fl oz'].forEach(unit => {
    assert.doesNotMatch(formatQuantity(1, unit, 'nl'), imperial, `${unit} leaked`);
    assert.doesNotMatch(formatQuantity(1, unit, 'en'), imperial, `${unit} leaked`);
  });
});
