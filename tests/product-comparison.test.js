import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPricePerKg, sortComparedProducts } from '../js/product-comparison.js';

test('getPricePerKg uses the listed unit price description when present', () => {
  // "per 100 g € 0,40" => €4 / kg
  const price = getPricePerKg({
    price: 2,
    unitSize: '500 g',
    unitPriceDescription: 'Prijs per 100 g € 0,40'
  });
  assert.equal(price, 4);
});

test('getPricePerKg derives per-kg price from a single pack size', () => {
  // €2.00 for 400 g => €5 / kg
  assert.equal(getPricePerKg({ price: 2, unitSize: '400 g', unitPriceDescription: '' }), 5);
  // €3.00 for 1.5 kg => €2 / kg
  assert.equal(getPricePerKg({ price: 3, unitSize: '1,5 kg', unitPriceDescription: '' }), 2);
});

test('getPricePerKg handles multipacks', () => {
  // 2 x 250 g = 0.5 kg for €4 => €8 / kg
  assert.equal(getPricePerKg({ price: 4, unitSize: '2 x 250 g', unitPriceDescription: '' }), 8);
});

test('getPricePerKg returns null when no size information is available', () => {
  assert.equal(getPricePerKg({ price: 2, unitSize: '', unitPriceDescription: '' }), null);
});

test('sortComparedProducts ranks cheapest-per-kg first in price mode', () => {
  const products = [
    { id: 'a', price: 3, unitSize: '500 g', nutriScore: 'C', proteinScore: 40 },
    { id: 'b', price: 2, unitSize: '400 g', nutriScore: 'B', proteinScore: 50 }
  ];
  const sorted = sortComparedProducts(products, 'price');
  // a: €6/kg, b: €5/kg => b cheaper
  assert.equal(sorted[0].id, 'b');
});

test('sortComparedProducts assigns a balanced score using the selected criteria', () => {
  const products = [
    { id: 'cheap', price: 2, unitSize: '1 kg', nutriScore: 'D', proteinScore: 10 },
    { id: 'pricey', price: 4, unitSize: '1 kg', nutriScore: 'A', proteinScore: 90 }
  ];
  const sorted = sortComparedProducts(products, 'balanced', { price: true, health: true, protein: true });
  // Each product gets a finite composite score.
  sorted.forEach(p => assert.equal(typeof p.score, 'number'));
  // The balanced ordering should be deterministic and include both products.
  assert.equal(sorted.length, 2);
  assert.deepEqual(sorted.map(p => p.id).sort(), ['cheap', 'pricey']);
});

test('sortComparedProducts excludes deselected criteria from the score', () => {
  const products = [
    { id: 'x', price: 1, unitSize: '1 kg', nutriScore: 'E', proteinScore: 0 },
    { id: 'y', price: 5, unitSize: '1 kg', nutriScore: 'E', proteinScore: 0 }
  ];
  // Only price counts: x is far cheaper so its price score should drive it to the top.
  const sorted = sortComparedProducts(products, 'balanced', { price: true, health: false, protein: false });
  assert.equal(sorted[0].id, 'x');
});

test('sortComparedProducts tolerates products without a price per kg', () => {
  const products = [
    { id: 'noprice', price: 2, unitSize: '', nutriScore: 'B', proteinScore: 20 },
    { id: 'priced', price: 2, unitSize: '1 kg', nutriScore: 'B', proteinScore: 20 }
  ];
  const sorted = sortComparedProducts(products, 'price');
  // Priced products should come before ones without a known per-kg price.
  assert.equal(sorted[0].id, 'priced');
});
