import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RecipesService } from '../js/recipes-service.js';
import { mergeProductPrice, productsForKey, selectStaticProduct } from '../js/static-data.js';

const noopCache = { get: async () => null, set: async () => ({ updatedAt: Date.now() }) };

const products = {
  keys: {
    rundergehakt: {
      key: 'rundergehakt',
      nameNl: 'rundergehakt',
      nameEn: 'ground beef',
      aliases: ['rundergehakt', 'ground beef'],
      options: [
        { productId: 'p1', title: 'AH Rundergehakt 300 g', unitSize: '300 g', matchesIngredient: true, productUrl: 'https://ah.nl/1' },
        { productId: 'p2', title: 'AH Rundergehakt 1 kg', unitSize: '1 kg', matchesIngredient: true, productUrl: 'https://ah.nl/2' }
      ]
    }
  }
};

const prices = {
  generatedAt: '2026-11-09T00:00:00.000Z',
  prices: {
    p1: { price: 4.29, regularPrice: 4.29, unitSize: '300 g' },
    p2: { price: 9.99, regularPrice: 11.99, isBonus: true, bonusDescription: '2e halve prijs', unitSize: '1 kg' }
  }
};

test('a stored product is merged with the latest price', () => {
  const merged = mergeProductPrice(products.keys.rundergehakt.options[1], prices.prices.p2);
  assert.equal(merged.id, 'p2');
  assert.equal(merged.price, 9.99);
  assert.equal(merged.regularPrice, 11.99);
  assert.equal(merged.isBonus, true);
  assert.equal(merged.bonusDescription, '2e halve prijs');
  assert.equal(merged.nutritionStatic, true);
});

test('a product without a price is dropped', () => {
  assert.equal(mergeProductPrice(products.keys.rundergehakt.options[0], undefined), null);
  assert.deepEqual(productsForKey(products, { prices: {} }, 'rundergehakt'), []);
  assert.equal(productsForKey(products, prices, 'onbekend').length, 0);
});

test('the cheapest fitting product is chosen for the ingredient', () => {
  const options = productsForKey(products, prices, 'rundergehakt');
  const { selected } = selectStaticProduct({ name: 'rundergehakt', amount: 300, unit: 'g', key: 'rundergehakt' }, options, null);
  // A fifth of a kilo pack (€3.00) is cheaper than the whole 300 g pack
  // (€4.29), so the kilo pack wins for 300 g — the same rule the recipe
  // ranking uses.
  assert.equal(selected.id, 'p2');
});

test('a saved choice wins over the default', () => {
  const options = productsForKey(products, prices, 'rundergehakt');
  const { selected } = selectStaticProduct(
    { name: 'rundergehakt', amount: 300, unit: 'g', key: 'rundergehakt' },
    options,
    { id: 'p2' }
  );
  assert.equal(selected.id, 'p2');
});

test('online-only products are not chosen by default', () => {
  const options = productsForKey(products, prices, 'rundergehakt');
  options[0] = { ...options[0], isOnlineOnly: true, price: 0.5 };
  const { selected, options: visible } = selectStaticProduct(
    { name: 'rundergehakt', amount: 300, unit: 'g', key: 'rundergehakt' },
    options,
    null
  );
  assert.equal(selected.id, 'p2');
  assert.equal(visible.length, 1);
});

test('a catalog entry becomes a recipe the grid can use', () => {
  const rs = new RecipesService({}, noopCache);
  const recipe = rs.catalogToRecipe({
    id: 'r-x',
    shard: '000.json',
    title: 'Beef Chili',
    titleEn: 'Beef Chili',
    description: 'Een hoofdgerecht met gehakt.',
    descriptionEn: 'A main course with beef.',
    cuisine: 'Internationaal',
    mealType: 'Hoofdgerecht',
    dishType: 'stoof-curry',
    baseServings: 4,
    nutrition: { proteinGrams: 30, healthScore: 70 },
    tags: ['diner'],
    ingredientCount: 7,
    source: 'dataset'
  });
  assert.equal(recipe.id, 'r-x');
  assert.equal(recipe.shard, '000.json');
  assert.equal(recipe.titleEn, 'Beef Chili');
  assert.equal(recipe.ahRecipeOnly, false);
  assert.deepEqual(recipe.ingredients, []);
  assert.equal(recipe.ingredientCount, 7);
});

test('an Allerhande catalog entry becomes a link-only card', () => {
  const rs = new RecipesService({}, noopCache);
  const recipe = rs.catalogToRecipe({ id: 'ah-allerhande-1', title: 'Chocoladeperen', source: 'allerhande', sourceUrl: 'https://www.ah.nl/x' });
  assert.equal(recipe.ahRecipeOnly, true);
  assert.equal(recipe.sourceUrl, 'https://www.ah.nl/x');
});

test('decorating a recipe attaches the stored products and prices it', () => {
  const priced = [];
  const ahService = {
    calculateRecipePrice: recipe => {
      priced.push(recipe.id);
      return { totalPrice: 4.29, pricePerPerson: 2.15, hasPriceData: true };
    }
  };
  const rs = new RecipesService(ahService, noopCache);
  rs.static = { products, prices, meta: null, loaded: true };
  rs.savedMatches = new Map();
  const recipe = {
    id: 'r-x',
    baseServings: 2,
    ingredients: [{ name: 'rundergehakt', key: 'rundergehakt', amount: 300, unit: 'g' }]
  };
  rs.decorateStaticRecipe(recipe);
  assert.equal(recipe.ingredients[0].ahProductOptions.length, 2);
  assert.equal(recipe.ingredients[0].selectedAHProduct.id, 'p2');
  assert.equal(recipe.ingredients[0].staticOptions, true);
  assert.deepEqual(priced, ['r-x']);
  assert.equal(recipe.priceEstimate.pricePerPerson, 2.15);
  assert.ok(recipe.priceUpdatedAt > 0, 'price timestamp comes from the snapshot');
});
