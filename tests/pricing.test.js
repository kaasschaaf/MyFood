import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AHService } from '../js/ah-service.js';

// Minimal in-memory cache so AHService can be constructed without IndexedDB.
const memoryCache = { get: async () => null, set: async () => ({ updatedAt: Date.now() }) };
const makeService = () => new AHService(memoryCache);

function product(overrides = {}) {
  return {
    price: 2,
    regularPrice: 2,
    unitSize: '400 g',
    selectedAHProduct: true,
    ...overrides
  };
}

test('normalizeQuantity converts between units of the same dimension', () => {
  const ah = makeService();
  assert.deepEqual(ah.normalizeQuantity(1, 'kg'), { amount: 1000, unit: 'weight' });
  assert.deepEqual(ah.normalizeQuantity(500, 'g'), { amount: 500, unit: 'weight' });
  assert.deepEqual(ah.normalizeQuantity(1, 'l'), { amount: 1000, unit: 'volume' });
  assert.deepEqual(ah.normalizeQuantity(2, 'stuks'), { amount: 2, unit: 'count' });
  assert.equal(ah.normalizeQuantity(1, 'handje'), null);
});

test('normalizeQuantity understands imperial and Dutch cooking units', () => {
  const ah = makeService();
  assert.deepEqual(ah.normalizeQuantity(1, 'lb'), { amount: 453.592, unit: 'weight' });
  assert.deepEqual(ah.normalizeQuantity(4, 'oz'), { amount: 113.398, unit: 'weight' });
  assert.deepEqual(ah.normalizeQuantity(0.5, 'cup'), { amount: 120, unit: 'volume' });
  assert.deepEqual(ah.normalizeQuantity(2, 'tbsp'), { amount: 30, unit: 'volume' });
  assert.deepEqual(ah.normalizeQuantity(2, 'tl'), { amount: 10, unit: 'volume' });
  assert.deepEqual(ah.normalizeQuantity(1, 'eetlepel'), { amount: 15, unit: 'volume' });
  assert.deepEqual(ah.normalizeQuantity(2, ''), { amount: 2, unit: 'count' });
});

test('calculateQuantityCost prices a US measure against a metric pack', () => {
  const ah = makeService();
  const cost = ah.calculateQuantityCost(
    { amount: 1, unit: 'lb' },
    { price: 4, regularPrice: 4, unitSize: '1 kg' },
    1
  );
  assert.ok(Math.abs(cost.current - 1.814368) < 1e-6);
});

test('calculateQuantityCost prorates price by used quantity vs pack size', () => {
  const ah = makeService();
  // 200 g of a 400 g pack at €2.00 => half the pack => €1.00
  const cost = ah.calculateQuantityCost(
    { amount: 200, unit: 'g' },
    { price: 2, regularPrice: 2, unitSize: '400 g' },
    1
  );
  assert.equal(cost.current, 1);
  assert.equal(cost.regular, 1);
});

test('calculateQuantityCost returns null when units or pack size are incompatible', () => {
  const ah = makeService();
  // Pack is weight, ingredient is count => cannot convert.
  assert.equal(
    ah.calculateQuantityCost({ amount: 2, unit: 'stuks' }, { price: 2, regularPrice: 2, unitSize: '400 g' }, 1),
    null
  );
  // Missing pack size.
  assert.equal(
    ah.calculateQuantityCost({ amount: 200, unit: 'g' }, { price: 2, regularPrice: 2, unitSize: '' }, 1),
    null
  );
});

test('calculateQuantityCost scales with servings', () => {
  const ah = makeService();
  // 4 servings of a 2-serving recipe => amount used doubled.
  const cost = ah.calculateQuantityCost(
    { amount: 200, unit: 'g' },
    { price: 2, regularPrice: 2, unitSize: '400 g' },
    2
  );
  assert.equal(cost.current, 2);
});

test('calculateRecipePrice on a live-priced recipe sums prorated ingredient costs and detects bonus', () => {
  const ah = makeService();
  const recipe = {
    baseServings: 2,
    livePriced: true,
    ingredients: [
      { amount: 200, unit: 'g', selectedAHProduct: { price: 2, regularPrice: 2.5, unitSize: '400 g' } },
      { amount: 1, unit: 'kg', selectedAHProduct: { price: 4, regularPrice: 4, unitSize: '1 kg' } }
    ]
  };
  const price = ah.calculateRecipePrice(recipe, 2);
  // Ingredient 1: 200/400 * 2.00 = 1.00 (regular 1.25). Ingredient 2: 1.00 * 4 = 4.00
  assert.equal(price.totalPrice, 5);
  assert.equal(price.totalStandardPrice, 5.25);
  assert.equal(price.pricePerPerson, 2.5);
  assert.equal(price.hasBonus, true);
  assert.equal(price.hasPriceData, true);
  assert.equal(price.matchedIngredientCount, 2);
  assert.equal(price.ingredientCount, 2);
});

test('calculateRecipePrice marks data incomplete when an ingredient cannot be priced', () => {
  const ah = makeService();
  const recipe = {
    baseServings: 2,
    livePriced: true,
    ingredients: [
      { amount: 200, unit: 'g', selectedAHProduct: { price: 2, regularPrice: 2, unitSize: '400 g' } },
      { amount: 2, unit: 'stuks', selectedAHProduct: null }
    ]
  };
  const price = ah.calculateRecipePrice(recipe, 2);
  assert.equal(price.hasPriceData, false);
  assert.equal(price.hasAnyPriceData, true);
  assert.equal(price.pricedIngredientCount, 1);
  assert.equal(price.ingredientCount, 2);
  assert.equal(price.unpricedIngredientCount, 1);
});

test('calculateRecipePrice returns emptyPrice for a recipe without ingredients', () => {
  const ah = makeService();
  const price = ah.calculateRecipePrice({ ingredients: [] }, 2);
  assert.equal(price.totalPrice, 0);
  assert.equal(price.hasPriceData, false);
  assert.equal(price.ingredientCount, 0);
});

test('calculateRecipePrice scales totals by servings', () => {
  const ah = makeService();
  const recipe = {
    baseServings: 2,
    livePriced: true,
    ingredients: [{ amount: 400, unit: 'g', selectedAHProduct: { price: 2, regularPrice: 2, unitSize: '400 g' } }]
  };
  // Doubling servings doubles the quantity used => doubles the cost.
  const price = ah.calculateRecipePrice(recipe, 4);
  assert.equal(price.totalPrice, 4);
});

test('formatEuro formats Dutch currency and handles invalid input', () => {
  const ah = makeService();
  // Intl uses a non-breaking space (U+00A0) between symbol and amount.
  const NBSP = '\u00a0';
  assert.equal(ah.formatEuro(3.5), `€${NBSP}3,50`);
  assert.equal(ah.formatEuro(NaN), '€ 0,00');
  assert.equal(ah.formatEuro(null), '€ 0,00');
  assert.equal(ah.formatEuro(undefined), '€ 0,00');
});

test('roundEuro rounds to two decimals without floating point drift', () => {
  const ah = makeService();
  assert.equal(ah.roundEuro(1.005), 1.01);
  assert.equal(ah.roundEuro(2.675), 2.68);
});
