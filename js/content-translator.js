/**
 * Content translator - translates recipe content to English on demand via
 * Gemini and caches the result per recipe.
 *
 * The Dutch source data is never mutated: translations are stored beside it
 * (displayTitle, displayDescription, ingredient.displayName, ...) so that AH
 * product matching keeps using the original Dutch names.
 */

import { BrowserCache } from './browser-cache.js';
import { getLang } from './i18n.js';

const CACHE_PREFIX = 'translation-v1:en:';
const MAX_BATCH = 8;

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
  constructor(geminiService, cache = new BrowserCache()) {
    this.geminiService = geminiService;
    this.cache = cache;
    this.memory = new Map();
    this.pending = new Map();
  }

  /**
   * Whether content translation can run (needs a Gemini key).
   * @returns {boolean}
   */
  canTranslate() {
    return this.geminiService.hasApiKey();
  }

  /**
   * Applies cached translations to a recipe object (no network).
   * @param {Object} recipe
   * @param {Object|null} translation
   */
  applyTranslation(recipe, translation) {
    if (!recipe || !translation) return recipe;
    if (translation.title) recipe.displayTitle = translation.title;
    if (translation.description) recipe.displayDescription = translation.description;
    if (translation.cuisine) recipe.displayCuisine = translation.cuisine;
    if (translation.difficulty) recipe.displayDifficulty = translation.difficulty;
    const names = translation.ingredients || [];
    (recipe.ingredients || []).forEach((ingredient, index) => {
      if (names[index]) ingredient.displayName = names[index];
    });
    if (Array.isArray(translation.instructions) && translation.instructions.length) {
      recipe.displayInstructions = translation.instructions;
    }
    return recipe;
  }

  /**
   * Title shown in the active language.
   * @param {Object} recipe
   * @returns {string}
   */
  title(recipe) {
    if (!recipe) return '';
    return getLang() === 'en' && recipe.displayTitle ? recipe.displayTitle : recipe.title;
  }

  /**
   * Description shown in the active language.
   * @param {Object} recipe
   * @returns {string}
   */
  description(recipe) {
    if (!recipe) return '';
    return getLang() === 'en' && recipe.displayDescription ? recipe.displayDescription : recipe.description;
  }

  /**
   * Ingredient name shown in the active language. Never use this for AH lookups.
   * @param {Object} ingredient
   * @returns {string}
   */
  ingredientName(ingredient) {
    if (!ingredient) return '';
    return getLang() === 'en' && ingredient.displayName ? ingredient.displayName : ingredient.name;
  }

  /**
   * Instructions shown in the active language.
   * @param {Object} recipe
   * @returns {string[]}
   */
  instructions(recipe) {
    if (!recipe) return [];
    return getLang() === 'en' && recipe.displayInstructions?.length
      ? recipe.displayInstructions
      : (recipe.instructions || []);
  }

  /**
   * Reads a cached translation from memory or IndexedDB.
   * @param {Object} recipe
   * @param {boolean} withDetails
   * @returns {Promise<Object|null>}
   */
  async readCache(recipe, withDetails) {
    const key = `${CACHE_PREFIX}${withDetails ? 'full' : 'summary'}:${recipe.id}`;
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

  async writeCache(recipe, withDetails, value) {
    const key = `${CACHE_PREFIX}${withDetails ? 'full' : 'summary'}:${recipe.id}`;
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
    if (getLang() !== 'en') return;
    await Promise.all((recipes || []).map(async recipe => {
      const cached = await this.readCache(recipe, false);
      if (cached) this.applyTranslation(recipe, cached);
    }));
  }

  /**
   * Translates summaries for a batch of recipes and applies them.
   * Batches large groups in chunks to keep prompts small.
   * @param {Object[]} recipes
   * @returns {Promise<number>} number of translated recipes
   */
  async translateSummaries(recipes) {
    if (getLang() !== 'en' || !this.canTranslate()) return 0;
    const missing = [];
    for (const recipe of recipes || []) {
      if (!recipe?.id) continue;
      const cached = await this.readCache(recipe, false);
      if (cached) {
        this.applyTranslation(recipe, cached);
      } else {
        missing.push(recipe);
      }
    }

    let translated = 0;
    for (let index = 0; index < missing.length; index += MAX_BATCH) {
      const batch = missing.slice(index, index + MAX_BATCH);
      try {
        const result = await this.requestTranslations(batch.map(recipe => buildPayload(recipe, false)));
        batch.forEach(recipe => {
          const value = result[recipe.id];
          if (!value) return;
          this.applyTranslation(recipe, value);
          this.writeCache(recipe, false, value);
          translated++;
        });
      } catch (error) {
        console.warn('Recipe summaries could not be translated.', error);
        return translated;
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
    if (!recipe || getLang() !== 'en' || !this.canTranslate()) return false;
    const cached = await this.readCache(recipe, true);
    if (cached) {
      this.applyTranslation(recipe, cached);
      return true;
    }

    const key = recipe.id;
    if (this.pending.has(key)) {
      const value = await this.pending.get(key);
      if (value) this.applyTranslation(recipe, value);
      return Boolean(value);
    }

    const request = this.requestTranslations([buildPayload(recipe, true)])
      .then(result => result[recipe.id] || null)
      .catch(error => {
        console.warn('Recipe could not be translated.', error);
        return null;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, request);
    const value = await request;
    if (!value) return false;
    this.applyTranslation(recipe, value);
    await this.writeCache(recipe, true, value);
    return true;
  }

  /**
   * Calls Gemini and parses a JSON object keyed by recipe id.
   * @param {Object[]} payloads
   * @returns {Promise<Record<string, Object>>}
   */
  async requestTranslations(payloads) {
    if (!payloads.length) return {};
    const apiKey = this.geminiService.getApiKey();
    if (!apiKey) throw new Error('No Gemini API key configured.');

    const instruction = [
      'You translate Dutch recipe content into natural, concise English.',
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
