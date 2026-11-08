import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ContentTranslator } from '../js/content-translator.js';
import { setLang } from '../js/i18n.js';

/** In-memory stand-in for BrowserCache. */
function memoryCache() {
  const store = new Map();
  return {
    store,
    get: async key => (store.has(key) ? { key, value: store.get(key) } : null),
    set: async (key, value) => {
      store.set(key, value);
      return { key, value, updatedAt: Date.now() };
    }
  };
}

/** Fake on-device translator: prefixes the target language. */
function fakeBrowserTranslator() {
  const calls = [];
  const convert = (text, options) => {
    const value = `[${options.target}] ${text}`;
    calls.push(`${options.source}>${options.target}:${text}`);
    return value;
  };
  return {
    calls,
    isSupported: () => true,
    canTranslate: async () => true,
    translate: async (text, options) => convert(text, options),
    translateAll: async (texts, options) => texts.map(text => convert(text, options))
  };
}

const externalRecipe = () => ({
  id: 'themealdb-1',
  external: true,
  title: 'Chicken Curry',
  description: 'A British chicken dish with chicken and curry powder.',
  cuisine: 'British',
  difficulty: 'Not listed',
  baseServings: 2,
  ingredients: [{ name: 'Chicken' }, { name: 'Curry Powder' }],
  instructions: ['Fry the chicken.']
});

const localRecipe = () => ({
  id: 'local-1',
  title: 'Romige Pasta',
  description: 'Een romige pasta.',
  baseServings: 2,
  ingredients: [{ name: 'Pasta' }],
  instructions: ['Kook de pasta.']
});

test('needsTranslation follows the source language of the recipe', () => {
  const translator = new ContentTranslator({ hasApiKey: () => false }, memoryCache(), fakeBrowserTranslator());
  setLang('nl');
  assert.equal(translator.needsTranslation(externalRecipe()), true, 'English recipe needs Dutch');
  assert.equal(translator.needsTranslation(localRecipe()), false, 'Dutch recipe is already Dutch');
  setLang('en');
  assert.equal(translator.needsTranslation(localRecipe()), true, 'Dutch recipe needs English');
  assert.equal(translator.needsTranslation(externalRecipe()), false, 'English recipe is already English');
  assert.equal(translator.needsTranslation({ id: 'ah', ahRecipeOnly: true }), false);
  setLang('nl');
});

test('English recipes are translated to Dutch in Dutch mode', async () => {
  const browser = fakeBrowserTranslator();
  const translator = new ContentTranslator({ hasApiKey: () => false }, memoryCache(), browser);
  setLang('nl');
  const recipe = externalRecipe();

  const count = await translator.translateSummaries([recipe]);

  assert.equal(count, 1);
  assert.equal(translator.title(recipe), '[nl] Chicken Curry');
  assert.equal(translator.description(recipe), '[nl] A British chicken dish with chicken and curry powder.');
  assert.equal(recipe.title, 'Chicken Curry', 'source title must stay untouched');
  assert.equal(recipe.translations.nl.title, '[nl] Chicken Curry');
  assert.ok(browser.calls.every(call => call.startsWith('en>nl:')), browser.calls.join(' | '));
});

test('Dutch recipes are translated to English in English mode', async () => {
  const browser = fakeBrowserTranslator();
  const translator = new ContentTranslator({ hasApiKey: () => false }, memoryCache(), browser);
  setLang('en');
  const recipe = localRecipe();

  await translator.translateSummaries([recipe]);

  assert.equal(translator.title(recipe), '[en] Romige Pasta');
  assert.ok(browser.calls.every(call => call.startsWith('nl>en:')), browser.calls.join(' | '));
  setLang('nl');
});

test('a translated recipe keeps its translation for both languages', async () => {
  const cache = memoryCache();
  const translator = new ContentTranslator({ hasApiKey: () => false }, cache, fakeBrowserTranslator());
  setLang('en');
  const recipe = localRecipe();
  await translator.translateSummaries([recipe]);
  setLang('nl');
  assert.equal(translator.title(recipe), 'Romige Pasta', 'Dutch source is still shown in Dutch mode');
  setLang('en');
  assert.equal(translator.title(recipe), '[en] Romige Pasta');
  setLang('nl');
});

test('full recipe translation covers ingredients and instructions', async () => {
  const translator = new ContentTranslator({ hasApiKey: () => false }, memoryCache(), fakeBrowserTranslator());
  setLang('nl');
  const recipe = externalRecipe();

  const translated = await translator.translateRecipe(recipe);

  assert.equal(translated, true);
  assert.deepEqual(translator.instructions(recipe), ['[nl] Fry the chicken.']);
  assert.equal(translator.ingredientName(recipe.ingredients[0]), '[nl] Chicken');
  assert.equal(recipe.ingredients[0].name, 'Chicken', 'AH matching needs the English name');
});

test('without a translation engine the source text is kept', async () => {
  const translator = new ContentTranslator(
    { hasApiKey: () => false },
    memoryCache(),
    { isSupported: () => false, canTranslate: async () => false, translate: async t => t, translateAll: async t => t }
  );
  setLang('nl');
  const recipe = externalRecipe();
  assert.equal(await translator.isTranslationAvailable('en', 'nl'), false);
  assert.equal(await translator.translateSummaries([recipe]), 0);
  assert.equal(translator.title(recipe), 'Chicken Curry');
});

test('translations make a recipe findable by its translated title', async () => {
  const translator = new ContentTranslator({ hasApiKey: () => false }, memoryCache(), fakeBrowserTranslator());
  setLang('nl');
  const recipe = externalRecipe();
  await translator.translateSummaries([recipe]);
  assert.equal(recipe.translations.nl.title, '[nl] Chicken Curry');
});
