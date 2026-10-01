import { BrowserCache } from './browser-cache.js';

const AH_API = 'https://api.ah.nl';
const CACHE_TTL = 30 * 60 * 1000;
const MIN_REQUEST_INTERVAL = 300;

/**
 * AH Service - anonymous product search, price calculations and currency formatting
 */
export class AHService {
  constructor(cache = new BrowserCache()) {
    this.bonusData = null;
    this.cache = cache;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.lastRequestAt = 0;
    this.requestQueue = Promise.resolve();
    this.searchesInFlight = new Map();
    this.revalidatedQueries = new Set();
    this.staleQueries = new Set();
    this.queryErrors = new Map();
  }

  async init() {
    try {
      const response = await fetch('./data/ah-bonus.json');
      if (!response.ok) throw new Error(`AH bonus-data laden mislukt (${response.status}).`);
      this.bonusData = await response.json();
    } catch (error) {
      console.warn('AH bonus-data niet beschikbaar; eerder opgeslagen receptprijzen blijven bruikbaar.', error);
    }
  }

  async getAnonymousToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
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

  async searchProducts(query, { forceRefresh = false, revalidate = false } = {}) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return { products: [], updatedAt: null, stale: false };
    const cacheKey = `ah-search:${normalizedQuery}`;
    const cached = await this.readCache(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.updatedAt < CACHE_TTL &&
        (!revalidate || this.revalidatedQueries.has(normalizedQuery))) {
      return {
        ...cached.value,
        updatedAt: cached.updatedAt,
        stale: this.staleQueries.has(normalizedQuery),
        fromCache: true
      };
    }
    if (revalidate && this.revalidatedQueries.has(normalizedQuery) && this.queryErrors.has(normalizedQuery)) {
      if (cached?.value?.products?.length) {
        return { ...cached.value, updatedAt: cached.updatedAt, stale: true, fromCache: true };
      }
      throw this.queryErrors.get(normalizedQuery);
    }
    if (this.searchesInFlight.has(normalizedQuery)) return this.searchesInFlight.get(normalizedQuery);

    this.revalidatedQueries.add(normalizedQuery);
    const searchPromise = this.fetchProducts(normalizedQuery, cached)
      .finally(() => this.searchesInFlight.delete(normalizedQuery));
    this.searchesInFlight.set(normalizedQuery, searchPromise);
    return searchPromise;
  }

  async fetchProducts(query, cached) {
    try {
      await this.waitForRequestSlot();
      let token = await this.getAnonymousToken();
      const url = new URL(`${AH_API}/mobile-services/product/search/v2`);
      url.searchParams.set('query', query);
      url.searchParams.set('page', '0');
      url.searchParams.set('size', '8');
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
      if (!response.ok) throw new Error(`AH product zoeken mislukt (${response.status}) voor "${query}".`);

      const payload = await response.json();
      const result = {
        products: (payload.products || []).map(product => this.normalizeProduct(product)).filter(Boolean),
        updatedAt: Date.now(),
        stale: false,
        fromCache: false
      };
      await this.writeCache(`ah-search:${query}`, result);
      this.staleQueries.delete(query);
      this.queryErrors.delete(query);
      return result;
    } catch (error) {
      console.warn(`Live AH-zoekopdracht mislukt voor "${query}".`, error);
      this.staleQueries.add(query);
      this.queryErrors.set(query, error);
      if (cached?.value?.products?.length) {
        return { ...cached.value, updatedAt: cached.updatedAt, stale: true, fromCache: true };
      }
      throw error;
    }
  }

  normalizeProduct(product) {
    if (!product || product.currentPrice === null || product.currentPrice === undefined ||
        !Number.isFinite(Number(product.currentPrice)) || Number(product.currentPrice) <= 0 ||
        (product.webshopId === undefined && product.hqId === undefined)) return null;
    const bonusDescription = product.discountLabels?.map(label => label.defaultDescription).filter(Boolean).join(', ')
      || product.bonusPeriodDescription || '';
    return {
      id: String(product.webshopId ?? product.hqId ?? ''),
      title: product.title || 'AH-product',
      price: Number(product.currentPrice),
      regularPrice: Number(product.priceBeforeBonus) || Number(product.currentPrice),
      unitSize: product.salesUnitSize || '',
      unitPriceDescription: product.unitPriceDescription || '',
      isBonus: Boolean(product.isBonus),
      bonusDescription,
      isOrderable: product.isOrderable !== false,
      productUrl: product.webshopId
        ? `https://www.ah.nl/producten/product/wi${encodeURIComponent(product.webshopId)}`
        : `https://www.ah.nl/zoeken?query=${encodeURIComponent(product.title || '')}`
    };
  }

  async getSavedMatch(recipeId, ingredientName) {
    return this.readCache(this.getMatchCacheKey(recipeId, ingredientName));
  }

  async saveMatch(recipeId, ingredientName, product) {
    await this.writeCache(this.getMatchCacheKey(recipeId, ingredientName), product);
  }

  getMatchCacheKey(recipeId, ingredientName) {
    return `ah-match:${recipeId}:${ingredientName.trim().toLowerCase()}`;
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
      if (recipe.sourceUrl) {
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
        const discount = this.bonusData?.discounts?.[ingredient.ahProductId];
        const isBonus = discount?.isBonus ?? ingredient.isBonus;
        regularPrice = Number(discount?.originalPrice) || regularPrice;
        actualPrice = isBonus
          ? Number(discount?.bonusPrice) || Number(ingredient.bonusPrice) || regularPrice
          : regularPrice;
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

  calculateQuantityCost(ingredient, product, scale) {
    if (!Number.isFinite(ingredient.amount) || ingredient.amount <= 0) return null;
    const ingredientQuantity = this.normalizeQuantity(ingredient.amount, ingredient.unit);
    const packMatch = String(product.unitSize || '')
      .match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|stuks?|pieces?|pcs?)\b/i);
    if (!ingredientQuantity || !packMatch) return null;
    const packageQuantity = this.normalizeQuantity(Number(packMatch[1].replace(',', '.')), packMatch[2]);
    if (!packageQuantity || packageQuantity.unit !== ingredientQuantity.unit) return null;

    const amountUsed = ingredientQuantity.amount * scale;
    const quantityRatio = amountUsed / packageQuantity.amount;
    return {
      current: product.price * quantityRatio,
      regular: product.regularPrice * quantityRatio
    };
  }

  normalizeQuantity(amount, unit = '') {
    const normalizedUnit = unit.toLowerCase().replace(/\./g, '').trim();
    if (['g', 'gram', 'grams'].includes(normalizedUnit)) return { amount, unit: 'weight' };
    if (['kg', 'kilogram', 'kilograms'].includes(normalizedUnit)) return { amount: amount * 1000, unit: 'weight' };
    if (['ml', 'milliliter', 'milliliters'].includes(normalizedUnit)) return { amount, unit: 'volume' };
    if (['l', 'liter', 'litre', 'liters', 'litres'].includes(normalizedUnit)) return { amount: amount * 1000, unit: 'volume' };
    if (['stuks', 'stuk', 'piece', 'pieces', 'pc', 'pcs'].includes(normalizedUnit)) return { amount, unit: 'count' };
    return null;
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
    if (isNaN(amount) || amount === null) return '€ 0,00';
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }
}
