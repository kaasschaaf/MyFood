/**
 * Content translator - translates recipe content into the language the app is
 * currently showing, and caches the result per recipe and per language.
 *
 * Direction follows the source of the recipe: the built-in Dutch recipes are
 * Dutch, TheMealDB is English. In Dutch mode English recipes are translated to
 * Dutch, in English mode Dutch recipes are translated to English.
 *
 * Two engines, in order of preference:
 *  1. The browser's built-in on-device Translator API: no key, no backend,
 *     nothing leaves the device.
 *  2. Gemini, when an API key is configured.
 *
 * Source data is never mutated: translations are stored beside it under
 * `recipe.translations[lang]`, so filters, AH lookups and the original recipe
 * keep working.
 *
 * Ingredient names go the other way as well: TheMealDB lists them in English,
 * and Albert Heijn needs Dutch, so `ingredientToDutch()` resolves a Dutch
 * lookup name (glossary first, on-device translation for the rest).
 */

import { BrowserCache } from './browser-cache.js';
import { BrowserTranslator } from './browser-translator.js';
import { translateIngredientToDutch } from './ingredient-dutch.js';
import { getLang } from './i18n.js';

const CACHE_PREFIX = 'translation-v3:';
const INGREDIENT_CACHE_PREFIX = 'ingredient-nl-v1:';
const MAX_BATCH = 8;
const LANGUAGE_NAMES = { nl: 'Dutch', en: 'English' };

/**
 * Collects the translatable parts of a recipe.
 * @param {Object} recipe
 * @param {boolean} withDetails include ingredients and instructions
 * @returns {Object}
 */
function buildPayload(recipe, withDetails) {
  const payload = {
    id: recipe.id,
    title: recipe.title || '',
    description: recipe.description || ''
  };
  if (withDetails) {
    payload.cuisine = recipe.cuisine || '';
    payload.difficulty = recipe.difficulty || '';
    payload.ingredients = (recipe.ingredients || []).map(ingredient => ingredient.name || '');
    payload.instructions = recipe.instructions || [];
  }
  return payload;
}

export class ContentTranslator {
  constructor(geminiService, cache = new BrowserCache(), browserTranslator = new BrowserTranslator()) {
    this.geminiService = geminiService;
    this.cache = cache;
    this.browserTranslator = browserTranslator;
    this.memory = new Map();
    this.pending = new Map();
    this.ingredientMemory = new Map();
    this.availableByDirection = new Map();
  }

  /**
   * Language a recipe is written in. Only TheMealDB recipes are English; the
   * built-in and Allerhande recipes are Dutch.
   * @param {Object} recipe
   * @returns {'nl'|'en'}
   */
  sourceLang(recipe) {
    return recipe?.external ? 'en' : 'nl';
  }

  /**
   * The direction the active interface needs.
   * @returns {{ source: 'nl'|'en', target: 'nl'|'en' }}
   */
  neededDirection() {
    const target = getLang() === 'en' ? 'en' : 'nl';
    return { source: target === 'en' ? 'nl' : 'en', target };
  }

  /**
   * Whether this recipe still needs translating for the active language.
   * @param {Object} recipe
   * @returns {boolean}
   */
  needsTranslation(recipe) {
    if (!recipe || recipe.ahRecipeOnly) return false;
    const target = getLang() === 'en' ? 'en' : 'nl';
    return this.sourceLang(recipe) !== target;
  }

  /**
   * Whether a specific direction can be translated, by either engine.
   * Never blocks longer than the availability probe.
   * @param {'nl'|'en'} [source]
   * @param {'nl'|'en'} [target]
   * @returns {Promise<boolean>}
   */
  async isTranslationAvailable(source, target) {
    if (this.geminiService?.hasApiKey?.()) return true;
    const direction = source && target ? { source, target } : this.neededDirection();
    if (direction.source === direction.target) return true;
    if (!this.browserTranslator.isSupported()) return false;
    const key = `${direction.source}>${direction.target}`;
    if (!this.availableByDirection.has(key)) {
      const probe = this.browserTranslator.canTranslate(direction.source, direction.target).then(available => {
        // Allow a retry once the model may have finished downloading.
        if (!available) setTimeout(() => { this.availableByDirection.delete(key); }, 2 * 60 * 1000);
        return available;
      });
      this.availableByDirection.set(key, probe);
    }
    return this.availableByDirection.get(key);
  }

  /**
   * Synchronous best guess, for UI that cannot await.
   * @returns {boolean}
   */
  canTranslate() {
    return Boolean(this.geminiService?.hasApiKey?.()) || this.browserTranslator.isSupported();
  }

  /**
   * Dutch name for an AH lookup. English sources go through the glossary and,
   * for anything not covered, the on-device translator.
   * @param {string} name
   * @returns {Promise<string>} the original name when nothing could translate
   */
  async ingredientToDutch(name) {
    const original = String(name || '').trim();
    if (!original) return original;
    const key = original.toLowerCase();
    if (this.ingredientMemory.has(key)) return this.ingredientMemory.get(key);
    const cached = await this.readIngredientCache(key);
    if (cached) {
      this.ingredientMemory.set(key, cached);
      return cached;
    }

    const glossary = translateIngredientToDutch(original);
    if (glossary.complete) {
      this.ingredientMemory.set(key, glossary.text);
      return glossary.text;
    }

    let result = glossary.changed ? glossary.text : original;
    if (!glossary.complete) {
      const translated = await this.browserTranslator.translate(original, { source: 'en', target: 'nl' });
      if (translated && translated.trim() !== original.trim()) {
        // Re-run the glossary over the machine translation: it may still hold
        // an English word that the API did not know ("sun dried tomatoes").
        const second = translateIngredientToDutch(translated);
        result = second.changed ? second.text : translated;
      }
    }
    this.ingredientMemory.set(key, result);
    if (result !== original) await this.writeIngredientCache(key, result);
    return result;
  }

  async readIngredientCache(key) {
    try {
      const entry = await this.cache.get(`${INGREDIENT_CACHE_PREFIX}${key}`);
      return entry?.value?.dutch || null;
    } catch {
      return null;
    }
  }

  async writeIngredientCache(key, dutch) {
    try {
      await this.cache.set(`${INGREDIENT_CACHE_PREFIX}${key}`, { dutch });
    } catch (error) {
      console.warn('Dutch ingredient name could not be cached.', error);
    }
  }

  /**
   * Stores a translation next to the source data.
   * @param {Object} recipe
   * @param {Object|null} translation
   * @param {'nl'|'en'} lang
   */
  applyTranslation(recipe, translation, lang) {
    if (!recipe || !translation) return recipe;
    // Older builds stored a translation of the "Recipe from TheMealDB"
    // disclaimer; never let that cached sentence come back.
    const description = String(translation.description || '');
    const value = /recipe from\s+(?:the)?\s*mealdb/i.test(description)
      ? { ...translation, description: '' }
      : translation;
    if (!recipe.translations) recipe.translations = {};
    recipe.translations[lang] = value;
    const names = value.ingredients || [];
    (recipe.ingredients || []).forEach((ingredient, index) => {
      if (!names[index]) return;
      if (!ingredient.translations) ingredient.translations = {};
      ingredient.translations[lang] = names[index];
    });
    return recipe;
  }

  /**
   * Translation for the active language, when one has been applied.
   * @param {Object} recipe
   * @returns {Object|null}
   */
  translationFor(recipe) {
    const lang = getLang() === 'en' ? 'en' : 'nl';
    return recipe?.translations?.[lang] || null;
  }

  /**
   * Translated value of a source field, when available.
   * @param {Object} recipe
   * @param {'title'|'description'|'cuisine'|'difficulty'} key
   * @returns {string|undefined}
   */
  field(recipe, key) {
    const value = this.translationFor(recipe)?.[key];
    return typeof value === 'string' && value ? value : undefined;
  }

  /**
   * Title shown in the active language.
   * @param {Object} recipe
   * @returns {string}
   */
  title(recipe) {
    if (!recipe) return '';
    return this.field(recipe, 'title') || recipe.title;
  }

  /**
   * Description shown in the active language.
   * @param {Object} recipe
   * @returns {string}
   */
  description(recipe) {
    if (!recipe) return '';
    return this.field(recipe, 'description') || recipe.description;
  }

  /**
   * Ingredient name shown in the active language. Never use this for AH lookups.
   * @param {Object} ingredient
   * @returns {string}
   */
  ingredientName(ingredient) {
    if (!ingredient) return '';
    const lang = getLang() === 'en' ? 'en' : 'nl';
    return ingredient.translations?.[lang] || ingredient.name;
  }

  /**
   * Instructions shown in the active language.
   * @param {Object} recipe
   * @returns {string[]}
   */
  instructions(recipe) {
    if (!recipe) return [];
    return this.translationFor(recipe)?.instructions?.length
      ? this.translationFor(recipe).instructions
      : (recipe.instructions || []);
  }

  cacheKey(recipe, lang, withDetails) {
    return `${CACHE_PREFIX}${lang}:${withDetails ? 'full' : 'summary'}:${recipe.id}`;
  }

  /**
   * Reads a cached translation from memory or IndexedDB.
   * @param {Object} recipe
   * @param {'nl'|'en'} lang
   * @param {boolean} withDetails
   * @returns {Promise<Object|null>}
   */
  async readCache(recipe, lang, withDetails) {
    const key = this.cacheKey(recipe, lang, withDetails);
    if (this.memory.has(key)) return this.memory.get(key);
    try {
      const entry = await this.cache.get(key);
      if (entry?.value) {
        this.memory.set(key, entry.value);
        return entry.value;
      }
    } catch (error) {
      console.warn('Translation cache could not be read.', error);
    }
    return null;
  }

  async writeCache(recipe, lang, withDetails, value) {
    const key = this.cacheKey(recipe, lang, withDetails);
    this.memory.set(key, value);
    try {
      await this.cache.set(key, value);
    } catch (error) {
      console.warn('Translation could not be cached.', error);
    }
  }

  /**
   * Applies whatever is already cached, without waiting for the network.
   * @param {Object[]} recipes
   * @returns {Promise<void>}
   */
  async applyCachedSummaries(recipes) {
    await Promise.all((recipes || []).filter(recipe => this.needsTranslation(recipe)).map(async recipe => {
      const lang = getLang() === 'en' ? 'en' : 'nl';
      const cached = await this.readCache(recipe, lang, false);
      if (cached) this.applyTranslation(recipe, cached, lang);
    }));
  }

  /**
   * Translates summaries for a batch of recipes and applies them.
   * Batches large groups in chunks to keep prompts small.
   * @param {Object[]} recipes
   * @returns {Promise<number>} number of translated recipes
   */
  async translateSummaries(recipes) {
    const lang = getLang() === 'en' ? 'en' : 'nl';
    const groups = new Map();
    for (const recipe of recipes || []) {
      if (!recipe?.id || !this.needsTranslation(recipe)) continue;
      const cached = await this.readCache(recipe, lang, false);
      if (cached) {
        this.applyTranslation(recipe, cached, lang);
        continue;
      }
      const source = this.sourceLang(recipe);
      if (!(await this.isTranslationAvailable(source, lang))) continue;
      const key = `${source}>${lang}`;
      if (!groups.has(key)) groups.set(key, { source, target: lang, recipes: [] });
      groups.get(key).recipes.push(recipe);
    }

    let translated = 0;
    for (const { source, target, recipes: pending } of groups.values()) {
      for (let index = 0; index < pending.length; index += MAX_BATCH) {
        const batch = pending.slice(index, index + MAX_BATCH);
        try {
          const result = await this.requestTranslations(
            batch.map(recipe => buildPayload(recipe, false)),
            { source, target }
          );
          batch.forEach(recipe => {
            const value = result[recipe.id];
            if (!value) return;
            this.applyTranslation(recipe, value, target);
            this.writeCache(recipe, target, false, value);
            translated++;
          });
        } catch (error) {
          console.warn('Recipe summaries could not be translated.', error);
          return translated;
        }
      }
    }
    return translated;
  }

  /**
   * Translates the full detail of one recipe and applies it.
   * @param {Object} recipe
   * @returns {Promise<boolean>}
   */
  async translateRecipe(recipe) {
    if (!recipe || !this.needsTranslation(recipe)) return false;
    const target = getLang() === 'en' ? 'en' : 'nl';
    const source = this.sourceLang(recipe);
    const cached = await this.readCache(recipe, target, true);
    if (cached) {
      this.applyTranslation(recipe, cached, target);
      return true;
    }
    if (!(await this.isTranslationAvailable(source, target))) return false;

    const key = recipe.id;
    if (this.pending.has(key)) {
      const value = await this.pending.get(key);
      if (value) this.applyTranslation(recipe, value, target);
      return Boolean(value);
    }

    const request = this.requestTranslations([buildPayload(recipe, true)], { source, target })
      .then(result => result[recipe.id] || null)
      .catch(error => {
        console.warn('Recipe could not be translated.', error);
        return null;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, request);
    const value = await request;
    if (!value) return false;
    this.applyTranslation(recipe, value, target);
    await this.writeCache(recipe, target, true, value);
    return true;
  }

  /**
   * Translates payloads with whichever engine is available, browser first.
   * @param {Object[]} payloads
   * @param {{ source: 'nl'|'en', target: 'nl'|'en' }} direction
   * @returns {Promise<Record<string, Object>>}
   */
  async requestTranslations(payloads, direction) {
    if (!payloads.length) return {};
    const viaBrowser = await this.translateWithBrowser(payloads, direction);
    if (viaBrowser) return viaBrowser;
    return this.requestGeminiTranslations(payloads, direction);
  }

  /**
   * Translates payloads with the on-device Translator API.
   * @param {Object[]} payloads
   * @param {{ source: 'nl'|'en', target: 'nl'|'en' }} direction
   * @returns {Promise<Record<string, Object>|null>} null when unavailable
   */
  async translateWithBrowser(payloads, direction) {
    if (!this.browserTranslator.isSupported()) return null;
    const available = await this.browserTranslator.canTranslate(direction.source, direction.target);
    if (!available) return null;

    const options = { source: direction.source, target: direction.target };
    const byId = {};
    try {
      for (const payload of payloads) {
        const item = { id: payload.id };
        if (payload.title) item.title = await this.browserTranslator.translate(payload.title, options);
        if (payload.description) {
          item.description = await this.browserTranslator.translate(payload.description, options);
        }
        if (payload.cuisine) item.cuisine = await this.browserTranslator.translate(payload.cuisine, options);
        if (payload.difficulty) {
          item.difficulty = await this.browserTranslator.translate(payload.difficulty, options);
        }
        if (Array.isArray(payload.ingredients) && payload.ingredients.length) {
          item.ingredients = await this.browserTranslator.translateAll(payload.ingredients, options);
        }
        if (Array.isArray(payload.instructions) && payload.instructions.length) {
          item.instructions = await this.browserTranslator.translateAll(payload.instructions, options);
        }
        byId[payload.id] = item;
      }
      return byId;
    } catch (error) {
      console.warn('Browser translation failed; falling back to Gemini.', error);
      return null;
    }
  }

  /**
   * Calls Gemini and parses a JSON object keyed by recipe id.
   * @param {Object[]} payloads
   * @param {{ source: 'nl'|'en', target: 'nl'|'en' }} direction
   * @returns {Promise<Record<string, Object>>}
   */
  async requestGeminiTranslations(payloads, direction) {
    if (!payloads.length) return {};
    const apiKey = this.geminiService.getApiKey();
    if (!apiKey) throw new Error('No Gemini API key configured.');

    const instruction = [
      `You translate ${LANGUAGE_NAMES[direction.source]} recipe content into natural, concise ${LANGUAGE_NAMES[direction.target]}.`,
      'Keep brand names, Albert Heijn product names and units intact.',
      'Translate titles, descriptions, cuisine/style, difficulty, ingredient names and cooking steps.',
      'Ingredient names must stay short and generic (for example "salmon fillet", "spinach").',
      'Return ONLY valid JSON, no markdown fences, in exactly this shape:',
      '{"recipes":[{"id":"...","title":"...","description":"...","cuisine":"...","difficulty":"...","ingredients":["..."],"instructions":["..."]}]}',
      'For items without ingredients/instructions, omit those fields.'
    ].join(' ');

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        model: this.geminiService.modelName,
        system_instruction: instruction,
        input: JSON.stringify({ recipes: payloads }),
        generation_config: {
          temperature: 0.2,
          max_output_tokens: 2000,
          response_mime_type: 'application/json'
        },
        store: false
      })
    });

    if (!response.ok) {
      throw new Error(`Translation request failed (${response.status}).`);
    }

    const data = await response.json();
    const text = data.output_text || (data.steps || [])
      .filter(step => step.type === 'model_output')
      .flatMap(step => step.content || [])
      .filter(content => content.type === 'text')
      .map(content => content.text)
      .join('\n')
      .trim();

    const parsed = parseTranslationPayload(text);
    const byId = {};
    (parsed.recipes || []).forEach(item => {
      if (item?.id) byId[item.id] = item;
    });
    return byId;
  }
}

/**
 * Parses model output that may be wrapped in code fences or prose.
 * @param {string} text
 * @returns {{ recipes?: Object[] }}
 */
export function parseTranslationPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return { recipes: [] };
  const withoutFences = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(withoutFences);
  } catch {
    const start = withoutFences.indexOf('{');
    const end = withoutFences.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(withoutFences.slice(start, end + 1));
      } catch {
        return { recipes: [] };
      }
    }
    return { recipes: [] };
  }
}
