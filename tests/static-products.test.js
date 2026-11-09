import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STATIC_MIN_RESULTS,
  isKnownStaticQuery,
  searchStaticProducts
} from '../js/static-products.js';

const products = {
  keys: {
    rundergehakt: {
      key: 'rundergehakt',
      nameNl: 'rundergehakt',
      nameEn: 'ground beef',
      aliases: ['rundergehakt', 'ground beef', 'gehakt'],
      options: [
        { productId: 'p1', title: 'AH Rundergehakt 300 g', unitSize: '300 g', mainCategory: 'Vlees', subCategory: 'Gehakt', productUrl: 'https://ah.nl/1' },
        { productId: 'p2', title: 'AH Mager rundergehakt 500 g', unitSize: '500 g', mainCategory: 'Vlees', subCategory: 'Gehakt', productUrl: 'https://ah.nl/2' }
      ]
    },
    kipfilet: {
      key: 'kipfilet',
      nameNl: 'kipfilet',
      nameEn: 'chicken breast',
      aliases: ['kipfilet', 'chicken breast'],
      options: [{ productId: 'p3', title: 'AH Kipfilet 600 g', unitSize: '600 g', mainCategory: 'Vlees', subCategory: 'Kip', productUrl: 'https://ah.nl/3' }]
    },
    zout: {
      key: 'zout',
      nameNl: 'zout',
      nameEn: 'salt',
      aliases: ['zout', 'salt'],
      options: [{ productId: 'p4', title: 'AH Zout 500 g', unitSize: '500 g', mainCategory: 'Kruiden', subCategory: 'Zout', productUrl: 'https://ah.nl/4' }]
    }
  }
};

const prices = {
  generatedAt: '2026-11-09T00:00:00.000Z',
  prices: {
    p1: { price: 4.29, regularPrice: 4.29, unitSize: '300 g' },
    p2: { price: 6.49, regularPrice: 6.49, unitSize: '500 g' },
    p3: { price: 6.99, regularPrice: 7.99, isBonus: true, unitSize: '600 g' },
    p4: { price: 1.19, regularPrice: 1.19, unitSize: '500 g' }
  }
};

test('an exact key or alias is answered from the static database', () => {
  for (const query of ['rundergehakt', 'gehakt', 'ground beef', 'Rundergehakt']) {
    const result = searchStaticProducts(products, prices, query);
    assert.equal(result.matched, true, query);
    assert.equal(result.reason, 'exact');
    assert.ok(result.products.length >= 1);
    assert.ok(result.products.every(product => Number.isFinite(product.price)));
  }
});

test('the products of a key carry prices and unit sizes', () => {
  const result = searchStaticProducts(products, prices, 'kipfilet');
  const [chicken] = result.products;
  assert.equal(chicken.price, 6.99);
  assert.equal(chicken.regularPrice, 7.99);
  assert.equal(chicken.isBonus, true);
  assert.equal(chicken.unitSize, '600 g');
  assert.equal(chicken.productUrl, 'https://ah.nl/3');
  assert.equal(result.updatedAt, prices.generatedAt);
});

test('a broad query with too few matches falls through to live search', () => {
  const result = searchStaticProducts(products, prices, 'chocolade');
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'unknown');
  assert.deepEqual(result.products, []);
  assert.equal(isKnownStaticQuery(products, 'chocolade'), false);
});

test('a wide substring query needs enough hits before it is answered statically', () => {
  assert.ok(STATIC_MIN_RESULTS > 1);
  // "e" appears everywhere but matches nothing by whole word, so it goes live.
  const result = searchStaticProducts(products, prices, 'e');
  assert.equal(result.matched, false);
  assert.equal(isKnownStaticQuery(products, 'e'), false);
});

test('the category filter is applied to the static results', () => {
  const vlees = searchStaticProducts(products, prices, 'rundergehakt', { categoryLabel: 'Vlees' });
  assert.ok(vlees.products.length >= 1);
  const groente = searchStaticProducts(products, prices, 'rundergehakt', { categoryLabel: 'Groente' });
  assert.equal(groente.matched, false);
  assert.equal(groente.reason, 'no-products');
});

test('an empty query returns nothing instead of everything', () => {
  const result = searchStaticProducts(products, prices, '   ');
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'empty');
});

test('a product without a price is not offered', () => {
  const withoutPrice = { ...prices, prices: { ...prices.prices, p1: undefined } };
  const result = searchStaticProducts(products, withoutPrice, 'rundergehakt');
  assert.ok(result.products.every(product => product.id !== 'p1'));
  assert.ok(result.products.some(product => product.id === 'p2'));
});

test('missing data files are handled gracefully', () => {
  assert.equal(searchStaticProducts(null, null, 'melk').matched, false);
  assert.equal(searchStaticProducts(products, null, 'melk').matched, false);
  assert.equal(isKnownStaticQuery(null, 'melk'), false);
});

test('a query is not matched by coincidence inside a longer word', () => {
  // "chips" appears nowhere as an ingredient word in this fixture; a plain
  // substring check would match names like "chickpeas".
  const withChickpeas = {
    keys: {
      ...products.keys,
      kikkererwten: {
        key: 'kikkererwten',
        nameNl: 'kikkererwten',
        nameEn: 'chickpeas',
        aliases: ['kikkererwten', 'chickpeas'],
        options: [{ productId: 'p9', title: 'AH Kikkererwten', unitSize: '400 g' }]
      }
    }
  };
  const withPrice = { ...prices, prices: { ...prices.prices, p9: { price: 1.09, regularPrice: 1.09, unitSize: '400 g' } } };
  assert.equal(searchStaticProducts(withChickpeas, withPrice, 'chips').matched, false);
  assert.equal(searchStaticProducts(withChickpeas, withPrice, 'chip').matched, false);
  assert.equal(isKnownStaticQuery(withChickpeas, 'chips'), false);
});

test('a compound word still finds its core ingredient', () => {
  const result = searchStaticProducts(products, prices, 'rundergehakt');
  assert.equal(result.matched, true);
  // "gehakt" is an alias, so it resolves exactly.
  assert.equal(searchStaticProducts(products, prices, 'gehakt').matched, true);
});
