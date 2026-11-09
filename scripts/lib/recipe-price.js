/**
 * Prices recipes from the static snapshot, for the data pipeline.
 *
 * The grid needs a price before it loads any recipe body, so the pipeline
 * stores one estimate per recipe in `data/catalog.json`. The maths is the same
 * `js/ah-pricing.js` code the app runs, and the product choice is the same
 * `js/static-data.js` ranking, so a stored price and a freshly computed price
 * agree.
 */

import { recipePriceEstimate } from '../../js/ah-pricing.js';
import { recommendationScore } from '../../js/recipe-ranking.js';
import { productsForKey, selectStaticProduct } from '../../js/static-data.js';
import { DATA_DIR, writeJson } from './data.js';
import { readJsonFile } from './cli.js';
import { resolve } from 'node:path';

/**
 * Attaches the chosen snapshot product to every ingredient of a recipe.
 * @param {Object} recipe
 * @param {Object} products products.json
 * @param {Object} prices prices.json
 * @returns {Object} the same recipe
 */
export function selectProducts(recipe, products, prices) {
  (recipe?.ingredients || []).forEach(ingredient => {
    const options = productsForKey(products, prices, ingredient.key);
    const { selected } = selectStaticProduct(ingredient, options, null);
    ingredient.selectedAHProduct = selected;
  });
  return recipe;
}

/**
 * Price estimate for one recipe, in the shape `calculateRecipePrice` returns.
 *
 * Every shard recipe is priced from the snapshot, exactly like the app does
 * (`staticPriced`), so the stored estimate matches what the card shows after
 * the body is loaded.
 * @param {Object} recipe
 * @param {Object} products
 * @param {Object} prices
 * @returns {Object}
 */
export function priceRecipe(recipe, products, prices) {
  recipe.staticPriced = true;
  selectProducts(recipe, products, prices);
  return recipePriceEstimate(recipe, recipe.baseServings || 2);
}

/**
 * Compacts a price estimate for `data/catalog.json`.
 *
 * The grid needs a price for 2 000 recipes in one file, so only the fields it
 * renders are stored; the rest is derived. `ingredientCount` already lives on
 * the catalogue entry.
 * @param {Object} price
 * @returns {{total: number, savings: number, bonus: boolean, matched: number,
 *   priced: number, full: boolean}}
 */
export function compactPrice(price) {
  return {
    total: price.totalPrice,
    savings: price.totalSavings,
    bonus: price.hasBonus,
    matched: price.matchedIngredientCount,
    priced: price.pricedIngredientCount,
    full: price.hasPriceData
  };
}

/**
 * Builds the catalogue price and score for every recipe.
 *
 * @param {Object[]} recipes full recipes from the shards
 * @param {Object} products
 * @param {Object} prices
 * @returns {Map<string, { price: Object, recommendation: number }>} keyed by id
 */
export function catalogMetrics(recipes, products, prices) {
  const metrics = new Map();
  recipes.forEach(recipe => {
    const price = priceRecipe(recipe, products, prices);
    metrics.set(recipe.id, {
      price: compactPrice(price),
      recommendation: recommendationScore(recipe, price)
    });
  });
  return metrics;
}

/**
 * Writes the per-recipe price estimate and recommendation score into
 * `data/catalog.json`.
 *
 * The grid renders from the catalogue alone, so without this it cannot show a
 * price, cannot sort by price, and cannot rank anything — it would fall back to
 * the order the file happens to have.
 *
 * Both pipeline scripts call this: `build-products` when products change and
 * `refresh-prices` after every weekly snapshot, so a stored price never lags
 * the prices file.
 *
 * @param {Object[]} recipes full recipes from the shards
 * @param {Object} products products.json
 * @param {Object} prices prices.json
 * @returns {{total: number, priced: number, coverage: number, meanScore: number}}
 */
export function writeCatalogMetrics(recipes, products, prices) {
  const path = resolve(DATA_DIR, 'catalog.json');
  const catalog = readJsonFile(path, []);
  if (!catalog.length) return { total: 0, priced: 0, coverage: 0, meanScore: 0 };

  const metrics = catalogMetrics(recipes, products, prices);
  let priced = 0;
  let coverage = 0;
  let scoreTotal = 0;
  let scored = 0;

  catalog.forEach(entry => {
    const metric = metrics.get(entry.id);
    if (!metric) return;
    entry.price = metric.price;
    entry.recommendation = metric.recommendation;
    scoreTotal += metric.recommendation;
    scored++;
    if (metric.price.full) priced++;
    const total = Number(entry.ingredientCount) || 0;
    coverage += total ? metric.price.priced / total : 0;
  });

  writeJson(path, catalog);
  return {
    total: catalog.length,
    priced,
    coverage: coverage / catalog.length,
    meanScore: scoreTotal / Math.max(scored, 1)
  };
}
