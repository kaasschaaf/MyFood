import { BrowserCache } from './browser-cache.js';
import { formatEuro } from './utils.js';
import { getLocale } from './i18n.js';
import { isOnlineOnlyProduct, normalizeProduct } from './ah-product.js';
import {
  calculateQuantityCost as calculateQuantityCostOf,
  normalizeQuantity as normalizeQuantityOf,
  parsePackageSize as parsePackageSizeOf,
  unitPriceFor as unitPriceForOf
} from './ah-pricing.js';
import {
  ingredientKeywords,
  ingredientHeadword,
  words as wordsOf,
  isRelevantProductForIngredient,
  normalizeText,
  productExactness,
  rankProductsForIngredient,
  selectProductForIngredient,
  wordMatchesHeadword
} from './ingredient-matching.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const configuredAHApi = String(globalThis.MYFOOD_AH_API_BASE || '').trim().replace(/\/+$/, '');
const AH_API = configuredAHApi ||
  (LOCAL_HOSTS.has(globalThis.location?.hostname) ? 'https://api.ah.nl' : '');
const CACHE_TTL = 30 * 60 * 1000;
// Zoek-/prijscache verloopt automatisch om middernacht (lokale tijd), zodat AH-bonusprijzen
// na de dag-/weekwissel opnieuw worden opgehaald in plaats van de oude cache te tonen.
function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
// Eenheid-omrekening, pakformaten en stukgewichten staan in js/ah-pricing.js,
// zodat de datapipeline en de app dezelfde prijs berekenen.
const NUTRITION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL = 300;
const PRODUCT_SEARCH_CACHE_PREFIX = 'ah-search-v5:';
const PRODUCT_SEARCH_PAGE_SIZE = 50;
export const ONLINE_ONLY_SETTING_KEY = 'myfood_ignore_online_only_products';
export const PRODUCT_SEARCH_CATEGORIES = {
  breadToppings: {
    label: 'Broodbeleg',
    ahSoort: '19945',
    mainCategory: 'Vleeswaren',
    subCategorySuffix: '(voorverpakt)'
  }
};

function hasProductSearchCategory(category) {
  return Object.prototype.hasOwnProperty.call(PRODUCT_SEARCH_CATEGORIES, category) ||
    /^\d+$/.test(String(category || ''));
}

function getAHSoort(category) {
  if (Object.prototype.hasOwnProperty.call(PRODUCT_SEARCH_CATEGORIES, category)) {
    return PRODUCT_SEARCH_CATEGORIES[category].ahSoort;
  }
  return /^\d+$/.test(String(category || '')) ? String(category) : '';
}

/**
 * AH Service - anonymous product search, price calculations and currency formatting
 */
export class AHService {
  constructor(cache = new BrowserCache()) {
    this.cache = cache;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.lastRequestAt = 0;
    this.requestQueue = Promise.resolve();
    this.searchesInFlight = new Map();
    this.revalidatedQueries = new Set();
    this.staleQueries = new Set();
    this.queryErrors = new Map();
    this.nutritionRequests = new Map();
    this.ignoreOnlineOnlyProducts = this.readOnlineOnlyPreference();
  }

  readOnlineOnlyPreference() {
    try {
      return localStorage.getItem(ONLINE_ONLY_SETTING_KEY) !== 'false';
    } catch (error) {
      console.warn('Online-only voorkeur kon niet worden gelezen; online-only producten worden genegeerd.', error);
      return true;
    }
  }

  getIgnoreOnlineOnlyProducts() {
    this.ignoreOnlineOnlyProducts = this.readOnlineOnlyPreference();
    return this.ignoreOnlineOnlyProducts;
  }

  setIgnoreOnlineOnlyProducts(enabled) {
    this.ignoreOnlineOnlyProducts = Boolean(enabled);
    try {
      localStorage.setItem(ONLINE_ONLY_SETTING_KEY, String(this.ignoreOnlineOnlyProducts));
    } catch (error) {
      console.error('Online-only voorkeur kon niet worden opgeslagen.', error);
      throw new Error('De online-only instelling kon niet worden opgeslagen in deze browser.');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('myfood:online-only-setting-changed', {
        detail: { enabled: this.ignoreOnlineOnlyProducts }
      }));
    }
    return this.ignoreOnlineOnlyProducts;
  }

  filterProductsByOnlinePreference(products = []) {
    const ignoreOnlineOnly = this.getIgnoreOnlineOnlyProducts();
    return products
      .map(product => ({
        ...product,
        isOnlineOnly: product.isOnlineOnly === true || this.isOnlineOnlyProduct(product)
      }))
      .filter(product => !ignoreOnlineOnly || !product.isOnlineOnly);
  }

  isOnlineOnlyProduct(product) {
    return isOnlineOnlyProduct(product);
  }

  async getAnonymousToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    if (!AH_API) {
      throw new Error('Live AH-productgegevens vereisen de AH-proxy. Stel de GitHub Actions-variabele AH_API_PROXY_URL in en deploy de Cloudflare Worker zoals beschreven in README.md.');
    }
    const response = await fetch(`${AH_API}/mobile-auth/v1/auth/token/anonymous`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-application': 'AHWEBSHOP'
      },
      body: JSON.stringify({ clientId: 'appie' })
    });
    if (!response.ok) {
      throw new Error(`Anonieme AH-toegang niet beschikbaar (${response.status}).`);
    }

    const result = await response.json();
    if (!result.access_token) {
      throw new Error('De anonieme AH-aanmelding gaf geen toegangstoken terug.');
    }
    this.accessToken = result.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 600) * 1000 - 30000;
    return this.accessToken;
  }

  async waitForRequestSlot() {
    const previous = this.requestQueue;
    let release;
    this.requestQueue = new Promise(resolve => { release = resolve; });
    await previous;
    const delay = Math.max(0, MIN_REQUEST_INTERVAL - (Date.now() - this.lastRequestAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
    release();
  }

  async searchProducts(query, {
    forceRefresh = false,
    revalidate = false,
    page = 0,
    category = '',
    categoryLabel = ''
  } = {}) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return { products: [], updatedAt: null, stale: false };
    category = hasProductSearchCategory(category) ? category : '';
    const requestKey = `${normalizedQuery}:category:${category || 'all'}:page:${page}`;
    const cacheKey = `${PRODUCT_SEARCH_CACHE_PREFIX}${requestKey}`;
    const cached = await this.readCache(cacheKey);
    // Geldig als de cache nog binnen de TTL valt EN vandaag is opgehaald.
    // Zo worden prijzen na middernacht automatisch opnieuw opgehaald (nieuwe AH-bonusdag).
    const cacheIsFromToday = Boolean(cached) && cached.updatedAt >= startOfTodayLocal();
    if (!forceRefresh && cached && cacheIsFromToday && Date.now() - cached.updatedAt < CACHE_TTL &&
        (!revalidate || this.revalidatedQueries.has(requestKey))) {
      return {
        ...cached.value,
        products: this.filterSearchProducts(cached.value.products, category, categoryLabel),
        updatedAt: cached.updatedAt,
        stale: this.staleQueries.has(requestKey),
        fromCache: true
      };
    }
    if (revalidate && this.revalidatedQueries.has(requestKey) && this.queryErrors.has(requestKey)) {
      if (cached?.value?.products?.length) {
        return {
          ...cached.value,
          products: this.filterSearchProducts(cached.value.products, category, categoryLabel),
          updatedAt: cached.updatedAt,
          stale: true,
          fromCache: true
        };
      }
      throw this.queryErrors.get(requestKey);
    }
    if (this.searchesInFlight.has(requestKey)) {
      const result = await this.searchesInFlight.get(requestKey);
      return { ...result, products: this.filterSearchProducts(result.products, category, categoryLabel) };
    }

    this.revalidatedQueries.add(requestKey);
    const searchPromise = this.fetchProducts(normalizedQuery, cached, page, category, categoryLabel)
      .finally(() => this.searchesInFlight.delete(requestKey));
    this.searchesInFlight.set(requestKey, searchPromise);
    const result = await searchPromise;
    return { ...result, products: this.filterSearchProducts(result.products, category, categoryLabel) };
  }

  filterSearchProducts(products, category = '', categoryLabel = '') {
    const categoryFilter = PRODUCT_SEARCH_CATEGORIES[category] ||
      Object.values(PRODUCT_SEARCH_CATEGORIES).find(filter => filter.ahSoort === category);
    const normalizedLabel = String(categoryLabel || '').trim().toLocaleLowerCase('nl-NL');
    let matchingProducts = products;
    if (categoryFilter) {
      matchingProducts = products.filter(product =>
        product.mainCategory?.toLowerCase() === categoryFilter.mainCategory.toLowerCase() &&
        product.subCategory?.toLowerCase().endsWith(categoryFilter.subCategorySuffix.toLowerCase())
      );
    } else if (category) {
      matchingProducts = normalizedLabel
        ? products.filter(product =>
          product.mainCategory?.toLocaleLowerCase('nl-NL') === normalizedLabel ||
          product.subCategory?.toLocaleLowerCase('nl-NL') === normalizedLabel
        )
        : [];
    }
    return this.filterProductsByOnlinePreference(matchingProducts);
  }

  async fetchSearchCategories(query) {
    const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ');
    if (normalizedQuery.length < 2) throw new Error('Vul eerst minimaal 2 tekens in om AH-categorieën op te halen.');

    await this.waitForRequestSlot();
    let token = await this.getAnonymousToken();
    const url = new URL(`${AH_API}/mobile-services/product/search/v2`);
    url.searchParams.set('query', normalizedQuery);
    url.searchParams.set('page', '0');
    url.searchParams.set('size', '1');
    url.searchParams.set('sortOn', 'RELEVANCE');

    let response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-application': 'AHWEBSHOP',
        Authorization: `Bearer ${token}`
      }
    });
    if (response.status === 401) {
      this.accessToken = null;
      token = await this.getAnonymousToken();
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'x-application': 'AHWEBSHOP',
          Authorization: `Bearer ${token}`
        }
      });
    }
    if (!response.ok) throw new Error(`AH-categorieën ophalen mislukt (${response.status}) voor "${normalizedQuery}".`);

    const payload = await response.json();
    const taxonomy = payload.filters?.find(filter => filter.id === 'taxonomy');
    return (taxonomy?.options || [])
      .filter(option => /^\d+$/.test(String(option.id || '')) &&
        typeof option.label === 'string' &&
        option.label.trim() &&
        option.display !== false &&
        Number(option.count) > 0)
      .map(option => ({
        id: String(option.id),
        label: option.label.trim(),
        count: Number(option.count)
      }));
  }

  async fetchProducts(query, cached, page = 0, category = '', categoryLabel = '') {
    try {
      await this.waitForRequestSlot();
      let token = await this.getAnonymousToken();
      const url = new URL(`${AH_API}/mobile-services/product/search/v2`);
      url.searchParams.set('query', query);
      url.searchParams.set('page', String(page));
      url.searchParams.set('size', String(PRODUCT_SEARCH_PAGE_SIZE));
      url.searchParams.set('sortOn', 'RELEVANCE');
      const soort = getAHSoort(category);
      if (soort) url.searchParams.set('Soort', soort);

      let response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'x-application': 'AHWEBSHOP',
          Authorization: `Bearer ${token}`
        }
      });
      if (response.status === 401) {
        this.accessToken = null;
        token = await this.getAnonymousToken();
        response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'x-application': 'AHWEBSHOP',
            Authorization: `Bearer ${token}`
          }
        });
      }
      if (!response.ok) throw new Error(`AH product zoeken mislukt (${response.status}) voor "${query}".`);

      const payload = await response.json();
      const result = {
        products: (payload.products || []).map(product => this.normalizeProduct(product)).filter(Boolean),
        pageInfo: {
          number: Number(payload.page?.number) || 0,
          size: Number(payload.page?.size) || PRODUCT_SEARCH_PAGE_SIZE,
          totalElements: Number(payload.page?.totalElements) || 0,
          nextPage: payload.links?.next ? page + 1 : null
        },
        updatedAt: Date.now(),
        stale: false,
        fromCache: false
      };
      const requestKey = `${query}:category:${category || 'all'}:page:${page}`;
      await this.writeCache(`${PRODUCT_SEARCH_CACHE_PREFIX}${requestKey}`, result);
      this.staleQueries.delete(requestKey);
      this.queryErrors.delete(requestKey);
      return result;
    } catch (error) {
      console.warn(`Live AH-zoekopdracht mislukt voor "${query}".`, error);
      const requestKey = `${query}:category:${category || 'all'}:page:${page}`;
      this.staleQueries.add(requestKey);
      this.queryErrors.set(requestKey, error);
      if (cached?.value?.products?.length) {
        return {
          ...cached.value,
          products: this.filterSearchProducts(cached.value.products, category, categoryLabel),
          updatedAt: cached.updatedAt,
          stale: true,
          fromCache: true
        };
      }
      throw error;
    }
  }

  async getProductNutrition(webshopId) {
    const productId = String(webshopId || '').trim();
    if (!/^\d+$/.test(productId)) throw new Error('Ongeldig AH-productnummer voor voedingswaarden.');
    const cacheKey = `ah-nutrition-v1:${productId}`;
    const cached = await this.readCache(cacheKey);
    if (cached && Date.now() - cached.updatedAt < NUTRITION_CACHE_TTL) return cached.value;
    if (this.nutritionRequests.has(productId)) return this.nutritionRequests.get(productId);

    const request = this.fetchProductNutrition(productId, cacheKey)
      .finally(() => this.nutritionRequests.delete(productId));
    this.nutritionRequests.set(productId, request);
    return request;
  }

  async fetchProductNutrition(productId, cacheKey) {
    await this.waitForRequestSlot();
    let token = await this.getAnonymousToken();
    const url = `${AH_API}/mobile-services/product/detail/v4/fir/${encodeURIComponent(productId)}`;
    const getDetails = accessToken => fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-application': 'AHWEBSHOP',
        Authorization: `Bearer ${accessToken}`
      }
    });
    let response = await getDetails(token);
    if (response.status === 401) {
      this.accessToken = null;
      token = await this.getAnonymousToken();
      response = await getDetails(token);
    }
    if (!response.ok) {
      throw new Error(`AH-voedingswaarden ophalen mislukt (${response.status}) voor product ${productId}.`);
    }

    const details = await response.json();
    const header = details.tradeItem?.nutritionalInformation?.nutrientHeaders?.[0];
    const nutrients = header?.nutrientDetail || [];
    const basisAmount = Number(header?.nutrientBasisQuantity?.value);
    const basisUnit = String(header?.nutrientBasisQuantity?.measurementUnitCode?.value || '').toLowerCase();
    const per100Factor = basisAmount > 0 && ['g', 'ml'].includes(basisUnit) ? 100 / basisAmount : null;
    const nutrientValue = (codes, units) => {
      for (const nutrient of nutrients) {
        if (!codes.includes(nutrient.nutrientTypeCode?.value)) continue;
        const quantity = nutrient.quantityContained?.find(item =>
          units.includes(String(item.measurementUnitCode?.value || '').toLowerCase())
        );
        const value = Number(quantity?.value);
        if (Number.isFinite(value)) return value;
      }
      return null;
    };
    const rawProtein = nutrientValue(['PRO-', 'PROT'], ['g']);
    const rawEnergyKcal = nutrientValue(['ENER-'], ['kcal']);
    const rawEnergyKj = nutrientValue(['ENER-'], ['kj']);
    const energyKcal = rawEnergyKcal ?? (rawEnergyKj === null ? null : rawEnergyKj / 4.184);
    const proteinGrams = rawProtein === null || per100Factor === null
      ? null
      : Math.round(rawProtein * per100Factor * 10) / 10;
    const caloriesPer100 = energyKcal === null || per100Factor === null
      ? null
      : energyKcal * per100Factor;
    const proteinScore = proteinGrams === null || !caloriesPer100
      ? null
      : Math.min(100, Math.round((proteinGrams * 4 / caloriesPer100) * 100));
    const result = {
      proteinGrams,
      proteinScore,
      caloriesPer100: caloriesPer100 === null ? null : Math.round(caloriesPer100)
    };
    await this.writeCache(cacheKey, result);
    return result;
  }

  normalizeProduct(product) {
    return normalizeProduct(product);
  }

  async getSavedMatch(recipeId, ingredientName) {
    return this.readCache(this.getMatchCacheKey(recipeId, ingredientName));
  }

  async saveMatch(recipeId, ingredientName, product) {
    await this.writeCache(this.getMatchCacheKey(recipeId, ingredientName), product);
  }

  getMatchCacheKey(recipeId, ingredientName) {
    // v2: producten worden nu op bruikbaarheid gekozen, dus oude keuzes
    // (zoals een kruidenmix bij broccoli) mogen niet hergebruikt worden.
    return `ah-match-v2:${recipeId}:${ingredientName.trim().toLowerCase()}`;
  }

  async readCache(key) {
    try {
      return await this.cache.get(key);
    } catch (error) {
      console.warn(`Cache lezen mislukt voor "${key}".`, error);
      return null;
    }
  }

  async writeCache(key, value) {
    try {
      return await this.cache.set(key, value);
    } catch (error) {
      console.warn(`Cache opslaan mislukt voor "${key}".`, error);
      return null;
    }
  }

  calculateRecipePrice(recipe, servings = 2) {
    const scale = servings / (recipe.baseServings || 2);
    let totalPrice = 0;
    let totalStandardPrice = 0;
    let bonusCount = 0;
    let allIngredientsPriced = Boolean(recipe.ingredients?.length);
    let matchedIngredientCount = 0;
    let pricedIngredientCount = 0;

    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
      return this.emptyPrice();
    }

    recipe.ingredients.forEach(ingredient => {
      let actualPrice;
      let regularPrice;
      // Static dataset recipes are priced from the same product-shaped
      // snapshot as a live search, so they take the same branch.
      if (recipe.sourceUrl || recipe.livePriced || recipe.staticPriced) {
        const product = ingredient.selectedAHProduct;
        if (product) matchedIngredientCount++;
        const quantityCost = product && this.calculateQuantityCost(ingredient, product, scale);
        if (!quantityCost) {
          allIngredientsPriced = false;
          return;
        }
        actualPrice = quantityCost.current;
        regularPrice = quantityCost.regular;
      } else {
        regularPrice = ingredient.standardPrice;
        if (!Number.isFinite(regularPrice) || regularPrice <= 0) {
          allIngredientsPriced = false;
          return;
        }
        actualPrice = regularPrice;
        actualPrice *= scale;
        regularPrice *= scale;
        matchedIngredientCount++;
      }

      totalPrice += actualPrice;
      totalStandardPrice += regularPrice;
      pricedIngredientCount++;
      if (regularPrice > actualPrice) bonusCount++;
    });

    totalPrice = this.roundEuro(totalPrice);
    totalStandardPrice = this.roundEuro(totalStandardPrice);
    return {
      totalPrice,
      pricePerPerson: servings > 0 ? this.roundEuro(totalPrice / servings) : 0,
      totalStandardPrice,
      totalSavings: this.roundEuro(Math.max(0, totalStandardPrice - totalPrice)),
      hasBonus: bonusCount > 0,
      bonusCount,
      hasPriceData: allIngredientsPriced,
      hasAnyPriceData: pricedIngredientCount > 0,
      matchedIngredientCount,
      ingredientCount: recipe.ingredients.length,
      pricedIngredientCount,
      unmatchedIngredientCount: recipe.ingredients.length - matchedIngredientCount,
      unpricedIngredientCount: recipe.ingredients.length - pricedIngredientCount
    };
  }

  /**
   * Leest de pakinhoud uit AH's `unitSize`, bijvoorbeeld "400 g", "ca. 500 g",
   * "2 x 150 g", "0,5 l" of "per stuk".
   * @param {string} unitSize
   * @returns {{amount: number, unit: string}|null}
   */
  parsePackageSize(unitSize) {
    return parsePackageSizeOf(unitSize);
  }

  /**
   * Prijs per kilo, liter of stuk, zodat verpakkingen onderling te vergelijken
   * zijn.
   * @param {Object} product
   * @returns {{amount: number, unit: 'kg'|'l'|'stuk', regular: number}|null}
   */
  unitPriceFor(product) {
    return unitPriceForOf(product);
  }

  /**
   * Berekent wat het receptgedeelte van dit product kost.
   * @param {Object} ingredient
   * @param {Object} product
   * @param {number} scale
   * @returns {{current: number, regular: number, quantityRatio: number}|null}
   */
  calculateQuantityCost(ingredient, product, scale) {
    return calculateQuantityCostOf(ingredient, product, scale);
  }

  normalizeText(value) {
    return normalizeText(value);
  }

  /**
   * Het zelfstandig naamwoord van een ingrediënt ("zoete aardappel" -> "aardappel").
   * @param {string} name
   * @returns {string}
   */
  ingredientHeadword(name) {
    return ingredientHeadword(name);
  }

  /**
   * De betekenisvolle woorden van een ingrediënt.
   * @param {string} name
   * @returns {string[]}
   */
  ingredientKeywords(name) {
    return ingredientKeywords(name);
  }

  words(text) {
    return wordsOf(text);
  }

  wordMatchesHeadword(word, headword) {
    return wordMatchesHeadword(word, headword);
  }

  /**
   * Bepaalt of een AH-product echt het ingrediënt is.
   * @param {string} ingredientName
   * @param {Object} product
   * @returns {boolean}
   */
  isRelevantProductForIngredient(ingredientName, product) {
    return isRelevantProductForIngredient(ingredientName, product);
  }

  /**
   * Hoe precies het product het ingrediënt is (2 = begint ermee, 1 = zelfde schap).
   * @param {string} ingredientName
   * @param {Object} product
   * @returns {number}
   */
  productExactness(ingredientName, product) {
    return productExactness(ingredientName, product);
  }

  /**
   * Sorteert producten op bruikbaarheid en daarna op prijs.
   * @param {Object} ingredient
   * @param {Array} products
   * @param {number} scale
   * @returns {Array}
   */
  rankProductsForIngredient(ingredient, products = [], scale = 1) {
    return rankProductsForIngredient(ingredient, products, scale, this.matchingDeps());
  }

  /**
   * Kiest het goedkoopste product dat ook echt het ingrediënt is.
   * @param {Object} ingredient
   * @param {Array} products
   * @param {number} scale
   * @returns {{product: Object|null, relevant: boolean, ranked: Array, matchedIds: string[]}}
   */
  selectProductForIngredient(ingredient, products = [], scale = 1) {
    return selectProductForIngredient(ingredient, products, scale, this.matchingDeps());
  }

  /**
   * The parts of this service the pure matching module needs.
   * @returns {Object}
   */
  matchingDeps() {
    return {
      filterProducts: list => this.filterProductsByOnlinePreference(list),
      quantityCost: (ingredient, product, scale) => this.calculateQuantityCost(ingredient, product, scale),
      packageSize: unitSize => this.parsePackageSize(unitSize),
      normalizeQuantity: (amount, unit) => this.normalizeQuantity(amount, unit)
    };
  }

  normalizeQuantity(amount, unit = '') {
    return normalizeQuantityOf(amount, unit);
  }

  emptyPrice() {
    return {
      totalPrice: 0,
      pricePerPerson: 0,
      totalStandardPrice: 0,
      totalSavings: 0,
      hasBonus: false,
      bonusCount: 0,
      hasPriceData: false,
      hasAnyPriceData: false,
      matchedIngredientCount: 0,
      ingredientCount: 0,
      pricedIngredientCount: 0,
      unmatchedIngredientCount: 0,
      unpricedIngredientCount: 0
    };
  }

  roundEuro(amount) {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  formatEuro(amount) {
    return formatEuro(amount, getLocale());
  }
}
