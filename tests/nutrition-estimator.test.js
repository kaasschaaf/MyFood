import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateRecipeNutrition, findFood, ingredientGrams } from '../js/nutrition-estimator.js';

const line = (name, amount, unit) => ({ name, amount, unit });

test('findFood recognises English and Dutch ingredient names', () => {
  assert.equal(findFood('Chicken Breasts').protein, 31);
  assert.equal(findFood('Kipfilet').protein, 31);
  assert.equal(findFood('Olive Oil').fat, 100);
  assert.equal(findFood('Something completely unknown'), null);
});

test('stock and water are not priced as the meat they are named after', () => {
  assert.ok(findFood('Chicken Stock Cube').kcal < 20);
  assert.ok(findFood('Beef Gravy').kcal < 20);
  assert.ok(findFood('Water').kcal < 20);
});

test('ingredientGrams handles weight, volume and counted pieces', () => {
  assert.equal(ingredientGrams(line('Flour', 200, 'g'), findFood('flour')), 200);
  assert.equal(ingredientGrams(line('Milk', 1, 'l'), findFood('milk')), 1000);
  assert.equal(ingredientGrams(line('Olive Oil', 2, 'tbsp'), findFood('olive oil')), 30);
  assert.equal(ingredientGrams(line('Onion', 3, ''), findFood('onion')), 330);
  assert.equal(ingredientGrams(line('Onion', 3, 'large'), findFood('onion')), 330);
  assert.equal(ingredientGrams(line('Mystery', 3, ''), null), null);
});

test('estimateRecipeNutrition returns per-serving protein and a health score', () => {
  const recipe = {
    baseServings: 4,
    ingredients: [
      line('Chicken Breasts', 2, ''),
      line('Chopped Tomatoes', 400, 'g'),
      line('Onion', 1, ''),
      line('Olive Oil', 2, 'tbsp'),
      line('Penne Rigate', 300, 'g'),
      line('Parmesan', 50, 'g')
    ]
  };
  const nutrition = estimateRecipeNutrition(recipe, 4);
  assert.equal(nutrition.estimated, true);
  assert.ok(nutrition.proteinGrams > 25, `protein was ${nutrition.proteinGrams}`);
  assert.ok(nutrition.calories > 250);
  assert.ok(nutrition.healthScore > 50 && nutrition.healthScore <= 98);
  assert.ok(nutrition.carbsGrams > 0 && nutrition.fatGrams >= 0);
});

test('a fattier dish scores lower than a lean vegetable dish', () => {
  const lean = estimateRecipeNutrition({
    baseServings: 2,
    ingredients: [line('Cod', 300, 'g'), line('Broccoli', 300, 'g'), line('Potatoes', 400, 'g')]
  }, 2);
  const rich = estimateRecipeNutrition({
    baseServings: 2,
    ingredients: [line('Puff Pastry', 300, 'g'), line('Butter', 100, 'g'), line('Sugar', 100, 'g')]
  }, 2);
  assert.ok(lean.healthScore > rich.healthScore, `${lean.healthScore} should beat ${rich.healthScore}`);
});

test('estimateRecipeNutrition refuses to guess from too little data', () => {
  assert.equal(estimateRecipeNutrition({ ingredients: [] }, 2), null);
  assert.equal(estimateRecipeNutrition({ ingredients: [line('Zzz', 2, '')] }, 2), null);
  assert.equal(estimateRecipeNutrition({ ingredients: [line('Salt', 5, 'g')] }, 2), null);
});

test('an amount without a unit is not treated as a pile of pieces', () => {
  // "200 rund lam" means 200 g, not 200 pieces of meat.
  const beef = findFood('rund lam');
  assert.equal(ingredientGrams({ name: 'rund lam', amount: 200, unit: '' }, beef), null);
  // A plausible count still works.
  assert.ok(ingredientGrams({ name: 'Onion', amount: 2, unit: '' }, findFood('Onion')) > 0);
});

test('a single ingredient line is capped at a pan-sized amount', () => {
  const grams = ingredientGrams({ name: 'Rice', amount: 900, unit: 'cups' }, findFood('Rice'));
  assert.ok(grams <= 2500, `grams was ${grams}`);
});

test('an implausible recipe yields no estimate instead of a wrong one', () => {
  const nonsense = {
    baseServings: 1,
    ingredients: [
      line('Beef', 900, 'cups'),
      line('Rice', 900, 'cups'),
      line('Butter', 900, 'cups')
    ]
  };
  const estimate = estimateRecipeNutrition(nonsense, 1);
  assert.equal(estimate, null);
});
