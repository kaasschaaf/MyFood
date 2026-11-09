/**
 * Recipe recommendation ranking.
 *
 * "Aanbevolen" (the default sort) is not "whatever order the data file happens
 * to have": the recipe grid is the first thing a visitor sees, so it has to
 * lead with recipes that are actually usable — priced, with nutrition, with a
 * written description — instead of with the same handful every day.
 *
 * Two ideas, both deterministic:
 *
 *  1. **Quality score** (0–100) from signals the catalogue already carries:
 *     how much of the recipe the price snapshot can price, whether nutrition is
 *     documented, whether the ingredient list looks like a dinner, whether the
 *     description was written rather than templated, and whether a proper
 *     translation exists.
 *  2. **Daily rotation inside score bands.** Recipes are grouped in 5-point
 *     bands and ordered pseudo-randomly *within* a band, seeded by the date.
 *     A better recipe always outranks a worse one, but the front page shows a
 *     different mix every day, so a corpus of thousands does not look like a
 *     corpus of nine.
 *
 * The same module is used by the data pipeline (to store a score with every
 * catalogue entry) and by the app (to rank live results), so a stored order and
 * a computed order agree.
 */

// Bump when the weights change, so stored scores can be recognised as stale.
export const RANKING_VERSION = 1;

// Width of a score band. Bigger bands mean more rotation, smaller bands mean
// the order sticks closer to the score.
const BAND_SIZE = 10;

/**
 * Clamps a number to 0..1.
 * @param {number} value
 * @returns {number}
 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Share of the recipe the price snapshot can actually price, 0..1.
 * @param {Object|null} price calculateRecipePrice-shaped object
 * @returns {number}
 */
export function priceCoverage(price) {
  if (!price) return 0;
  if (price.hasPriceData) return 1;
  const total = Number(price.ingredientCount);
  const priced = Number(price.pricedIngredientCount);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(priced)) return clamp01(priced / total);
  return price.hasAnyPriceData ? 0.5 : 0;
}

/**
 * How many ingredients a dinner should have. Three is a snack, twenty is a
 * project; both are still allowed, just not promoted.
 * @param {number} count
 * @returns {number}
 */
function ingredientScore(count) {
  if (count >= 4 && count <= 10) return 12;
  if (count >= 3 && count <= 14) return 8;
  if (count === 2) return 4;
  return 0;
}

/**
 * Whether the description reads like it was written for the recipe instead of
 * assembled from its ingredients.
 * @param {string} description
 * @returns {number}
 */
function descriptionScore(description) {
  const length = String(description || '').trim().length;
  if (length >= 60) return 10;
  if (length >= 25) return 6;
  return 0;
}

/**
 * Quality score for one recipe, 0–100.
 * @param {Object} recipe
 * @param {Object|null} [price] price estimate for the recipe
 * @returns {number}
 */
export function recommendationScore(recipe, price = null) {
  if (!recipe) return 0;
  let score = 0;

  // Priced ingredients are what makes a card actionable, so they weigh most.
  score += priceCoverage(price) * 30;

  const nutrition = recipe.nutrition;
  if (nutrition && Number(nutrition.calories) > 0) {
    // Documented beats estimated; an estimate is still better than nothing.
    score += nutrition.estimated ? 12 : 20;
  }
  if (nutrition && Number(nutrition.proteinGrams) >= 15 && Number(nutrition.proteinGrams) <= 60) score += 5;
  if (nutrition && Number(nutrition.healthScore) > 0) score += 5;

  const count = Number(recipe.ingredientCount ?? recipe.ingredients?.length ?? 0);
  score += ingredientScore(count ? count : 0);
  score += descriptionScore(recipe.description);

  // A dish type means the curation understood the recipe (pasta, soep, oven…).
  if (recipe.dishType) score += 8;

  // Both languages present means it was translated, not just copied.
  if (recipe.title && recipe.titleEn && recipe.title !== recipe.titleEn) score += 5;

  // A deal is worth surfacing, but only when the rest of the card is complete.
  if (price?.hasBonus && priceCoverage(price) >= 0.6) score += 5;

  return Math.round(Math.min(100, score));
}

/**
 * Hash of a string as an unsigned 32-bit number.
 *
 * FNV-1a followed by a murmur3-style finaliser. The finaliser matters: without
 * it, two seeds that differ in one character produce hashes that differ by an
 * almost constant offset, so the "daily rotation" would keep the same order.
 * With full avalanche a single changed character reshuffles everything.
 * @param {string} value
 * @returns {number}
 */
export function stableHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Rotation seed for a date. Same day, same order; new day, new mix.
 * @param {Date} [date]
 * @returns {string}
 */
export function rotationSeed(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Orders recipes for the default view: best band first, pseudo-random within a
 * band so the selection rotates per seed and a large corpus is visible.
 *
 * @param {Object[]} recipes
 * @param {Object} [options]
 * @param {(recipe: Object) => Object|null} [options.priceFor] price estimates
 * @param {string} [options.seed] rotation seed (defaults to today)
 * @returns {Object[]} a new array; the input is not modified
 */
export function rankRecipes(recipes, { priceFor = () => null, seed = rotationSeed() } = {}) {
  const list = Array.isArray(recipes) ? recipes : [];
  const decorated = list.map(recipe => {
    const price = priceFor(recipe);
    const score = Number.isFinite(recipe?.recommendation) ? recipe.recommendation : recommendationScore(recipe, price);
    return {
      recipe,
      band: Math.floor(score / BAND_SIZE),
      // The id keeps the order stable when two recipes hash alike.
      order: stableHash(`${recipe?.id || ''}|${seed}`)
    };
  });

  decorated.sort((a, b) => {
    if (a.band !== b.band) return b.band - a.band;
    if (a.order !== b.order) return a.order - b.order;
    return String(a.recipe?.id || '').localeCompare(String(b.recipe?.id || ''));
  });

  return decorated.map(entry => entry.recipe);
}
