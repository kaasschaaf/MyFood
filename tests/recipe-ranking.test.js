import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  priceCoverage,
  rankRecipes,
  recommendationScore,
  rotationSeed,
  stableHash
} from '../js/recipe-ranking.js';

/**
 * A recipe with everything a good card needs.
 * @param {Object} [overrides]
 * @returns {Object}
 */
function complete(overrides = {}) {
  return {
    id: 'r-complete',
    title: 'Romige pasta',
    titleEn: 'Creamy pasta',
    description: 'Een romige pasta met zalm, spinazie en citroen, klaar in twintig minuten.',
    dishType: 'pasta',
    ingredientCount: 6,
    nutrition: { calories: 520, proteinGrams: 32, healthScore: 74 },
    ...overrides
  };
}

const fullPrice = { hasPriceData: true, hasAnyPriceData: true, ingredientCount: 6, pricedIngredientCount: 6 };
const halfPrice = { hasPriceData: false, hasAnyPriceData: true, ingredientCount: 6, pricedIngredientCount: 3 };
const noPrice = { hasPriceData: false, hasAnyPriceData: false, ingredientCount: 6, pricedIngredientCount: 0 };

test('price coverage is a 0..1 share', () => {
  assert.equal(priceCoverage(null), 0);
  assert.equal(priceCoverage(fullPrice), 1);
  assert.equal(priceCoverage(halfPrice), 0.5);
  assert.equal(priceCoverage(noPrice), 0);
  assert.equal(priceCoverage({ hasPriceData: false, hasAnyPriceData: true }), 0.5);
});

test('a complete recipe scores higher than an incomplete one', () => {
  const best = recommendationScore(complete(), fullPrice);
  const noPrices = recommendationScore(complete(), noPrice);
  const noNutrition = recommendationScore(complete({ nutrition: null }), fullPrice);
  const noDescription = recommendationScore(complete({ description: '' }), fullPrice);

  assert.ok(best > noPrices, 'priced beats unpriced');
  assert.ok(best > noNutrition, 'documented nutrition beats none');
  assert.ok(best > noDescription, 'a written description counts');
  assert.ok(best <= 100);
});

test('score is bounded and stable', () => {
  const score = recommendationScore(complete(), fullPrice);
  assert.equal(score, recommendationScore(complete(), fullPrice));
  assert.ok(score >= 0 && score <= 100);
  assert.equal(recommendationScore(null), 0);
  assert.equal(recommendationScore({}), 0);
});

test('an estimated nutrition value is worth less than a documented one', () => {
  const documented = recommendationScore(complete(), fullPrice);
  const estimated = recommendationScore(complete({ nutrition: { calories: 520, proteinGrams: 32, healthScore: 74, estimated: true } }), fullPrice);
  assert.ok(documented > estimated);
});

test('the hash mixes a one-character seed change', () => {
  // Without an avalanche step the two orders would correlate almost perfectly.
  const ids = Array.from({ length: 200 }, (_, index) => `r${index}`);
  const orderA = ids.map(id => stableHash(`${id}|20261109`));
  const orderB = ids.map(id => stableHash(`${id}|20261110`));
  const samePosition = orderA.filter((value, index) => value === orderB[index]).length;
  assert.equal(samePosition, 0);
});

test('the rotation seed is the UTC date', () => {
  assert.equal(rotationSeed(new Date('2026-11-09T23:30:00Z')), '20261109');
  assert.equal(rotationSeed(new Date('2026-01-02T00:10:00Z')), '20260102');
});

test('a better band always outranks a worse one', () => {
  const good = complete({ id: 'good' });
  const bad = complete({ id: 'bad', description: '', dishType: '', titleEn: 'Creamy pasta', nutrition: null });
  const ranked = rankRecipes([bad, good], { priceFor: () => fullPrice, seed: '20261109' });
  assert.deepEqual(ranked.map(recipe => recipe.id), ['good', 'bad']);
});

test('within a band the order rotates daily, and is stable per seed', () => {
  const recipes = Array.from({ length: 120 }, (_, index) => complete({ id: `r${index}` }));
  const priceFor = () => fullPrice;
  const day1 = rankRecipes(recipes, { priceFor, seed: '20261109' }).map(recipe => recipe.id);
  const day1Again = rankRecipes(recipes, { priceFor, seed: '20261109' }).map(recipe => recipe.id);
  const day2 = rankRecipes(recipes, { priceFor, seed: '20261110' }).map(recipe => recipe.id);

  assert.deepEqual(day1, day1Again, 'same day, same order');
  assert.notDeepEqual(day1, day2, 'a new day reshuffles the band');
  assert.deepEqual([...day1].sort(), [...day2].sort(), 'the same recipes, only reordered');
  // The first page has to actually change, not just the tail.
  const overlap = day1.slice(0, 30).filter(id => day2.slice(0, 30).includes(id)).length;
  assert.ok(overlap < 25, `day-to-day overlap was ${overlap} of 30`);
});

test('ranking does not modify the input list', () => {
  const recipes = [complete({ id: 'a' }), complete({ id: 'b' })];
  const before = recipes.map(recipe => recipe.id);
  rankRecipes(recipes, { priceFor: () => fullPrice });
  assert.deepEqual(recipes.map(recipe => recipe.id), before);
});

test('a stored score wins over a recomputed one', () => {
  const stored = complete({ id: 'stored', recommendation: 4, description: '', nutrition: null, dishType: '' });
  const computed = complete({ id: 'computed' });
  const ranked = rankRecipes([computed, stored], { priceFor: () => fullPrice, seed: '20261109' });
  assert.equal(ranked[0].id, 'computed');
  assert.equal(ranked[1].id, 'stored');
});

test('an empty list is handled', () => {
  assert.deepEqual(rankRecipes([]), []);
  assert.deepEqual(rankRecipes(null), []);
});
