import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_PACK_OVERSHOOT,
  ingredientHeadword,
  ingredientKeywords,
  isRelevantProductForIngredient,
  normalizeText,
  productExactness,
  rankProductsForIngredient,
  selectProductForIngredient,
  wordMatchesHeadword
} from '../js/ingredient-matching.js';

const product = (overrides = {}) => ({
  id: 'p',
  price: 1,
  regularPrice: 1,
  unitSize: '500 g',
  ...overrides
});

test('normalizeText lowercases and strips diacritics', () => {
  assert.equal(normalizeText('Crème Fraîche'), 'creme fraiche');
  assert.equal(normalizeText(null), '');
});

test('ingredientKeywords drops filler and adjectives', () => {
  assert.deepEqual(ingredientKeywords('2 large free-range eggs'), ['free', 'range', 'eggs']);
  assert.deepEqual(ingredientKeywords('Zuivelspread bieslook light'), ['zuivelspread', 'bieslook']);
  assert.deepEqual(ingredientKeywords('to taste salt'), ['salt']);
});

test('ingredientHeadword is the last meaningful noun', () => {
  assert.equal(ingredientHeadword('zoete aardappel'), 'aardappel');
  assert.equal(ingredientHeadword('Griekse yoghurt'), 'yoghurt');
  assert.equal(ingredientHeadword('Ground Beef'), 'beef');
  assert.equal(ingredientHeadword(''), '');
});

test('wordMatchesHeadword handles plurals and Dutch compounds', () => {
  assert.equal(wordMatchesHeadword('broccoli', 'broccoli'), true);
  assert.equal(wordMatchesHeadword('puntpaprika', 'paprika'), true);
  assert.equal(wordMatchesHeadword('uien', 'ui'), true);
  assert.equal(wordMatchesHeadword('aardappelen', 'aardappel'), true);
  assert.equal(wordMatchesHeadword('boterhamworst', 'boter'), false);
  assert.equal(wordMatchesHeadword('bloemkool', 'bloem'), false);
  assert.equal(wordMatchesHeadword('', 'bloem'), false);
});

test('a dish that merely contains the ingredient is not a match', () => {
  const broccoli = product({ title: 'AH Broccoli', mainCategory: 'Groente, aardappelen', subCategory: 'Broccoli' });
  const spiceMix = product({ title: 'Honig Bakplaat mix aardappel, broccoli, gehakt', mainCategory: 'Pasta, rijst, wereldkeuken', subCategory: 'Hollandse maaltijdpakketten, mixen' });
  const babyFood = product({ title: 'Olvarit Broccoli 8+', mainCategory: 'Baby en kind', subCategory: 'Knijphapjes' });
  const blend = product({ title: 'AH Broccoli, wortel en bloemkool', mainCategory: 'Groente, aardappelen', subCategory: 'Groentemixen' });

  assert.equal(isRelevantProductForIngredient('broccoli', broccoli), true);
  assert.equal(isRelevantProductForIngredient('broccoli', spiceMix), false);
  assert.equal(isRelevantProductForIngredient('broccoli', babyFood), false);
  assert.equal(isRelevantProductForIngredient('broccoli', blend), false);
});

test('matching does not fire on a coincidental prefix', () => {
  const sausage = product({ title: 'AH Boterhamworst', subCategory: 'Vleeswaren' });
  const cauliflower = product({ title: 'AH Bloemkool', subCategory: 'Bloemkool' });
  const butter = product({ title: 'AH Roomboter', mainCategory: 'Boter, kaas en eieren', subCategory: 'Boter' });
  const flour = product({ title: 'AH Patentbloem', mainCategory: 'Bakken', subCategory: 'Bloem' });

  assert.equal(isRelevantProductForIngredient('boter', sausage), false);
  assert.equal(isRelevantProductForIngredient('bloem', cauliflower), false);
  assert.equal(isRelevantProductForIngredient('boter', butter), true);
  assert.equal(isRelevantProductForIngredient('bloem', flour), true);
});

test('productExactness prefers a product that starts with the ingredient', () => {
  const exact = product({ title: 'AH Broccoli' });
  const shelfmate = product({ title: 'AH Bimi' });
  assert.equal(productExactness('broccoli', exact), 2);
  assert.equal(productExactness('broccoli', shelfmate), 1);
});

test('ranking works without any service dependencies', () => {
  const products = [
    product({ id: 'mix', title: 'Honig Bakplaat mix broccoli', price: 1.99, unitSize: '36 g' }),
    product({ id: 'cheap', title: 'AH Broccoli', price: 1.29, unitSize: '500 g' }),
    product({ id: 'bulk', title: 'AH Broccoli', price: 4.49, unitSize: '2 kg' })
  ];
  const ranked = rankProductsForIngredient(
    { name: 'broccoli', amount: 350, unit: 'g' },
    products,
    1,
    {
      quantityCost: (ingredient, item) => ({ current: item.price }),
      packageSize: unitSize => (unitSize.includes('kg') ? { amount: 2000, unit: 'weight' } : { amount: 500, unit: 'weight' }),
      normalizeQuantity: () => ({ amount: 350, unit: 'weight' })
    }
  );
  // Without a cost model only relevance and overshoot decide, so both broccoli
  // packs lead and the spice mix is last.
  assert.deepEqual(ranked.map(entry => entry.product.id).slice(-1), ['mix']);
  assert.equal(ranked.at(-1).relevant, false);
  assert.ok(ranked.find(entry => entry.product.id === 'bulk').oversized);
});

test('oversized packs lose to a pack that fits the recipe', () => {
  const products = [
    product({ id: 'bulk', title: 'AH Broccoli', price: 4.49, unitSize: '2 kg' }),
    product({ id: 'fit', title: 'AH Broccoli', price: 1.29, unitSize: '500 g' })
  ];
  const ranked = rankProductsForIngredient(
    { name: 'broccoli', amount: 350, unit: 'g' },
    products,
    1,
    {
      packageSize: unitSize => (unitSize.includes('kg') ? { amount: 2000, unit: 'weight' } : { amount: 500, unit: 'weight' }),
      normalizeQuantity: () => ({ amount: 350, unit: 'weight' })
    }
  );
  assert.equal(ranked[0].product.id, 'fit');
  assert.equal(ranked[1].oversized, true);
  assert.ok(2 > 1 && MAX_PACK_OVERSHOOT === 4);
});

test('selectProductForIngredient returns no product when nothing matches', () => {
  const selection = selectProductForIngredient(
    { name: 'broccoli', amount: 350, unit: 'g' },
    [product({ id: 'mix', title: 'Maggi Ovenschotel broccoli gratin', subCategory: 'Maaltijdmixen' })],
    1
  );
  assert.equal(selection.product, null);
  assert.equal(selection.relevant, false);
  assert.deepEqual(selection.matchedIds, []);
});
