/**
 * Wrapper around the experimental on-device Translator API.
 *
 * Chrome and Edge expose `Translator` (and older builds `translation`), which
 * downloads a small language pack and translates locally: no API key, no
 * backend, no per-request cost, and nothing leaves the device.
 *
 * The API is experimental, so every entry point is feature-detected and the
 * callers treat "not available" as a normal outcome rather than an error.
 *
 * @see https://developer.chrome.com/docs/ai/translator-api
 */

const AVAILABLE = 'available';
const DOWNLOADABLE = 'downloadable';
const DOWNLOADING = 'downloading';
const UNAVAILABLE = 'unavailable';

// `availability()` reaches out to the component-updater service and can hang
// (offline, corporate proxy, blocked Google endpoints). Never let that hold up
// a render: give up quickly and let the caller fall back.
const AVAILABILITY_TIMEOUT_MS = 2500;
// A "no" is retried after a while, because the model may still be downloading.
const NEGATIVE_CACHE_MS = 2 * 60 * 1000;
// Downloading a language pack can take a while, but a create() that never
// settles must not block the recipe list forever.
const CREATE_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  // Clear the timer once the race settles, so a slow create() cannot keep the
  // event loop (or a test runner) alive.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @returns {boolean} whether this browser exposes the Translator API at all
 */
export function isBrowserTranslationSupported() {
  if (typeof globalThis.Translator?.create === 'function') return true;
  return typeof globalThis.translation?.createTranslator === 'function';
}

/**
 * Normalises the two known API shapes behind one small interface.
 * @returns {{availability: Function, create: Function}|null}
 */
function translatorApi() {
  const modern = globalThis.Translator;
  if (typeof modern?.create === 'function') {
    return {
      availability: options => modern.availability(options),
      create: options => modern.create(options)
    };
  }
  // Chrome 137 and earlier.
  const legacy = globalThis.translation;
  if (typeof legacy?.createTranslator === 'function') {
    return {
      availability: async ({ sourceLanguage, targetLanguage }) => {
        const result = await legacy.canTranslate({ sourceLanguage, targetLanguage });
        if (result === 'readily') return AVAILABLE;
        if (result === 'after-download') return DOWNLOADABLE;
        return UNAVAILABLE;
      },
      create: ({ sourceLanguage, targetLanguage, monitor }) =>
        legacy.createTranslator({ sourceLanguage, targetLanguage, monitor })
    };
  }
  return null;
}

export class BrowserTranslator {
  constructor() {
    this.translators = new Map();
    this.availability = new Map();
    this.memory = new Map();
    this.destroyed = false;
  }

  /**
   * @returns {boolean} whether the API exists in this browser
   */
  isSupported() {
    return isBrowserTranslationSupported();
  }

  /**
   * Whether this language pair is (or can become) available.
   * @param {string} sourceLanguage
   * @param {string} targetLanguage
   * @returns {Promise<boolean>}
   */
  async canTranslate(sourceLanguage, targetLanguage) {
    const api = translatorApi();
    if (!api) return false;
    const key = `${sourceLanguage}>${targetLanguage}`;
    const cached = this.availability.get(key);
    if (cached && (cached.usable || Date.now() - cached.at < NEGATIVE_CACHE_MS)) {
      return cached.usable;
    }
    const status = await this.status(sourceLanguage, targetLanguage);
    // "downloadable"/"downloading" resolve on first use, so they still count.
    const usable = status !== UNAVAILABLE;
    this.availability.set(key, { usable, at: Date.now() });
    return usable;
  }

  /**
   * Creates (once) the translator for a language pair, downloading the pack if
   * needed.
   * @param {string} sourceLanguage
   * @param {string} targetLanguage
   * @param {{ onProgress?: (fraction: number) => void }} [options]
   * @returns {Promise<Object|null>}
   */
  async ensure(sourceLanguage, targetLanguage, { onProgress } = {}) {
    const api = translatorApi();
    if (!api || this.destroyed) return null;
    const key = `${sourceLanguage}>${targetLanguage}`;
    if (this.translators.has(key)) return this.translators.get(key);
    if (!(await this.canTranslate(sourceLanguage, targetLanguage))) return null;

    const request = withTimeout(api.create({
      sourceLanguage,
      targetLanguage,
      monitor: monitor => {
        monitor?.addEventListener?.('downloadprogress', event => {
          if (typeof onProgress === 'function' && Number.isFinite(event.loaded)) {
            onProgress(Math.max(0, Math.min(1, event.loaded)));
          }
        });
      }
    }), CREATE_TIMEOUT_MS, null).catch(error => {
      console.warn(`Browser translation ${sourceLanguage}>${targetLanguage} is unavailable.`, error);
      this.availability.set(key, { usable: false, at: Date.now() });
      return null;
    });

    this.translators.set(key, request);
    return request;
  }

  /**
   * Translates one string. Repeated strings come from memory.
   * @param {string} text
   * @param {{ source: string, target: string, onProgress?: Function }} options
   * @returns {Promise<string>} the input when translation is unavailable
   */
  async translate(text, { source, target, onProgress } = {}) {
    const value = String(text ?? '');
    if (!value.trim()) return value;
    const memoKey = `${source}>${target}:${value}`;
    if (this.memory.has(memoKey)) return this.memory.get(memoKey);

    const translator = await this.ensure(source, target, { onProgress });
    if (!translator) return value;
    try {
      const translated = await translator.translate(value);
      const result = typeof translated === 'string' && translated.trim() ? translated : value;
      this.memory.set(memoKey, result);
      return result;
    } catch (error) {
      console.warn('Browser translation failed for a string.', error);
      return value;
    }
  }

  /**
   * Translates many strings in order, one at a time (the API has no batch call).
   * @param {string[]} texts
   * @param {{ source: string, target: string, onProgress?: Function }} options
   * @returns {Promise<string[]>}
   */
  async translateAll(texts, options = {}) {
    const results = [];
    for (const text of texts) {
      results.push(await this.translate(text, options));
    }
    return results;
  }

  /**
   * How far the language pack download has progressed, if it is downloading.
   * @param {string} sourceLanguage
   * @param {string} targetLanguage
   * @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'>}
   */
  async status(sourceLanguage, targetLanguage) {
    const api = translatorApi();
    if (!api) return UNAVAILABLE;
    try {
      const status = await withTimeout(
        api.availability({ sourceLanguage, targetLanguage }),
        AVAILABILITY_TIMEOUT_MS,
        UNAVAILABLE
      );
      return typeof status === 'string' ? status : UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  }

  destroy() {
    this.destroyed = true;
    this.translators.forEach(entry => {
      Promise.resolve(entry).then(translator => translator?.destroy?.()).catch(() => {});
    });
    this.translators.clear();
    this.memory.clear();
  }
}

export const TRANSLATION_STATUSES = { AVAILABLE, DOWNLOADABLE, DOWNLOADING, UNAVAILABLE };
