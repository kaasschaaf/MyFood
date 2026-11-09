/**
 * Local machine translation for the pipeline.
 *
 * Recipe text has to be available in both Dutch and English *statically*, so
 * the site never translates at runtime. That rules out a hosted API (cost, key,
 * reproducibility), so the pipeline runs MarianMT locally through
 * transformers.js: two small ONNX models, cached on disk, no network at
 * translate time after the first run.
 *
 *   Xenova/opus-mt-en-nl  (English -> Dutch)
 *   Xenova/opus-mt-nl-en  (Dutch -> English)
 *
 * Translations are cached per string in .cache/translations.json, so rebuilds
 * only pay for new text.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = resolve(dirname(dirname(fileURLToPath(import.meta.url))), '.cache');
const CACHE_FILE = resolve(CACHE_DIR, 'translations.json');
const MODEL_DIR = resolve(CACHE_DIR, 'models');
const MAX_NEW_TOKENS = 128;

/** @type {Map<string, Object>} */
const pipelineCache = new Map();
/** @type {{ [direction: string]: { [text: string]: string } }} */
let translations = {};
let loadedCache = false;
let stats = { hits: 0, translated: 0, batches: 0 };

function loadCache() {
  if (loadedCache) return;
  loadedCache = true;
  try {
    translations = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    translations = {};
  }
}

function saveCache() {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, `${JSON.stringify(translations)}\n`);
  } catch (error) {
    console.warn(`  translation cache could not be written (${error.message})`);
  }
}

/**
 * Loads (once) the translation pipeline for a direction.
 * @param {'en>nl'|'nl>en'} direction
 * @returns {Promise<Function>}
 */
async function getPipeline(direction) {
  if (pipelineCache.has(direction)) return pipelineCache.get(direction);
  const model = direction === 'en>nl' ? 'Xenova/opus-mt-en-nl' : 'Xenova/opus-mt-nl-en';
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = MODEL_DIR;
  env.allowRemoteModels = true;
  const translator = await pipeline('translation', model, { dtype: 'int8' });
  pipelineCache.set(direction, translator);
  return translator;
}

/**
 * Translates a batch of strings, using the disk cache for anything seen before.
 * @param {string[]} texts
 * @param {'en>nl'|'nl>en'} direction
 * @param {{ batchSize?: number }} [options]
 * @returns {Promise<string[]>}
 */
export async function translateBatch(texts, direction, { batchSize = 32 } = {}) {
  loadCache();
  const bucket = translations[direction] || (translations[direction] = {});
  const output = new Array(texts.length);
  const pending = [];

  texts.forEach((text, index) => {
    const value = String(text || '').trim();
    if (!value) {
      output[index] = '';
      return;
    }
    if (Object.prototype.hasOwnProperty.call(bucket, value)) {
      output[index] = bucket[value];
      stats.hits++;
      return;
    }
    pending.push({ index, value });
  });

  if (!pending.length) return output;

  const translator = await getPipeline(direction);
  for (let start = 0; start < pending.length; start += batchSize) {
    const chunk = pending.slice(start, start + batchSize);
    // The same sentence turns up in many recipes ("Preheat the oven…");
    // translate it once per run instead of once per recipe.
    const unique = [...new Set(chunk.map(item => item.value))];
    const results = await translator(unique, { max_new_tokens: MAX_NEW_TOKENS });
    const list = Array.isArray(results) ? results : [results];
    const byText = new Map();
    unique.forEach((value, offset) => {
      byText.set(value, String(list[offset]?.translation_text || value).trim());
    });
    chunk.forEach(item => {
      const candidate = byText.get(item.value) ?? item.value;
      const text = looksBroken(candidate, item.value) ? item.value : candidate;
      output[item.index] = text;
      bucket[item.value] = text;
    });
    stats.translated += unique.length;
    stats.batches++;
    if (start + batchSize < pending.length) saveCache();
  }

  saveCache();
  return output;
}

/**
 * Whether a machine translation came out unusable: empty, dominated by
 * punctuation, or one character repeated many times. The model occasionally
 * emits such output for very short or very odd input.
 * @param {string} text
 * @param {string} source
 * @returns {boolean}
 */
export function looksBroken(text, source) {
  const value = String(text || '').trim();
  const original = String(source || '').trim();
  if (!value) return true;
  if (value.length < 2 && original.length > 1) return true;
  if (/(.)\1{20,}/.test(value)) return true;
  const letters = (value.match(/[\p{L}\p{N}]/gu) || []).length;
  if (letters / value.length < 0.55) return true;
  // A translation ten times longer than its source is not a translation.
  if (original.length > 10 && value.length > original.length * 6) return true;
  return false;
}

/**
 * Translates one string.
 * @param {string} text
 * @param {'en>nl'|'nl>en'} direction
 * @returns {Promise<string>}
 */
export async function translateText(text, direction) {
  const [result] = await translateBatch([text], direction);
  return result ?? '';
}

/**
 * Counters for the run report.
 * @returns {{ hits: number, translated: number, batches: number }}
 */
export function translationStats() {
  return { ...stats };
}

/**
 * Resets the counters (tests).
 */
export function resetTranslationStats() {
  stats = { hits: 0, translated: 0, batches: 0 };
}
