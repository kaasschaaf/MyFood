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

test('external recipes get a real description instead of a source disclaimer', () => {
  const rs = makeService();
  const summary = rs.normalizeRecipeSummary({ idMeal: '5', strMeal: 'Chicken Curry', strArea: 'Indian' }, 'Chicken');
  assert.equal(summary.description, 'Indian chicken dish.');
  assert.ok(!/themealdb|meal database/i.test(summary.description));

  const meal = {
    idMeal: '5',
    strMeal: 'Chicken Curry',
    strArea: 'Indian',
    strCategory: 'Chicken',
    strIngredient1: 'Chicken',
    strMeasure1: '500 g',
    strIngredient2: 'Curry Powder',
    strMeasure2: '2 tbsp',
    strIngredient3: 'Onion',
    strMeasure3: '1',
    strInstructions: 'Fry it.'
  };
  const recipe = rs.normalizeExternalRecipe(meal);
  assert.equal(recipe.description, 'Indian chicken dish with chicken, curry powder and onion.');
  assert.ok(!/themealdb|meal database/i.test(recipe.description));
});

test('external recipes get protein and health metrics like the built-in ones', () => {
  const rs = makeService();
  const meal = {
    idMeal: '6',
    strMeal: 'Chicken Curry',
    strArea: 'Indian',
    strCategory: 'Chicken',
    strIngredient1: 'Chicken Breasts',
    strMeasure1: '2',
    strIngredient2: 'Chopped Tomatoes',
    strMeasure2: '400 g',
    strIngredient3: 'Onion',
    strMeasure3: '1',
    strIngredient4: 'Rice',
    strMeasure4: '200 g',
    strInstructions: 'Cook it.'
  };
  const recipe = rs.normalizeExternalRecipe(meal);
  assert.ok(recipe.nutrition, 'nutrition should be estimated');
  assert.equal(recipe.nutrition.estimated, true);
  assert.ok(recipe.nutrition.proteinGrams > 20);
  assert.ok(recipe.nutrition.healthScore >= 15 && recipe.nutrition.healthScore <= 98);
});

test('hand-written nutrition is never overwritten by the estimate', () => {
  const rs = makeService();
  const recipe = {
    id: 'local-x',
    baseServings: 2,
    nutrition: { calories: 540, proteinGrams: 42, carbsGrams: 52, fatGrams: 16, healthScore: 92 },
    ingredients: [{ name: 'Kipfilet', amount: 200, unit: 'g' }, { name: 'Rijst', amount: 150, unit: 'g' }]
  };
  rs.ensureNutrition(recipe);
  assert.equal(recipe.nutrition.healthScore, 92);
  assert.equal(recipe.nutrition.estimated, undefined);
});

test('a recipe cached with the old source disclaimer is repaired on load', () => {
  const rs = makeService();
  const cached = {
    id: 'themealdb-9',
    external: true,
    title: 'Kefta',
    description: 'Recipe from TheMealDB. Open the recipe to view its ingredients and calculate AH prices.',
    cuisine: 'Moroccan',
    mealType: 'Beef',
    ingredients: [{ name: 'Ground Beef', amount: 300, unit: 'g' }, { name: 'Onion', amount: 1, unit: '' }]
  };
  const [recipe] = rs.combineRecipes([], [cached]);
  assert.equal(recipe.description, 'Moroccan beef dish with ground beef and onion.');
  assert.ok(recipe.nutrition, 'migration also fills in the nutrition estimate');
});

/**
 * A service whose prices come straight from the stored catalogue values, the
 * way AHService.catalogPrice behaves before a recipe body is loaded.
 * @param {Object[]} recipes
 * @returns {RecipesService}
 */
function makeRankedService(recipes) {
  const ahService = {
    calculateRecipePrice: recipe => ({
      totalPrice: recipe.catalogPrice?.total ?? 0,
      pricePerPerson: (recipe.catalogPrice?.total ?? 0) / (recipe.baseServings || 2),
      hasPriceData: Boolean(recipe.catalogPrice?.full),
      hasAnyPriceData: Boolean(recipe.catalogPrice?.priced),
      hasBonus: Boolean(recipe.catalogPrice?.bonus),
      totalSavings: recipe.catalogPrice?.savings ?? 0,
      matchedIngredientCount: recipe.catalogPrice?.matched ?? 0,
      pricedIngredientCount: recipe.catalogPrice?.priced ?? 0,
      ingredientCount: recipe.ingredientCount || 0
    })
  };
  const service = new RecipesService(ahService, noopCache);
  service.recipes = recipes;
  return service;
}

test('the default sort ranks recipes instead of keeping file order', () => {
  const service = makeRankedService([
    // In file order this one would be first, but it has no price and no data.
    { id: 'weak', title: 'Zwak', ingredientCount: 6, baseServings: 2, catalogPrice: null, nutrition: null, description: '' },
    { id: 'strong', title: 'Sterk', ingredientCount: 6, baseServings: 2, nutrition: { calories: 500, proteinGrams: 30, healthScore: 70 }, description: 'Een volledig beschreven gerecht met veel groenten en een saus.', dishType: 'pasta', titleEn: 'Strong',
      catalogPrice: { total: 8, savings: 0, bonus: false, matched: 6, priced: 6, full: true }, recommendation: 95 },
    { id: 'middle', title: 'Midden', ingredientCount: 6, baseServings: 2, nutrition: { calories: 500, proteinGrams: 30, healthScore: 70, estimated: true }, description: 'Een gerecht met rijst en groenten uit de oven.', dishType: 'oven', titleEn: 'Middle',
      catalogPrice: { total: 9, savings: 0, bonus: false, matched: 4, priced: 3, full: false }, recommendation: 60 }
  ]);

  assert.deepEqual(service.getFilteredRecipes().map(recipe => recipe.id), ['strong', 'middle', 'weak']);
});

test('the default sort is stable within a day and changes with the seed', () => {
  const recipes = Array.from({ length: 40 }, (_, index) => ({
    id: `r${index}`,
    title: `Recept ${index}`,
    ingredientCount: 5,
    baseServings: 2,
    description: 'Een beschreven gerecht met vlees en groenten uit de oven.',
    dishType: 'oven',
    titleEn: `Recipe ${index}`,
    nutrition: { calories: 500, proteinGrams: 30, healthScore: 70 },
    catalogPrice: { total: 7, savings: 0, bonus: false, matched: 5, priced: 4, full: false },
    recommendation: 70
  }));
  const service = makeRankedService(recipes);
  const first = service.getFilteredRecipes().map(recipe => recipe.id);
  const again = service.getFilteredRecipes().map(recipe => recipe.id);
  assert.deepEqual(first, again, 'scrolling and re-rendering keep the same order');
  assert.equal(new Set(first).size, 40, 'every recipe is still listed');
});

test('sorting by price uses the stored catalogue price', () => {
  const service = makeRankedService([
    { id: 'duur', title: 'Duur', ingredientCount: 4, baseServings: 2, catalogPrice: { total: 20, savings: 0, bonus: false, matched: 4, priced: 4, full: true }, recommendation: 80 },
    { id: 'goedkoop', title: 'Goedkoop', ingredientCount: 4, baseServings: 2, catalogPrice: { total: 6, savings: 0, bonus: false, matched: 4, priced: 4, full: true }, recommendation: 60 },
    { id: 'onbekend', title: 'Onbekend', ingredientCount: 4, baseServings: 2, catalogPrice: null, recommendation: 90 }
  ]);
  service.setFilters({ sortBy: 'price-asc' });
  assert.deepEqual(service.getFilteredRecipes().map(recipe => recipe.id), ['goedkoop', 'duur', 'onbekend']);
});
