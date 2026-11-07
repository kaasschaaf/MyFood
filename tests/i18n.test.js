import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cuisineLabel, getLang, getLocale, setLang, t } from '../js/i18n.js';
import { parseTranslationPayload } from '../js/content-translator.js';
import { formatEuro } from '../js/utils.js';

const restoreLanguage = () => setLang('nl');

test('t() returns Dutch strings by default', () => {
  restoreLanguage();
  assert.equal(getLang(), 'nl');
  assert.equal(t('nav.recipes'), 'Recepten');
});

test('t() interpolates placeholders', () => {
  restoreLanguage();
  assert.equal(t('recipe.minutes', { count: 20 }), '20 minuten');
  setLang('en');
  assert.equal(t('recipe.minutes', { count: 20 }), '20 minutes');
  restoreLanguage();
});

test('t() leaves unknown placeholders untouched and falls back to the key', () => {
  restoreLanguage();
  assert.equal(t('recipe.minutes', { other: 1 }), '{count} minuten');
  assert.equal(t('this.key.does.not.exist'), 'this.key.does.not.exist');
});

test('setLang switches language and locale', () => {
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(getLocale(), 'en-GB');
  restoreLanguage();
  assert.equal(getLocale(), 'nl-NL');
});

test('cuisineLabel only translates Dutch cuisine names in English', () => {
  restoreLanguage();
  assert.equal(cuisineLabel('Italiaans'), 'Italiaans');
  setLang('en');
  assert.equal(cuisineLabel('Italiaans'), 'Italian');
  assert.equal(cuisineLabel('Mediterraans'), 'Mediterranean');
  assert.equal(cuisineLabel('Argentinian'), 'Argentinian');
  assert.equal(cuisineLabel(''), '');
  restoreLanguage();
});

test('formatEuro formats for both locales', () => {
  assert.equal(formatEuro(3.5), '€\u00A03,50');
  assert.equal(formatEuro(3.5, 'en-GB'), '€3.50');
  assert.equal(formatEuro(undefined, 'en-GB'), '€0.00');
});

test('parseTranslationPayload reads plain JSON', () => {
  const parsed = parseTranslationPayload('{"recipes":[{"id":"a","title":"Pasta"}]}');
  assert.deepEqual(parsed.recipes, [{ id: 'a', title: 'Pasta' }]);
});

test('parseTranslationPayload strips markdown fences', () => {
  const parsed = parseTranslationPayload('```json\n{"recipes":[{"id":"a","title":"Pasta"}]}\n```');
  assert.equal(parsed.recipes[0].title, 'Pasta');
});

test('parseTranslationPayload tolerates surrounding prose', () => {
  const parsed = parseTranslationPayload('Here you go:\n{"recipes":[{"id":"a"}]}\nEnjoy!');
  assert.equal(parsed.recipes[0].id, 'a');
});

test('parseTranslationPayload falls back to an empty list', () => {
  assert.deepEqual(parseTranslationPayload('not json at all').recipes, []);
  assert.deepEqual(parseTranslationPayload('').recipes, []);
  assert.deepEqual(parseTranslationPayload(null).recipes, []);
});
