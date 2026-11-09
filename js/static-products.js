/**
 * Static product search for the "Mijn producten" page.
 *
 * Every ingredient a recipe uses is stored once in data/products.json with the
 * AH products that match it. A visitor typing "rundergehakt" can be served from
 * that file: no request, no waiting, works offline. Only queries the dataset
 * does not cover fall through to the live AH search.
 *
 * The resolver is deliberately conservative: a broad query such as "chips"
 * matches dozens of ingredient names by substring, which is not what the
 * visitor asked for, so it goes live instead.
 */

import { normalizeIngredient } from './ingredient-canonical.js';
import { wordMatchesHeadword } from './ingredient-matching.js';
import { productsForKey } from './static-data.js';

// A fuzzy match needs this many ingredient names before it is trusted as a
// static answer.
export const STATIC_MIN_RESULTS = 8;

/**
 * Scores how well a query matches one stored ingredient entry.
 *
 * Word matching follows the same rule as AH product matching: a query word has
 * to be the whole word, a plural of it, or the tail of a compound
 * ("gehakt" → "rundergehakt", "ui" → "uien"). A plain substring check would
 * make "chips" match half the database.
 * @param {string} query normalised query
 * @param {Object} entry products.json entry
 * @returns {{ score: number, exact: boolean }}
 */
function scoreEntry(query, entry) {
  const key = normalizeIngredient(entry.key);
  const names = new Set([
    key,
    normalizeIngredient(entry.nameNl),
    normalizeIngredient(entry.nameEn),
    ...(entry.aliases || []).map(alias => normalizeIngredient(alias))
  ]);

  if (names.has(query)) return { score: 100, exact: true };

  const queryWords = query.split(' ').filter(word => word.length > 1);
  if (!queryWords.length) return { score: 0, exact: false };
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    // A one-letter "name" ("1 c cheese") must never become a static answer.
    const nameWords = name.split(' ').filter(word => word.length > 1);
    if (!nameWords.length) continue;
    const allMatched = queryWords.every(word =>
      nameWords.some(candidate => wordMatchesHeadword(candidate, word) || wordMatchesHeadword(word, candidate))
    );
    if (allMatched) best = Math.max(best, 60 + Math.min(queryWords.length, 4));
  }
  return { score: best, exact: false };
}

/**
 * Searches the static product database.
 * @param {{ keys: Object }} products products.json
 * @param {{ prices: Object }} prices prices.json
 * @param {string} query
 * @param {{ categoryLabel?: string, limit?: number }} [options]
 * @returns {{ products: Object[], matched: boolean, reason: string, updatedAt: string|null }}
 */
export function searchStaticProducts(products, prices, query, options = {}) {
  const empty = { products: [], matched: false, reason: 'empty', updatedAt: prices?.generatedAt || null };
  const normalized = normalizeIngredient(query);
  if (!normalized || !products?.keys) return empty;

  const scored = [];
  for (const entry of Object.values(products.keys)) {
    const { score, exact } = scoreEntry(normalized, entry);
    if (score > 0) scored.push({ entry, score, exact });
  }

  const exact = scored.filter(item => item.exact);
  const best = exact.length ? exact : scored;
  if (!best.length) return { ...empty, reason: 'unknown' };

  const fuzzy = !exact.length;
  if (fuzzy && scored.length < STATIC_MIN_RESULTS) {
    // Too few hits to be a real category: let the live search answer.
    return { ...empty, reason: 'few-matches' };
  }

  const category = String(options.categoryLabel || '').trim().toLocaleLowerCase('nl-NL');
  const seen = new Set();
  const productsOut = [];
  best
    .sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
    .forEach(({ entry }) => {
      for (const product of productsForKey(products, prices, entry.key)) {
        if (seen.has(product.id)) continue;
        if (category) {
          const haystack = `${product.mainCategory || ''} ${product.subCategory || ''}`.toLocaleLowerCase('nl-NL');
          if (!haystack.includes(category)) continue;
        }
        seen.add(product.id);
        productsOut.push(product);
      }
    });

  if (!productsOut.length) return { ...empty, reason: 'no-products' };

  return {
    products: productsOut,
    matched: true,
    reason: exact.length ? 'exact' : 'fuzzy',
    updatedAt: prices?.generatedAt || null
  };
}

/**
 * Whether a query would be answered from the static database.
 * @param {{ keys: Object }} products
 * @param {string} query
 * @returns {boolean}
 */
export function isKnownStaticQuery(products, query) {
  const normalized = normalizeIngredient(query);
  if (!normalized || !products?.keys) return false;
  const scored = Object.values(products.keys).map(entry => scoreEntry(normalized, entry));
  if (scored.some(item => item.exact)) return true;
  return scored.filter(item => item.score > 0).length >= STATIC_MIN_RESULTS;
}
