import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { normalizeIngredient } from '../js/ingredient-canonical.js';

const DATA = resolve('data');

/**
 * Reads a data file, returning null when the pipeline has not run yet.
 * @param {string} path
 * @returns {*}
 */
function readData(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const catalog = readData(resolve(DATA, 'catalog.json'));
const products = readData(resolve(DATA, 'products.json'));
const prices = readData(resolve(DATA, 'prices.json'));
const meta = readData(resolve(DATA, 'meta.json'));
const hasStaticData = Boolean(catalog?.length && products?.keys);

test('the committed dataset is internally consistent', t => {
  if (!hasStaticData) {
    t.skip('no static dataset committed yet');
    return;
  }

  // Catalog: unique ids, every entry has a title and a shard.
  const ids = new Set();
  for (const entry of catalog) {
    assert.ok(entry.id, 'catalog entry without id');
    assert.ok(!ids.has(entry.id), `duplicate catalog id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.title, `catalog entry ${entry.id} has no title`);
  }

  // Shards: every recipe exists in the catalog, has ingredients and steps.
  const shards = [...new Set(catalog.map(entry => entry.shard).filter(Boolean))];
  assert.ok(shards.length > 0, 'catalog references no shards');

  const keys = new Set();
  let recipes = 0;
  for (const shard of shards) {
    const path = resolve(DATA, 'recipes', shard);
    assert.ok(existsSync(path), `missing shard ${shard}`);
    const body = JSON.parse(readFileSync(path, 'utf8'));
    for (const recipe of body) {
      recipes++;
      assert.ok(ids.has(recipe.id), `shard recipe ${recipe.id} is not in the catalog`);
      assert.ok(recipe.titleEn, `recipe ${recipe.id} has no English title`);
      assert.ok(recipe.ingredients?.length, `recipe ${recipe.id} has no ingredients`);
      assert.ok(recipe.instructions?.length, `recipe ${recipe.id} has no steps`);
      for (const ingredient of recipe.ingredients) {
        assert.ok(ingredient.key, `recipe ${recipe.id} has an ingredient without key`);
        assert.ok(ingredient.name, `recipe ${recipe.id} has an ingredient without name`);
        keys.add(ingredient.key);
      }
    }
  }
  assert.equal(recipes, catalog.filter(entry => entry.shard).length, 'shard recipes and catalog entries must match');

  // Every ingredient key resolves in products.json, by its own key or alias.
  let missingEntries = 0;
  for (const key of keys) {
    const entry = products.keys[key];
    if (!entry) {
      missingEntries++;
      continue;
    }
    const target = normalizeIngredient(key);
    const names = [entry.key, entry.nameNl, entry.nameEn, ...(entry.aliases || [])].map(normalizeIngredient);
    assert.ok(names.includes(target), `product key ${key} is not resolvable by its own name`);
  }
  // A partially built dataset is allowed while the pipeline fills in, but it
  // must not be the majority.
  assert.ok(missingEntries <= keys.size * 0.5, `${missingEntries} of ${keys.size} ingredient keys have no product entry`);

  // Every stored option has a price.
  assert.ok(prices?.prices, 'prices.json is missing');
  let options = 0;
  let unpriced = 0;
  for (const entry of Object.values(products.keys)) {
    for (const option of entry.options || []) {
      options++;
      if (!prices.prices[option.productId]) unpriced++;
    }
  }
  assert.ok(options > 0, 'no product options stored');
  assert.ok(unpriced <= options * 0.1, `${unpriced} of ${options} product options have no price`);

  // Licence and provenance are recorded for the corpus.
  assert.ok(meta?.sources?.some(source => /CC BY-NC-SA/.test(source.licence || '')), 'the dataset licence must be recorded');
});

test('the dataset only ships dinner recipes', t => {
  if (!hasStaticData) {
    t.skip('no static dataset committed yet');
    return;
  }
  const desserts = /cake|cookie|brownie|muffin|cupcake|dessert|pudding|smoothie|pie\b|tart\b|meringue|fudge|toffee/i;
  const offenders = catalog.filter(entry => entry.source === 'dataset' && desserts.test(entry.title));
  assert.deepEqual(offenders.map(entry => entry.title), [], 'dessert titles should not be in the dinner dataset');
});

test('the price snapshot is recent enough to be useful', t => {
  if (!prices?.generatedAt) {
    t.skip('no price snapshot committed yet');
    return;
  }
  const generated = Date.parse(prices.generatedAt);
  assert.ok(Number.isFinite(generated), 'prices.json has no valid generatedAt');
  const days = (Date.now() - generated) / (24 * 60 * 60 * 1000);
  // The Monday job refreshes weekly; two missed runs is a signal, not a hard
  // failure, so warn loudly instead of failing the build.
  if (days > 21) {
    console.warn(`Price snapshot is ${Math.round(days)} days old; the weekly job may not be running.`);
  }
  assert.ok(days < 400, 'price snapshot is older than the app should accept');
});

test('the dataset stores metric amounts only', t => {
  if (!hasStaticData) {
    t.skip('no static dataset committed yet');
    return;
  }
  const metricUnits = new Set(['', 'g', 'kg', 'ml', 'l',
    'piece', 'clove', 'slice', 'can', 'pkg', 'bunch', 'sprig', 'leaf', 'handful', 'dash', 'pinch', 'head']);
  const imperial = /\b(cups?|tbsp|tblsp|tbs|tsp|teaspoons?|tablespoons?|oz|ounces?|lbs?|pounds?|pints?|quarts?|gallons?|fl oz)\b/i;
  const badUnits = new Set();
  const badNames = new Set();
  for (const entry of catalog) {
    if (!entry.shard) continue;
    const path = resolve(DATA, 'recipes', entry.shard);
    for (const recipe of JSON.parse(readFileSync(path, 'utf8'))) {
      for (const ingredient of recipe.ingredients) {
        if (!metricUnits.has(ingredient.unit || '')) badUnits.add(ingredient.unit);
        if (imperial.test(ingredient.name || '') || imperial.test(ingredient.nameEn || '')) badNames.add(ingredient.nameEn);
      }
    }
  }
  assert.deepEqual([...badUnits], [], 'every unit must be metric or a counted unit');
  assert.deepEqual([...badNames], [], 'no ingredient name may carry an imperial measurement');
});

test('every catalogue entry carries a price and a recommendation score', t => {
  if (!hasStaticData) {
    t.skip('no static dataset committed yet');
    return;
  }
  const missing = catalog.filter(entry => !entry.price || !Number.isFinite(entry.recommendation));
  assert.deepEqual(missing.map(entry => entry.id), [], 'the grid cannot price or rank these recipes');

  // The stored price has to be a plausible dinner for a whole recipe.
  const totals = catalog.map(entry => entry.price.total).filter(value => Number.isFinite(value));
  assert.ok(totals.length === catalog.length, 'every price needs a total');
  assert.ok(totals.every(value => value >= 0 && value <= 200), 'a recipe total between €0 and €200');

  const scored = catalog.map(entry => entry.recommendation);
  assert.ok(scored.every(value => value >= 0 && value <= 100), 'scores are 0..100');
  // A ranking where everything scores the same would be no ranking at all.
  assert.ok(new Set(scored).size > 5, 'scores must spread across recipes');

  // Most of the recipe should be priced, or the estimate is meaningless.
  const coverage = catalog.reduce((sum, entry) => {
    const total = Number(entry.ingredientCount) || 0;
    return sum + (total ? entry.price.priced / total : 0);
  }, 0) / catalog.length;
  assert.ok(coverage > 0.5, `mean price coverage is ${(coverage * 100).toFixed(1)}%`);
});
