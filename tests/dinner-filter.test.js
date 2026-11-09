import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanTitle,
  curateDinnerRecipes,
  dishTypeFor,
  passesStructure,
  parseableRatio,
  sweetRatio
} from '../scripts/lib/dinner.js';

const steps = ['Do a thing.', 'Do another thing.', 'Serve.'];

const row = (title, ingredients, directions = steps) => ({ title, ingredients, directions });

const DINNERS = [
  row('Classic Beef Chili', [
    '500 g ground beef', '1 onion', '2 cloves garlic', '400 g chopped tomatoes',
    '1 tbsp cumin', '1 tbsp paprika', '400 g kidney beans', '2 tbsp olive oil'
  ]),
  row('Quick Chicken Stir Fry', [
    '2 chicken breasts', '1 broccoli', '2 tbsp soy sauce', '1 bell pepper',
    '1 onion', '200 g noodles', '1 tbsp oil'
  ]),
  row('Slow Cooker Beef Stew', [
    '700 g beef chuck', '3 potatoes', '2 carrots', '1 onion',
    '400 ml beef stock', '2 tbsp tomato puree', '1 tsp thyme', '2 tbsp flour'
  ]),
  row('Baked Mac and Cheese', [
    '400 g macaroni', '300 ml milk', '200 g cheddar', '2 tbsp butter',
    '2 tbsp flour', '1 tsp mustard', 'salt', 'pepper'
  ]),
  row('Split Pea Soup', [
    '300 g split peas', '1 onion', '2 carrots', '1 leek',
    '1 potato', '1 litre vegetable stock', '1 tbsp oil', '1 bay leaf'
  ])
];

const DESSERTS = [
  row('Chocolate Cream Cheese Salad', [
    '8 oz cream cheese', '1 cup sugar', '1 cup cool whip', '1 tsp vanilla extract',
    '2 tbsp butter', '1 cup chocolate chips'
  ]),
  row('Best Ever Chocolate Cake', [
    '2 cups flour', '2 cups sugar', '1 cup butter', '4 eggs',
    '1 cup milk', '2 tsp baking powder'
  ]),
  row('Blueberry Muffins', [
    '2 cups flour', '1 cup sugar', '1 cup butter', '2 eggs',
    '1 cup milk', '200 g blueberries'
  ]),
  row('Mango Smoothie', [
    '1 mango', '200 ml yogurt', '100 ml milk', '1 banana',
    '1 tbsp honey', '1 cup ice', '1 tbsp sugar'
  ]),
  row('Chocolate Lasagna', [
    '400 g chocolate', '200 g butter', '200 g sugar', '300 ml cream',
    '200 g biscuits', '1 tsp vanilla extract', '2 tbsp cocoa powder'
  ])
];

test('structure gate needs enough ingredients and steps', () => {
  assert.equal(passesStructure(row('Dinner', ['a', 'b', 'c', 'd', 'e', 'f'])), true);
  assert.equal(passesStructure(row('Too small', ['a', 'b'])), false);
  assert.equal(passesStructure(row('No steps', ['a', 'b', 'c', 'd', 'e', 'f'], [])), false);
  assert.equal(passesStructure(row('x'.repeat(120), ['a', 'b', 'c', 'd', 'e', 'f'])), false);
  assert.equal(passesStructure(row('Good', ['a', 'b', 'c', 'd', 'e', 'f'], ['one', 'two', 'three'])), true);
});

test('dinner dishes survive the funnel', () => {
  const result = curateDinnerRecipes(DINNERS, {});
  assert.deepEqual(
    result.recipes.map(item => item.title).sort(),
    DINNERS.map(item => item.title).sort()
  );
});

test('baking and dessert are filtered out', () => {
  const result = curateDinnerRecipes(DESSERTS, {});
  assert.deepEqual(result.recipes, []);
});

test('the gates report what they dropped', () => {
  const result = curateDinnerRecipes([...DINNERS, ...DESSERTS], {});
  assert.equal(result.gates[0].name, 'structure');
  assert.equal(result.gates[0].in, DINNERS.length + DESSERTS.length);
  // Each gate's input equals the previous gate's output.
  for (let index = 1; index < result.gates.length; index++) {
    assert.equal(result.gates[index].in, result.gates[index - 1].out, `gate ${result.gates[index].name}`);
  }
  // Something was dropped by the dessert gates.
  const dessertTitle = result.gates.find(gate => gate.name === 'dessert (title)');
  assert.ok(dessertTitle.out < dessertTitle.in);
  assert.equal(result.recipes.length, DINNERS.length);
});

test('blog noise in a title is rejected', () => {
  const noisy = row('Amazing Pasta http://blog.example.com/recipe', [
    '400 g pasta', '1 onion', '2 cloves garlic', '400 g tomatoes',
    '2 tbsp olive oil', '1 tsp oregano', 'salt'
  ]);
  const result = curateDinnerRecipes([noisy], {});
  assert.deepEqual(result.recipes, []);
});

test('near-identical ingredient sets collapse, shared staples do not', () => {
  // These two dinners share oil, salt and onion but are different dishes.
  const chiliStyle = row('Beef Chili', [
    '500 g ground beef', '1 onion', '2 cloves garlic', '400 g tomatoes',
    '1 tbsp cumin', '400 g kidney beans', '2 tbsp oil'
  ]);
  const pastaStyle = row('Beef Ragu Pasta', [
    '500 g ground beef', '1 onion', '2 cloves garlic', '400 g tomatoes',
    '1 tbsp oregano', '400 g pasta', '2 tbsp oil'
  ]);
  const result = curateDinnerRecipes([chiliStyle, pastaStyle], {});
  assert.equal(result.recipes.length, 2);
});

test('duplicate titles and identical ingredient sets collapse', () => {
  const first = row('Beef Chili', [
    '500 g ground beef', '1 onion', '2 cloves garlic', '400 g tomatoes',
    '1 tbsp cumin', '400 g kidney beans', '2 tbsp oil'
  ]);
  const duplicateTitle = row('beef chili', [
    '600 g ground beef', '1 onion', '3 cloves garlic', '400 g tomatoes',
    '2 tbsp cumin', '400 g kidney beans', '2 tbsp oil'
  ]);
  const duplicateFingerprint = row('Texas Red Chili', [
    '500 g ground beef', '1 onion', '2 cloves garlic', '400 g tomatoes',
    '1 tbsp cumin', '400 g kidney beans', '2 tbsp oil'
  ]);
  const result = curateDinnerRecipes([first, duplicateTitle, duplicateFingerprint], {});
  assert.equal(result.recipes.length, 1);
  const dupGate = result.gates.find(gate => gate.name === 'duplicate');
  assert.equal(dupGate.out, 1);
  assert.equal(dupGate.in - dupGate.out, 2);
});

test('the limit is applied after curation', () => {
  const result = curateDinnerRecipes(DINNERS, { limit: 2 });
  assert.equal(result.recipes.length, 2);
});

test('parseable and sweet ratios describe a row', () => {
  const dish = DINNERS[0];
  assert.ok(parseableRatio(dish) >= 0.6);
  assert.ok(sweetRatio(dish) <= 0.4);
  assert.ok(sweetRatio(DESSERTS[1]) > 0.4);
  assert.equal(parseableRatio({ ingredients: [] }), 0);
});

test('titles are cleaned and dish types are assigned', () => {
  assert.equal(cleanTitle('  -- Beef  Stew --  '), 'Beef Stew');
  assert.equal(dishTypeFor('Creamy Salmon Pasta'), 'pasta-rijst');
  assert.equal(dishTypeFor('Thai Green Curry'), 'stoof-curry');
  assert.equal(dishTypeFor('Lemon Chicken'), 'kip');
  assert.equal(dishTypeFor('Something Unusual'), 'overig');
});
