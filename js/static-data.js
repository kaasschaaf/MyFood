/**
 * Static data access for the app.
 *
 * The pipeline writes three files that the app reads directly:
 *   data/products.json  ingredient key -> matched AH products (+ nutrition)
 *   data/prices.json    product id -> price snapshot
 *   data/meta.json      build stamps and licence
 *
 * Merging them gives the same product shape the live AH search produces, so
 * recipes can be priced from the snapshot with the existing pricing math.
 */

import { calculateQuantityCost } from './ah-pricing.js';
import { rankProductsForIngredient } from './ingredient-matching.js';
import { isOnlineOnlyProduct } from './ah-product.js';

/**
 * Combines a stored product option with the latest price snapshot.
 * @param {Object} option entry from products.json
 * @param {Object|null} price entry from prices.json
 * @returns {Object|null} null when there is no price
 */
export function mergeProductPrice(option, price) {
  if (!option || !price) return null;
  const merged = {
    id: option.productId,
    title: option.title,
    price: Number(price.price),
    regularPrice: Number(price.regularPrice ?? price.price),
    unitSize: price.unitSize || option.unitSize || '',
    unitPriceDescription: option.unitPriceDescription || '',
    isBonus: Boolean(price.isBonus),
    bonusDescription: price.bonusDescription || '',
    imageUrl: option.imageUrl || '',
    productUrl: option.productUrl || '',
    nutriScore: option.nutriScore || '',
    mainCategory: option.mainCategory || '',
    subCategory: option.subCategory || '',
    availableOnline: price.availableOnline !== false,
    isOnlineOnly: Boolean(price.isOnlineOnly),
    isOrderable: true,
    caloriesPer100: option.caloriesPer100 ?? null,
    proteinGrams: option.proteinGrams ?? null,
    proteinScore: option.proteinScore ?? null,
    matchesIngredient: option.matchesIngredient !== false,
    // The snapshot carries the nutrition it has; no live detail call needed.
    nutritionStatic: true,
    cachedMatch: true
  };
  if (!Number.isFinite(merged.price) || merged.price <= 0) return null;
  return merged;
}

/**
 * Builds the product list for one ingredient key.
 * @param {Object} products products.json
 * @param {Object} prices prices.json
 * @param {string} key
 * @returns {Object[]}
 */
export function productsForKey(products, prices, key) {
  const entry = products?.keys?.[key];
  if (!entry) return [];
  return (entry.options || [])
    .map(option => mergeProductPrice(option, prices?.prices?.[option.productId]))
    .filter(Boolean);
}

/**
 * Chooses the product for an ingredient: the visitor's saved match when it is
 * still available, otherwise the cheapest option that really is the ingredient
 * and fits the amount.
 * @param {Object} ingredient
 * @param {Object[]} options
 * @param {Object|null} saved
 * @returns {{ selected: Object|null, options: Object[] }}
 */
export function selectStaticProduct(ingredient, options = [], saved = null) {
  const allowed = options.filter(option => !option.isOnlineOnly);
  const visible = allowed.length ? allowed : options;
  const savedMatch = saved && visible.find(option => option.id === saved.id);
  if (savedMatch) return { selected: savedMatch, options: visible };

  const ranked = rankProductsForIngredient(ingredient, visible, 1, { quantityCost: calculateQuantityCost });
  const best = ranked.find(entry => entry.relevant && entry.cost !== null && !entry.oversized) ||
    ranked.find(entry => entry.relevant) ||
    null;
  return { selected: best?.product || null, options: visible };
}

/**
 * Whether a stored product is only available online.
 * @param {Object} product
 * @returns {boolean}
 */
export function isStaticOnlineOnly(product) {
  return Boolean(product?.isOnlineOnly) || isOnlineOnlyProduct(product);
}
