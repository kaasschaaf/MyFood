#!/usr/bin/env node
/**
 * Builds the static product database and the first price snapshot.
 *
 * Reads the recipe shards, collects every canonical ingredient key, searches
 * Albert Heijn once per key, keeps the three best matches (same ranking rules
 * the app used live, from js/ingredient-matching.js) and stores the nutrition
 * of each chosen product. Writes:
 *
 *   data/products.json  ingredient key -> product options + nutrition
 *   data/prices.json    product id -> current price
 *
 * Product identity and nutrition change slowly, prices change weekly, so they
 * live in two files: only prices.json is refreshed by the Monday job.
 *
 * Usage:
 *   node build-products.js --limit 200     (only the first 200 keys, for a smoke test)
 *   node build-products.js --dry-run
 */

import { resolve } from 'node:path';

import { createReport } from './lib/report.js';
import { ahStats, getNutrition, searchProducts } from './lib/ah.js';
import { DATA_DIR, writeJson } from './lib/data.js';
import { parseArgs, readJsonFile } from './lib/cli.js';
import { writeCatalogMetrics } from './lib/recipe-price.js';
import { normalizeProduct } from '../js/ah-product.js';
import { ingredientHeadword, rankProductsForIngredient } from '../js/ingredient-matching.js';
import { calculateQuantityCost, normalizeQuantity, parsePackageSize } from '../js/ah-pricing.js';

const args = parseArgs({ limit: 0, 'dry-run': false, concurrency: 3, 'options-per-key': 3, 'only-missing': false });
const OPTIONS_PER_KEY = Number(args['options-per-key']) || 3;
const LIMIT = Number(args.limit) || 0;

const report = createReport('build-products', { meta: { limit: String(LIMIT || 'all') } });
let nutritionAvailable = 0;
let nutritionUnavailable = 0;

/**
 * Loads every recipe from the shards.
 * @returns {Object[]}
 */
function loadRecipes() {
  const catalog = readJsonFile(resolve(DATA_DIR, 'catalog.json'), []);
  const shards = [...new Set(catalog.map(entry => entry.shard).filter(Boolean))];
  return shards.flatMap(shard => readJsonFile(resolve(DATA_DIR, 'recipes', shard), []) || []);
}

/**
 * Collects the canonical ingredients with their display names.
 * @param {Object[]} recipes
 * @returns {Map<string, { key: string, nameNl: string, nameEn: string, aliases: Set<string> }>}
 */
function collectIngredients(recipes) {
  const keys = new Map();
  recipes.forEach(recipe => {
    (recipe.ingredients || []).forEach(ingredient => {
      const key = ingredient.key;
      if (!key) return;
      if (!keys.has(key)) {
        keys.set(key, {
          key,
          nameNl: ingredient.name || key,
          nameEn: ingredient.nameEn || ingredient.name || key,
          aliases: new Set([key])
        });
      }
      const entry = keys.get(key);
      if (ingredient.name) entry.aliases.add(ingredient.name.toLowerCase());
      if (ingredient.nameEn) entry.aliases.add(ingredient.nameEn.toLowerCase());
      entry.aliases.add(key);
    });
  });
  return keys;
}

/**
 * Maps a normalised product onto the stored option shape.
 * @param {Object} product
 * @param {Object} nutrition
 * @param {boolean} matchesIngredient
 * @returns {Object}
 */
function toOption(product, nutrition, matchesIngredient) {
  return {
    productId: product.id,
    title: product.title,
    unitSize: product.unitSize,
    unitPriceDescription: product.unitPriceDescription,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    nutriScore: product.nutriScore,
    mainCategory: product.mainCategory,
    subCategory: product.subCategory,
    caloriesPer100: nutrition.caloriesPer100,
    proteinGrams: nutrition.proteinGrams,
    proteinScore: nutrition.proteinScore,
    matchesIngredient
  };
}

/**
 * The price snapshot entry for one product.
 * @param {Object} product
 * @returns {Object}
 */
function toPrice(product) {
  return {
    price: product.price,
    regularPrice: product.regularPrice,
    isBonus: product.isBonus,
    bonusDescription: product.bonusDescription,
    unitSize: product.unitSize,
    availableOnline: product.availableOnline,
    isOnlineOnly: product.isOnlineOnly,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Looks up one ingredient key.
 * @param {{ key: string, nameNl: string, nameEn: string }} entry
 * @returns {Promise<{ entry: Object, options: Object[], prices: Object, candidates: number, relevant: number }>}
 */
async function lookupIngredient(entry) {
  // The stored name is the best query, but plenty of ingredient names are
  // compounds AH does not index ("kippenbouillonblokje"). Fall back to the core
  // noun and the English name before giving up.
  const headword = ingredientHeadword(entry.nameNl || entry.key);
  const queries = [...new Set([
    entry.nameNl || entry.key,
    headword,
    entry.nameEn
  ].filter(query => query && query.length > 1))];

  let chosen = [];
  let products = [];
  let relevantCount = 0;
  for (const query of queries) {
    const raw = await searchProducts(query);
    products = raw.map(normalizeProduct).filter(Boolean);
    const ranked = rankProductsForIngredient(
      { name: entry.key, searchQuery: entry.key },
      products,
      1,
      { packageSize: parsePackageSize, normalizeQuantity, quantityCost: calculateQuantityCost }
    );
    const relevant = ranked.filter(item => item.relevant);
    relevantCount = Math.max(relevantCount, relevant.length);
    if (relevant.length) {
      chosen = relevant.slice(0, OPTIONS_PER_KEY);
      break;
    }
    // Nothing relevant: keep the best effort only if no later query does better.
    if (!chosen.length) chosen = ranked.slice(0, OPTIONS_PER_KEY);
  }

  const options = [];
  const prices = {};
  for (const item of chosen) {
    let nutrition = { caloriesPer100: null, proteinGrams: null, proteinScore: null };
    try {
      nutrition = await getNutrition(item.product.id);
      nutritionAvailable++;
    } catch (error) {
      nutritionUnavailable++;
      // AH's detail endpoint is undocumented and sometimes 404s; the product
      // is still usable, it just has no protein figure.
      if (nutritionUnavailable <= 3) {
        console.warn(`  nutrition unavailable for ${item.product.id}: ${error.message}`);
      }
    }
    options.push(toOption(item.product, nutrition, item.relevant));
    prices[item.product.id] = toPrice(item.product);
  }

  return {
    entry,
    options,
    prices,
    candidates: products.length,
    relevant: relevantCount
  };
}

/**
 * Runs lookups with limited concurrency.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} callback
 * @returns {Promise<Array>}
 */
async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await callback(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const recipes = loadRecipes();
  report.data('recipes', recipes.length);

  const ingredients = collectIngredients(recipes);
  const entries = [...ingredients.values()];
  report.data('ingredient keys', entries.length, `${entries.length.toLocaleString('en-US')} unique`);

  if (args['dry-run']) {
    report.data('mode', 'dry-run (nothing written)');
    await report.finish();
    return;
  }

  const previousProducts = readJsonFile(resolve(DATA_DIR, 'products.json'), null);
  const previousPrices = readJsonFile(resolve(DATA_DIR, 'prices.json'), null);
  const products = {
    generatedAt: new Date().toISOString(),
    version: 1,
    keys: { ...(previousProducts?.keys || {}) }
  };
  const prices = {
    generatedAt: new Date().toISOString(),
    version: 1,
    prices: { ...(previousPrices?.prices || {}) }
  };

  // --only-missing retries just the keys that ended up without a product, so a
  // partially filled database can be improved without redoing 2 000 searches.
  const candidatesForRun = args['only-missing']
    ? entries.filter(entry => !(products.keys[entry.key]?.options || []).length)
    : entries;
  const targets = LIMIT > 0 ? candidatesForRun.slice(0, LIMIT) : candidatesForRun;
  if (args['only-missing']) {
    report.data('already matched', entries.length - candidatesForRun.length,
      `${(entries.length - candidatesForRun.length).toLocaleString('en-US')} keys already had products`);
  }
  let processed = 0;
  const lookups = await report.phase('ah lookups', () => mapWithConcurrency(targets, Number(args.concurrency) || 3, async entry => {
    try {
      return await lookupIngredient(entry);
    } catch (error) {
      console.warn(`  lookup failed for "${entry.key}": ${error.message}`);
      return { entry, options: [], prices: {}, candidates: 0, relevant: 0, error: error.message };
    } finally {
      processed++;
      if (processed % 50 === 0) console.log(`  ${processed}/${targets.length} ingredients`);
    }
  }));

  let withOptions = 0;
  let withoutMatch = 0;
  let optionCount = 0;

  lookups.forEach(({ entry, options, prices: priceEntries }) => {
    products.keys[entry.key] = {
      key: entry.key,
      nameNl: entry.nameNl,
      nameEn: entry.nameEn,
      aliases: [...entry.aliases].filter(Boolean).slice(0, 12),
      queryNl: entry.nameNl || entry.key,
      options
    };
    Object.assign(prices.prices, priceEntries);
    if (options.length) {
      withOptions++;
      optionCount += options.length;
    } else {
      withoutMatch++;
    }
  });

  await report.phase('write data', async () => {
    writeJson(resolve(DATA_DIR, 'products.json'), products);
    writeJson(resolve(DATA_DIR, 'prices.json'), prices);
  });

  const catalogStats = await report.phase('price catalogue', () => writeCatalogMetrics(recipes, products, prices));
  report.data('catalogue prices', catalogStats.priced,
    `${catalogStats.priced.toLocaleString('en-US')} of ${catalogStats.total.toLocaleString('en-US')} recipes priced (mean coverage ${(catalogStats.coverage * 100).toFixed(1)}%)`);
  report.data('catalogue score', catalogStats.meanScore, `mean recommendation ${catalogStats.meanScore.toFixed(1)} / 100`);

  const stats = ahStats();
  report.data('products', Object.keys(prices.prices).length, `${Object.keys(prices.prices).length.toLocaleString('en-US')} priced products`);
  report.data('keys with options', withOptions,
    `${withOptions.toLocaleString('en-US')} / ${targets.length.toLocaleString('en-US')} (${((withOptions / Math.max(targets.length, 1)) * 100).toFixed(1)}%)`);
  report.data('keys without match', withoutMatch);
  report.data('options per key', optionCount / Math.max(withOptions, 1), (optionCount / Math.max(withOptions, 1)).toFixed(2));
  report.data('ah requests', stats.requests, `${stats.requests.toLocaleString('en-US')} requests · ${stats.failures} failed`);
  report.data('product nutrition', nutritionAvailable,
    nutritionAvailable
      ? `${nutritionAvailable} with nutrition · ${nutritionUnavailable} without`
      : `none available (AH product detail unavailable${stats.nutritionDisabled ? ', lookups disabled after repeated failures' : ''})`);
  report.size(resolve(DATA_DIR, 'products.json'));
  report.size(resolve(DATA_DIR, 'prices.json'));
  await report.finish();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
