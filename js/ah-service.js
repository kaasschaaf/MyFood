import { BrowserCache } from './browser-cache.js';

const AH_API = 'https://api.ah.nl';
const CACHE_TTL = 30 * 60 * 1000;
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
    if (!product) return false;
    if (product.isOnlineOnly === true ||
        product.onlineOnly === true ||
        product.isOnlineExclusive === true ||
        product.isVirtualBundle === true ||
        /ONLINE_ONLY|ONLINE_EXCLUSIVE/i.test(String(product.orderAvailabilityStatus || '')) ||
        (product.availableOnline === true &&
          (product.availableInStore === false || product.isAvailableInStore === false))) {
      return true;
    }
    const availabilityDescription = [
      product.title,
      product.description,
      product.descriptionFull,
      product.descriptionHighlights,
      product.orderAvailabilityDescription,
      product.mainCategory,
      product.subCategory,
      ...(Array.isArray(product.extraDescriptions) ? product.extraDescriptions : []),
      ...(Array.isArray(product.stickers)
        ? product.stickers.flatMap(sticker => [sticker?.description, sticker?.label, sticker?.title])
        : []),
      ...(Array.isArray(product.propertyIcons)
        ? product.propertyIcons.flatMap(icon => [icon?.description, icon?.label, icon?.title])
        : [])
    ].filter(value => typeof value === 'string').join(' ');
    const onlineOnlyLabel = /alleen\s+online|uitsluitend\s+online|online[-\s]only|online[-\s]exclusief|alleen\s+via\s+(?:de\s+)?webshop/i;
    if (onlineOnlyLabel.test(availabilityDescription)) return true;

    const category = `${product.mainCategory || ''} ${product.subCategory || ''}`;
    const digitalProduct = /beltegoed|sim[-\s]?kaarten|digitale?\s+(?:code|opwaardering|voucher)|e[-\s]?gift/i
      .test(`${category} ${product.description || product.descriptionFull || ''}`);
    return digitalProduct && /\bonline\b|digitale?\s+(?:code|opwaardering|voucher)|e[-\s]?gift/i
      .test(`${product.title || ''} ${product.description || product.descriptionFull || ''}`);
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
    if (!forceRefresh && cached && Date.now() - cached.updatedAt < CACHE_TTL &&
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
    const currentPrice = Number(product?.currentPrice);
    const regularPrice = Number(product?.priceBeforeBonus);
    const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : regularPrice;
    if (!product || !Number.isFinite(price) || price <= 0 ||
        (product.webshopId === undefined && product.hqId === undefined)) return null;
    const bonusDescription = product.discountLabels?.map(label => label.defaultDescription).filter(Boolean).join(', ')
      || product.bonusPeriodDescription || '';
    const explicitlyOnlineOnly = this.isOnlineOnlyProduct(product);
    return {
      id: String(product.webshopId ?? product.hqId ?? ''),
      title: product.title || 'AH-product',
      price,
      regularPrice: Number.isFinite(regularPrice) && regularPrice > 0 ? regularPrice : price,
      unitSize: product.salesUnitSize || '',
      unitPriceDescription: product.unitPriceDescription || '',
      isBonus: Boolean(product.isBonus),
      bonusDescription,
      nutriScore: String(product.nutriscore || '').toUpperCase(),
      imageUrl: product.images?.find(image => image.url)?.url || '',
      priceIsRegularFallback: !(Number.isFinite(currentPrice) && currentPrice > 0),
      availableOnline: Boolean(product.availableOnline),
      isVirtualBundle: product.isVirtualBundle === true,
      isOnlineOnly: explicitlyOnlineOnly,
      isOrderable: product.isOrderable !== false,
      mainCategory: product.mainCategory || '',
      subCategory: product.subCategory || '',
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
