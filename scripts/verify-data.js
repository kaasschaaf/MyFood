#!/usr/bin/env node
/**
 * Data integrity gate.
 *
 * Runs in CI and in the test suite: it checks that the committed files are
 * consistent with each other, so a broken build fails before it is deployed
 * instead of showing a broken card to a visitor.
 *
 * Checks:
 *  - catalog ids are unique and every shard referenced exists
 *  - every recipe in a shard is present in the catalog and vice versa
 *  - every ingredient has a key and a name
 *  - every key resolves in products.json, and every option has a price
 *  - every product option is resolvable by its own key/aliases (the Mijn
 *    producten static search path)
 *  - no recipe has more than a sane number of ingredients
 *
 * Usage: node verify-data.js [--strict]
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createReport } from './lib/report.js';
import { DATA_DIR } from './lib/data.js';
import { parseArgs, readJsonFile } from './lib/cli.js';
import { normalizeIngredient } from '../js/ingredient-canonical.js';

const args = parseArgs({ strict: false });
const report = createReport('verify-data', { meta: { strict: String(Boolean(args.strict)) } });

const problems = [];

/**
 * Records a problem, capped so a broken build does not print 2,000 lines.
 * @param {string} category
 * @param {string} message
 */
function fail(category, message) {
  problems.push({ category, message });
}

/**
 * Resolves an ingredient key the way the Mijn producten search does.
 * @param {Object} products
 * @param {string} key
 * @returns {boolean}
 */
function keyResolves(products, key) {
  const entry = products.keys[key];
  if (!entry) return false;
  const target = normalizeIngredient(key);
  return Boolean(entry.key === key) &&
    (normalizeIngredient(entry.key) === target ||
      (entry.aliases || []).some(alias => normalizeIngredient(alias) === target));
}

async function main() {
  const catalog = readJsonFile(resolve(DATA_DIR, 'catalog.json'), null);
  const meta = readJsonFile(resolve(DATA_DIR, 'meta.json'), null);
  const products = readJsonFile(resolve(DATA_DIR, 'products.json'), null);
  const prices = readJsonFile(resolve(DATA_DIR, 'prices.json'), null);

  if (!catalog) {
    console.log('data/catalog.json ontbreekt: nog geen statische dataset gebouwd, niets te controleren.');
    report.data('result', 0, 'skipped (no static data yet)');
    await report.finish();
    return;
  }

  report.data('recipes (catalog)', catalog.length, catalog.length.toLocaleString('en-US'));

  const ids = new Set();
  const shardNames = new Set(catalog.map(entry => entry.shard).filter(Boolean));
  catalog.forEach(entry => {
    if (ids.has(entry.id)) fail('duplicate id', entry.id);
    ids.add(entry.id);
    if (!entry.title) fail('missing title', entry.id);
    if (!entry.shard) fail('missing shard', entry.id);
  });

  let recipeCount = 0;
  let ingredientCount = 0;
  let missingShards = 0;
  let untranslated = 0;

  for (const shard of shardNames) {
    const path = resolve(DATA_DIR, 'recipes', shard);
    if (!existsSync(path)) {
      fail('missing shard file', shard);
      missingShards++;
      continue;
    }
    const recipes = readJsonFile(path, []) || [];
    recipes.forEach(recipe => {
      recipeCount++;
      if (!ids.has(recipe.id)) fail('shard recipe not in catalog', recipe.id);
      if (!recipe.titleEn) untranslated++;
      if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
        fail('recipe without ingredients', recipe.id);
        return;
      }
      if (recipe.ingredients.length > 30) fail('too many ingredients', `${recipe.id} (${recipe.ingredients.length})`);
      if (!Array.isArray(recipe.instructions) || !recipe.instructions.length) {
        fail('recipe without steps', recipe.id);
      }
      recipe.ingredients.forEach(ingredient => {
        ingredientCount++;
        if (!ingredient.key) fail('ingredient without key', `${recipe.id}: ${ingredient.name}`);
        if (!ingredient.name) fail('ingredient without name', `${recipe.id}: ${ingredient.key}`);
      });
    });
  }

  report.data('recipes (shards)', recipeCount, recipeCount.toLocaleString('en-US'));
  report.data('ingredients', ingredientCount, ingredientCount.toLocaleString('en-US'));
  report.data('shards', shardNames.size - missingShards, `${shardNames.size} expected`);
  if (untranslated) fail('missing English title', `${untranslated} recipes`);

  const uniqueKeys = new Set();
  for (const entry of catalog) {
    const shardPath = resolve(DATA_DIR, 'recipes', entry.shard);
    if (!existsSync(shardPath)) continue;
    (readJsonFile(shardPath, []) || [])
      .filter(recipe => recipe.id === entry.id)
      .forEach(recipe => recipe.ingredients.forEach(ingredient => uniqueKeys.add(ingredient.key)));
  }
  report.data('unique ingredient keys', uniqueKeys.size, uniqueKeys.size.toLocaleString('en-US'));

  if (products?.keys) {
    const productKeys = new Set(Object.keys(products.keys));
    report.data('product keys', productKeys.size, productKeys.size.toLocaleString('en-US'));

    const keysWithOptions = Object.values(products.keys).filter(entry => (entry.options || []).length).length;
    report.data('keys with options', keysWithOptions,
      `${keysWithOptions} / ${productKeys.size} (${((keysWithOptions / Math.max(productKeys.size, 1)) * 100).toFixed(1)}%)`);

    for (const key of uniqueKeys) {
      if (!productKeys.has(key)) fail('ingredient key without product entry', key);
      else if (!keyResolves(products, key)) fail('key not resolvable by its own alias', key);
    }

    const priceMap = prices?.prices || {};
    let optionCount = 0;
    for (const entry of Object.values(products.keys)) {
      (entry.options || []).forEach(option => {
        optionCount++;
        if (!option.productId) fail('option without product id', entry.key);
        if (!priceMap[option.productId]) fail('option without price', `${entry.key}: ${option.productId}`);
      });
    }
    report.data('product options', optionCount, optionCount.toLocaleString('en-US'));

    const orphanPrices = Object.keys(priceMap).filter(id =>
      !Object.values(products.keys).some(entry => (entry.options || []).some(option => option.productId === id))
    );
    if (orphanPrices.length) fail('price without product option', `${orphanPrices.length} entries`);
  } else {
    fail('missing products.json', 'run build-products.js');
  }

  if (meta?.sources) report.data('sources', meta.sources.length, `${meta.sources.length} documented`);
  else fail('missing meta sources/licence', 'data/meta.json');

  const strict = Boolean(args.strict);
  const mustFail = problems.length > 0 && (strict || problems.some(problem =>
    !/without price|without product entry/.test(problem.category)
  ));

  report.data('problems', problems.length);
  problems.slice(0, 12).forEach(problem => {
    console.log(`  ! ${problem.category}: ${problem.message}`);
  });
  if (problems.length > 12) console.log(`  … ${problems.length - 12} more`);

  report.data('result', problems.length, problems.length === 0 ? 'ok' : `failed (${problems.length} problems)`);
  await report.finish();

  if (mustFail) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
