import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RecipesService } from '../js/recipes-service.js';
import { translateIngredientToDutch } from '../js/ingredient-dutch.js';

const noopCache = { get: async () => null, set: async () => ({ updatedAt: Date.now() }) };
const makeService = () => new RecipesService({}, noopCache);

test('parseMeasure handles whole numbers, decimals and fractions', () => {
  const rs = makeService();
  assert.deepEqual(rs.parseMeasure('2 eggs'), { amount: 2, unit: 'eggs' });
  assert.deepEqual(rs.parseMeasure('1.5 kg'), { amount: 1.5, unit: 'kg' });
  assert.deepEqual(rs.parseMeasure('1,5 kg'), { amount: 1.5, unit: 'kg' });
  assert.deepEqual(rs.parseMeasure('1/2 cup'), { amount: 0.5, unit: 'cup' });
  assert.deepEqual(rs.parseMeasure('1 1/2 cups'), { amount: 1.5, unit: 'cups' });
  assert.deepEqual(rs.parseMeasure('to taste'), { amount: null, unit: 'to taste' });
});

test('normalizeName strips accents and non-alphanumerics', () => {
  const rs = makeService();
  assert.equal(rs.normalizeName('Crème Fraîche!'), 'creme fraiche');
  assert.equal(rs.normalizeName('  Olive-Oil  '), 'olive oil');
});

test('getAHSearchQuery applies curated aliases and falls back to the raw name', () => {
  const rs = makeService();
  assert.equal(rs.getAHSearchQuery('chicken breast'), 'kipfilet');
  assert.equal(rs.getAHSearchQuery('salmon fillet'), 'zalmfilet');
  assert.equal(rs.getAHSearchQuery('quinoa'), 'quinoa');
});

test('getSafeExternalUrl only allows https URLs', () => {
  const rs = makeService();
  assert.equal(rs.getSafeExternalUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(rs.getSafeExternalUrl('http://example.com/x'), null);
  assert.equal(rs.getSafeExternalUrl('javascript:alert(1)'), null);
  assert.equal(rs.getSafeExternalUrl(''), null);
  assert.equal(rs.getSafeExternalUrl(null), null);
});

test('isAHRecipeUrl accepts only well-formed Allerhande recipe URLs', () => {
  const rs = makeService();
  assert.equal(rs.isAHRecipeUrl('https://www.ah.nl/allerhande/recept/R-R123456/pasta-pesto'), true);
  assert.equal(rs.isAHRecipeUrl('https://www.ah.nl/allerhande/recept/R-R123456/pasta-pesto/extra'), false);
  assert.equal(rs.isAHRecipeUrl('http://www.ah.nl/allerhande/recept/R-R123456/pasta'), false);
  assert.equal(rs.isAHRecipeUrl('https://evil.example/allerhande/recept/R-R1/x'), false);
  assert.equal(rs.isAHRecipeUrl('not a url'), false);
});

test('isLivePricedRecipe is true for external and livePriced recipes only', () => {
  const rs = makeService();
  assert.equal(rs.isLivePricedRecipe({ external: true }), true);
  assert.equal(rs.isLivePricedRecipe({ livePriced: true }), true);
  assert.equal(rs.isLivePricedRecipe({ livePriced: true, ahRecipeOnly: true }), false);
  assert.equal(rs.isLivePricedRecipe({}), false);
  assert.equal(rs.isLivePricedRecipe(null), false);
});

test('combineRecipes deduplicates external recipes against local titles and each other', () => {
  const rs = makeService();
  const local = [{ id: 'local-1', title: 'Romige Pasta' }];
  const external = [
    { id: 'ext-1', title: 'Romige Pasta' },        // duplicate of local title
    { id: 'ext-2', title: 'Nasi Goreng' },
    { id: 'ext-2', title: 'Nasi Goreng' },         // duplicate id
    { id: 'ah-1', title: 'Allerhande Gerecht', ahRecipeOnly: true }
  ];
  const combined = rs.combineRecipes(local, external);
  const ids = combined.map(recipe => recipe.id);
  assert.ok(ids.includes('local-1'));
  assert.ok(ids.includes('ext-2'));
  assert.ok(ids.includes('ah-1'));
  assert.ok(!ids.includes('ext-1'), 'local-title duplicate should be removed');
  assert.equal(ids.filter(id => id === 'ext-2').length, 1, 'duplicate id should collapse');
});

/**
 * AH service stub that records the queries the app would send.
 * @param {string[]} queries
 */
function recordingAHService(queries) {
  return {
    searchProducts: async query => {
      queries.push(query);
      return { products: [], updatedAt: Date.now(), stale: false };
    },
    rankProductsForIngredient: (ingredient, products) =>
      (products || []).map(product => ({ product, relevant: true })),
    getSavedMatch: async () => null,
    saveMatch: async () => {},
    filterProductsByOnlinePreference: products => products || []
  };
}

test('AH is searched with a Dutch name for English recipes', async () => {
  const queries = [];
  const rs = new RecipesService(recordingAHService(queries), noopCache);
  rs.setIngredientTranslator(async name => translateIngredientToDutch(name).text);

  const recipe = {
    id: 'themealdb-1',
    external: true,
    baseServings: 2,
    ingredients: [
      { name: 'Ground Beef', amount: 1, unit: 'lb' },
      { name: 'Broccoli', amount: 1, unit: 'lb' },
      { name: 'High Heat Cooking Oil', amount: 2, unit: 'tbsp' }
    ]
  };
  await rs.fetchAHMatches(recipe);

  assert.deepEqual(queries, ['rundergehakt', 'broccoli', 'olie']);
  assert.equal(recipe.ingredients[0].ahLookupName, 'rundergehakt');
  assert.equal(recipe.ingredients[2].ahLookupName, 'olie');
});

test('built-in Dutch recipes are never translated before the AH search', async () => {
  const queries = [];
  const rs = new RecipesService(recordingAHService(queries), noopCache);
  let called = 0;
  rs.setIngredientTranslator(async name => {
    called++;
    return translateIngredientToDutch(name).text;
  });

  const recipe = {
    id: 'local-1',
    baseServings: 2,
    ingredients: [{ name: 'Kipfilet', amount: 300, unit: 'g' }]
  };
  await rs.fetchAHMatches(recipe);

  assert.deepEqual(queries, ['Kipfilet']);
  assert.equal(called, 0, 'local ingredient names are already Dutch');
});

test('a failing translator leaves the original ingredient name in place', async () => {
  const queries = [];
  const rs = new RecipesService(recordingAHService(queries), noopCache);
  rs.setIngredientTranslator(async () => {
    throw new Error('offline');
  });

  const recipe = {
    id: 'themealdb-2',
    external: true,
    baseServings: 2,
    ingredients: [{ name: 'Xoconostle', amount: 200, unit: 'g' }]
  };
  await rs.fetchAHMatches(recipe);

  assert.deepEqual(queries, ['Xoconostle']);
  assert.equal(recipe.ingredients[0].ahLookupName, 'Xoconostle');
});

test('the static alias list still catches English names when translation fails', async () => {
  const queries = [];
  const rs = new RecipesService(recordingAHService(queries), noopCache);
  rs.setIngredientTranslator(async () => {
    throw new Error('offline');
  });

  const recipe = {
    id: 'themealdb-3',
    external: true,
    baseServings: 2,
    ingredients: [{ name: 'spinach', amount: 200, unit: 'g' }]
  };
  await rs.fetchAHMatches(recipe);

  assert.deepEqual(queries, ['spinazie']);
});
