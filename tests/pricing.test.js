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

test('parsePackageSize reads the pack sizes AH uses', () => {
  const ah = makeService();
  assert.deepEqual(ah.parsePackageSize('400 g'), { amount: 400, unit: 'weight' });
  assert.deepEqual(ah.parsePackageSize('ca. 500 g'), { amount: 500, unit: 'weight' });
  assert.deepEqual(ah.parsePackageSize('los per 500 g'), { amount: 500, unit: 'weight' });
  assert.deepEqual(ah.parsePackageSize('0,5 l'), { amount: 500, unit: 'volume' });
  assert.deepEqual(ah.parsePackageSize('per stuk'), { amount: 1, unit: 'count' });
  assert.deepEqual(ah.parsePackageSize('2 x 150 g'), { amount: 300, unit: 'weight' });
  assert.equal(ah.parsePackageSize(''), null);
});

test('calculateQuantityCost refuses a pack that is far too small for the recipe', () => {
  const ah = makeService();
  // A 36 g spice mix cannot cover 350 g of broccoli: 350/36 is ~10 packs.
  assert.equal(
    ah.calculateQuantityCost({ amount: 350, unit: 'g' }, { price: 1.99, regularPrice: 1.99, unitSize: '36 g' }, 1),
    null
  );
});

test('calculateQuantityCost bridges pieces, weight and volume where that makes sense', () => {
  const ah = makeService();
  // 1 eetlepel mosterd (15 ml) from a 250 g jar.
  const mustard = ah.calculateQuantityCost({ amount: 1, unit: 'el' }, { price: 0.75, regularPrice: 0.75, unitSize: '250 g' }, 1);
  assert.ok(mustard.current < 0.06);
  // 4 tortillas from a 370 g pack of 6.
  const wraps = ah.calculateQuantityCost(
    { name: 'tortilla', amount: 4, unit: 'stuks' },
    { price: 0.95, regularPrice: 0.95, unitSize: '370 g' },
    1
  );
  assert.ok(Math.abs(wraps.current - 0.4108) < 0.01);
});

test('isRelevantProductForIngredient rejects dishes that merely contain the ingredient', () => {
  const ah = makeService();
  const broccoli = { title: 'AH Broccoli', unitSize: '500 g', mainCategory: 'Groente, aardappelen', subCategory: 'Broccoli' };
  const spiceMix = {
    title: 'Honig Bakplaat mix aardappel, broccoli, gehakt',
    unitSize: '36 g',
    mainCategory: 'Pasta, rijst, wereldkeuken',
    subCategory: 'Hollandse maaltijdpakketten, mixen'
  };
  const babyFood = {
    title: 'Olvarit Broccoli kalkoen aardappel 12m+',
    unitSize: '250 g',
    mainCategory: 'Baby en kind',
    subCategory: 'Maaltijden vanaf 12 maanden'
  };
  const blend = {
    title: 'AH Bloemkool broccoli kleinverpakking',
    unitSize: '200 g',
    mainCategory: 'Groente, aardappelen',
    subCategory: 'Bloemkool'
  };
  assert.equal(ah.isRelevantProductForIngredient('broccoli', broccoli), true);
  assert.equal(ah.isRelevantProductForIngredient('broccoli', spiceMix), false);
  assert.equal(ah.isRelevantProductForIngredient('broccoli', babyFood), false);
  assert.equal(ah.isRelevantProductForIngredient('broccoli', blend), false);
});

test('isRelevantProductForIngredient does not match on a coincidental prefix', () => {
  const ah = makeService();
  const sausage = { title: 'AH Boterhamworst', mainCategory: 'Vleeswaren', subCategory: 'Boterhamworst (voorverpakt)' };
  const cauliflower = { title: 'AH Bloemkool', mainCategory: 'Groente, aardappelen', subCategory: 'Bloemkool' };
  const butter = { title: 'AH Roomboter ongezouten', mainCategory: 'Zuivel, eieren', subCategory: 'Ongezouten roomboter' };
  const flour = { title: 'AH Tarwebloem', mainCategory: 'Bakproducten', subCategory: 'Bloem' };
  assert.equal(ah.isRelevantProductForIngredient('boter', sausage), false);
  assert.equal(ah.isRelevantProductForIngredient('bloem', cauliflower), false);
  assert.equal(ah.isRelevantProductForIngredient('boter', butter), true);
  assert.equal(ah.isRelevantProductForIngredient('bloem', flour), true);
});

test('selectProductForIngredient prefers the cheapest product that really is the ingredient', () => {
  const ah = makeService();
  const products = [
    // The first AH search hit, but it is a spice mix and wildly overpriced for 350 g.
    { id: 'mix', title: 'Honig Bakplaat mix aardappel, broccoli, gehakt', price: 1.99, regularPrice: 1.99, unitSize: '36 g', mainCategory: 'Pasta, rijst, wereldkeuken', subCategory: 'Hollandse maaltijdpakketten, mixen' },
    { id: 'small', title: 'AH Broccoliroosjes', price: 1.99, regularPrice: 1.99, unitSize: '200 g', mainCategory: 'Groente, aardappelen', subCategory: 'Broccoli' },
    { id: 'cheap', title: 'AH Broccoli', price: 1.29, regularPrice: 1.29, unitSize: '500 g', mainCategory: 'Groente, aardappelen', subCategory: 'Broccoli' },
    { id: 'bulk', title: 'AH Broccoli', price: 4.49, regularPrice: 4.49, unitSize: '2 kg', mainCategory: 'Groente, aardappelen', subCategory: 'Broccoli' }
  ];
  const selection = ah.selectProductForIngredient({ name: 'broccoli', amount: 350, unit: 'g' }, products, 1);
  // The 2 kg pack is cheapest per gram but four times the need.
  assert.equal(selection.product.id, 'cheap');
  assert.equal(selection.relevant, true);
  assert.deepEqual(selection.matchedIds, ['cheap', 'bulk', 'small']);
});

test('selectProductForIngredient returns no product when nothing matches', () => {
  const ah = makeService();
  const products = [
    { id: 'mix', title: 'Maggi Ovenschotel broccoli gratin', price: 1.89, regularPrice: 1.89, unitSize: '43 g', mainCategory: 'Pasta, rijst, wereldkeuken', subCategory: 'Hollandse maaltijdpakketten, mixen' }
  ];
  const selection = ah.selectProductForIngredient({ name: 'broccoli', amount: 350, unit: 'g' }, products, 1);
  assert.equal(selection.product, null);
  assert.equal(selection.relevant, false);
});

test('unitPriceFor reports a comparable price per kilo, litre or piece', () => {
  const ah = makeService();
  // 500 g for €1.29 => €2.58 per kg.
  const broccoli = ah.unitPriceFor({ price: 1.29, regularPrice: 1.29, unitSize: '500 g' });
  assert.equal(broccoli.unit, 'kg');
  assert.ok(Math.abs(broccoli.amount - 2.58) < 1e-9);
  assert.equal(ah.unitPriceFor({ price: 2.75, regularPrice: 2.75, unitSize: '0,5 l' }).unit, 'l');
  assert.equal(ah.unitPriceFor({ price: 2.5, regularPrice: 2.5, unitSize: '5 stuks' }).unit, 'stuk');
  // Multiple packs are summed before dividing.
  assert.ok(Math.abs(ah.unitPriceFor({ price: 3, regularPrice: 3, unitSize: '2 x 150 g' }).amount - 10) < 1e-9);
});

test('unitPriceFor keeps the pre-bonus unit price for comparison', () => {
  const ah = makeService();
  const bonus = ah.unitPriceFor({ price: 1.99, regularPrice: 2.5, unitSize: '200 g' });
  assert.ok(Math.abs(bonus.amount - 9.95) < 1e-9);
  assert.ok(Math.abs(bonus.regular - 12.5) < 1e-9);
});

test('unitPriceFor falls back to the AH description and skips single pieces', () => {
  const ah = makeService();
  const described = ah.unitPriceFor({
    price: 2,
    regularPrice: 2,
    unitSize: '',
    unitPriceDescription: 'prijs per kg 3.31'
  });
  assert.equal(described.unit, 'kg');
  assert.equal(described.amount, 3.31);
  // A single loose item has no meaningful unit price.
  assert.equal(ah.unitPriceFor({ price: 2.79, regularPrice: 2.79, unitSize: 'per stuk' }), null);
  assert.equal(ah.unitPriceFor({ price: 2.79, regularPrice: 2.79, unitSize: '' }), null);
});
