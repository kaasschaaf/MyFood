import { BrowserCache } from './browser-cache.js';
import { formatEuro } from './utils.js';
import { getLocale } from './i18n.js';

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
// Recepten uit verschillende bronnen gebruiken verschillende maten. Door ze
// naar gram, milliliter of stuks om te rekenen kan dezelfde pakprijs worden
// gebruikt, ook voor TheMealDB (oz, lb, cups, tsp) en Nederlandse maten (tl, el).
// Ingrediëntnamen bevatten veel vulwoorden; alleen de zelfstandige naamwoorden
// zeggen iets over welk product erbij hoort.
const INGREDIENT_STOPWORDS = new Set([
  'fresh', 'freshly', 'dried', 'ground', 'chopped', 'sliced', 'diced', 'minced', 'crushed', 'grated',
  'peeled', 'large', 'small', 'medium', 'whole', 'plain', 'extra', 'virgin', 'boneless', 'skinless',
  'lean', 'raw', 'cooked', 'of', 'the', 'and', 'with', 'for', 'to', 'taste', 'a', 'an', 'or', 'x',
  'into', 'cut', 'pieces', 'piece', 'halve', 'half', 'cloves', 'clove', 'leaves', 'leaf', 'pinch',
  'splash', 'sprinkling', 'handful', 'can', 'cans', 'tin', 'packet', 'pack', 'grams', 'gram', 'g',
  'kg', 'ml', 'l', 'oz', 'lb', 'lbs', 'cups', 'cup', 'tbsp', 'tsp', 'tablespoons', 'teaspoons',
  'stuks', 'stuk', 'el', 'tl', 'ca', 'about', 'optional', 'plus', 'more', 'as', 'needed', 'good',
  'big', 'little', 'few', 'some', 'each', 'your', 'favourite', 'favorite'
]);

// Woorden die aangeven dat het product een gerecht of mix is waarin het
// ingrediënt slechts voorkomt. Een "bakplaat mix broccoli" is geen broccoli.
const COMPOSITE_MARKERS = [
  'mix', 'kruidenmix', 'maaltijdmix', 'maaltijdpakket', 'ovenschotel', 'dagschotel', 'schotel',
  'stamppot', 'soep', 'salade', 'burger', 'hapje', 'knijpfruit', 'maaltijd', 'pizza', 'saus',
  'dressing', 'snack', 'chips', 'lasagne', 'tortellini', 'cake', 'taart', 'muffin', 'pannenkoek',
  'smoothie', 'granola', 'koek', 'gebak', 'pronto', 'ovengroente', 'roerbakgroente', 'soepgroente',
  'kruiden', 'specerij', 'bouillon', 'instant',
  // Bewerkt: wel het ingrediënt, niet bruikbaar als los ingrediënt.
  'zoetzuur', 'ingelegd', 'poeder', 'puree', 'siroop', 'jam', 'chutney', 'gemarineerd',
  'pesto', 'tapenade', 'hummus', 'ketchup', 'mayonaise',
  // Andere basisproducten die op het ingrediënt lijken.
  'karnemelk', 'koffiemelk', 'sojamelk', 'amandelmelk', 'havermelk', 'rijstmelk', 'geitenmelk',
  'chocolademelk', 'drinkyoghurt', 'sojadrink', 'amandeldrink', 'bloemkool', 'opscuimmelk',
  'baristamelk', 'stemgember', 'bakgember', 'passata', 'tomatenpuree'
];

// Bijvoeglijke naamwoorden die vóór het zelfstandig naamwoord staan
// ("gele uien", "rode puntpaprika") en zelf niets over het product zeggen.
const PRODUCT_ADJECTIVES = new Set([
  'geel', 'gele', 'rood', 'rode', 'wit', 'witte', 'groen', 'groene', 'bruin', 'bruine', 'paars', 'paarse',
  'oranje', 'zwart', 'zwarte', 'klein', 'kleine', 'groot', 'grote', 'jong', 'jonge', 'oud', 'oude', 'vers',
  'verse', 'diepvries', 'extra', 'fijn', 'fijne', 'grof', 'grove', 'heel', 'halve', 'half', 'sweet', 'mild',
  'milde', 'zoet', 'zoete', 'pittig', 'pittige', 'naturel', 'puur', 'luxe', 'klasse', 'gesneden', 'geraspt',
  'gemalen', 'ongezouten', 'gezouten', 'vrije', 'uitloop', 'scharrel', 'biologisch', 'bio', 'hollandse',
  'mager', 'magere', 'halfvolle', 'volle', 'houdbare', 'gepasteuriseerde', 'rauwe', 'grofgesneden',
  'light', 'luchtig', 'romig', 'romige', 'fris', 'frisse', 'zoetzuur',
  'nederlandse', 'italiaanse', 'franse', 'duitse', 'spaanse', 'griekse', 'verse', 'los', 'per', 'ca'
]);

// Merken en kwalificaties die vóór de productnaam staan.
const PRODUCT_PREFIXES = [
  'ah', 'jumbo', 'plus', 'aldi', 'lidl', 'dirk', 'coop', 'spar', 'honig', 'maggi', 'knorr', 'bonduelle',
  'olvarit', 'conimex', 'hak', 'iglo', 'mora', 'heinz', 'calve', 'unox', 'campina', 'optimel', 'arla',
  'melkan', 'natura', 'biologisch', 'bio', 'vers', 'verse', 'diepvries', 'hollandse', 'nederlandse',
  'terra', 'ella s kitchen'
];
const PRODUCT_PREFIX_PATTERN = new RegExp(`^(?:${PRODUCT_PREFIXES.join('|')}) +`);

// Schappen met kant-en-klare gerechten of babyvoeding: daar zit het ingrediënt
// in verwerkt, maar het is geen bruikbare vervanging. Alleen op het subschap
// letten: AH zet bijvoorbeeld suiker onder "Maaltijden, salades".
const PREPARED_FOOD_MAIN_CATEGORIES = ['baby en kind'];
const PREPARED_FOOD_SUBCATEGORIES = [
  'knijphapje', 'maaltijden vanaf', 'hapje', 'verse soepen', 'soep', 'stamppot', 'salade'
];

// Meer pakken dan dit betekent dat het product qua formaat niet bij het recept
// past (bijv. een kruidenmix van 36 g voor 350 g groente).
const MAX_PACKS_PER_INGREDIENT = 6;
// Een verpakking die veel groter is dan nodig is ("30 eieren" voor 2 eieren)
// is wel het goedkoopst per stuk, maar niet wat je voor dit recept koopt.
const MAX_PACK_OVERSHOOT = 4;
// Volume en gewicht zijn voor sauzen, oliën en dranken ongeveer gelijk.
const VOLUME_WEIGHT_EQUIVALENTS = new Set(['volume>weight', 'weight>volume']);

// Recepten vragen "4 tortilla's" of "1 ui" waar AH in grammen verkoopt. Deze
// richtgewichten overbruggen dat; ze zijn bewust afgerond en alleen bedoeld om
// de kosten te schatten.
const PIECE_WEIGHT_GRAMS = {
  tortilla: 40,
  wrap: 40,
  naan: 90,
  pita: 60,
  broodje: 60,
  boterham: 35,
  ei: 55,
  eieren: 55,
  ui: 100,
  uien: 100,
  sjalot: 40,
  sjalotten: 40,
  knoflook: 5,
  teen: 5,
  wortel: 70,
  wortels: 70,
  aardappel: 150,
  aardappelen: 150,
  tomaat: 120,
  tomaten: 120,
  paprika: 150,
  citroen: 100,
  limoen: 80,
  appel: 150,
  appels: 150,
  banaan: 120,
  avocado: 200,
  courgette: 250,
  aubergine: 300,
  prei: 150,
  bleekselderij: 60,
  champignon: 15,
  champignons: 15,
  bosui: 15,
  stengel: 40,
  takje: 2
};

const QUANTITY_UNITS = {
  g: ['weight', 1],
  gram: ['weight', 1],
  grams: ['weight', 1],
  gr: ['weight', 1],
  kg: ['weight', 1000],
  kilogram: ['weight', 1000],
  kilograms: ['weight', 1000],
  oz: ['weight', 28.3495],
  ounce: ['weight', 28.3495],
  ounces: ['weight', 28.3495],
  lb: ['weight', 453.592],
  lbs: ['weight', 453.592],
  pound: ['weight', 453.592],
  pounds: ['weight', 453.592],
  ml: ['volume', 1],
  milliliter: ['volume', 1],
  milliliters: ['volume', 1],
  millilitre: ['volume', 1],
  millilitres: ['volume', 1],
  cl: ['volume', 10],
  dl: ['volume', 100],
  l: ['volume', 1000],
  liter: ['volume', 1000],
  liters: ['volume', 1000],
  litre: ['volume', 1000],
  litres: ['volume', 1000],
  cup: ['volume', 240],
  cups: ['volume', 240],
  tbsp: ['volume', 15],
  tablespoon: ['volume', 15],
  tablespoons: ['volume', 15],
  tsp: ['volume', 5],
  teaspoon: ['volume', 5],
  teaspoons: ['volume', 5],
  tl: ['volume', 5],
  theelepel: ['volume', 5],
  theelepels: ['volume', 5],
  el: ['volume', 15],
  eetlepel: ['volume', 15],
  eetlepels: ['volume', 15],
  'fl oz': ['volume', 30],
  'fluid ounce': ['volume', 30],
  'fluid ounces': ['volume', 30],
  stuk: ['count', 1],
  stuks: ['count', 1],
  piece: ['count', 1],
  pieces: ['count', 1],
  pc: ['count', 1],
  pcs: ['count', 1]
};
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
      if (recipe.sourceUrl || recipe.livePriced) {
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
    const raw = String(unitSize || '').trim();
    if (!raw) return null;
    // "per stuk" / "los" zonder gewicht: één exemplaar.
    if (!/\d/.test(raw)) {
      return /\bstuks?\b|\bper\s+stuk\b|\blos\b/i.test(raw) ? { amount: 1, unit: 'count' } : null;
    }
    const multi = raw.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|dl|l)\b/i);
    if (multi) {
      const single = this.normalizeQuantity(Number(multi[2].replace(',', '.')), multi[3]);
      return single ? { amount: single.amount * Number(multi[1]), unit: single.unit } : null;
    }
    const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram|ml|cl|dl|l|liter|stuks?|stuk|pieces?|pcs?)\b/i);
    if (!match) return null;
    return this.normalizeQuantity(Number(match[1].replace(',', '.')), match[2]);
  }

  /**
   * Prijs per kilo, liter of stuk, zodat verpakkingen onderling te vergelijken
   * zijn. Berekend uit het pakformaat, met AH's eigen omschrijving als
   * terugvaloptie wanneer het formaat niet te lezen is.
   * @param {Object} product
   * @returns {{amount: number, unit: 'kg'|'l'|'stuk', regular: number}|null}
   */
  unitPriceFor(product) {
    if (!product || !Number.isFinite(product.price) || product.price <= 0) return null;
    const regularPrice = Number.isFinite(product.regularPrice) && product.regularPrice > 0
      ? product.regularPrice
      : product.price;
    const packageSize = this.parsePackageSize(product.unitSize);
    if (packageSize?.amount > 0) {
      if (packageSize.unit === 'weight') {
        const kilos = packageSize.amount / 1000;
        return { amount: product.price / kilos, unit: 'kg', regular: regularPrice / kilos };
      }
      if (packageSize.unit === 'volume') {
        const litres = packageSize.amount / 1000;
        return { amount: product.price / litres, unit: 'l', regular: regularPrice / litres };
      }
      if (packageSize.unit === 'count' && packageSize.amount > 1) {
        return {
          amount: product.price / packageSize.amount,
          unit: 'stuk',
          regular: regularPrice / packageSize.amount
        };
      }
      // Eén los exemplaar: de stukprijs is gewoon de pakprijs, dus niets tonen.
      if (packageSize.unit === 'count') return null;
    }
    // "prijs per kg €3.31": AH zet de eenheid vóór het bedrag.
    const description = String(product.unitPriceDescription || '');
    const match = description.match(/(kg|kilogram|g|gram|l|liter|ml|stuk|stuks)\D{0,14}(\d+(?:[.,]\d+)?)/i);
    if (!match) return null;
    const value = Number(match[2].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = /^(kg|kilogram)$/i.test(match[1])
      ? 'kg'
      : /^(l|liter)$/i.test(match[1])
        ? 'l'
        : /^(stuk|stuks)$/i.test(match[1])
          ? 'stuk'
          : null;
    return unit ? { amount: value, unit, regular: value } : null;
  }

  /**
   * Berekent wat het receptgedeelte van dit product kost, uitgaande van een
   * evenredig deel van de verpakking. Geeft null als het formaat niet past.
   */
  calculateQuantityCost(ingredient, product, scale) {
    if (!Number.isFinite(ingredient.amount) || ingredient.amount <= 0) return null;
    const ingredientQuantity = this.normalizeQuantity(ingredient.amount, ingredient.unit);
    const packageQuantity = this.parsePackageSize(product.unitSize);
    if (!ingredientQuantity || !packageQuantity) return null;

    let amountUsed = ingredientQuantity.amount * scale;
    if (packageQuantity.unit !== ingredientQuantity.unit) {
      const comparable = VOLUME_WEIGHT_EQUIVALENTS.has(`${ingredientQuantity.unit}>${packageQuantity.unit}`) ||
        VOLUME_WEIGHT_EQUIVALENTS.has(`${packageQuantity.unit}>${ingredientQuantity.unit}`);
      if (comparable) {
        // 1 ml = 1 g: een eetlepel mosterd tegenover een pak in grammen.
        amountUsed = ingredientQuantity.amount * scale;
      } else if (packageQuantity.unit === 'weight' && ingredientQuantity.unit === 'count') {
        // "4 tortilla's" tegenover een pak van 320 g.
        const gramsPerPiece = PIECE_WEIGHT_GRAMS[this.ingredientHeadword(ingredient.name)];
        if (!gramsPerPiece) return null;
        amountUsed = ingredientQuantity.amount * scale * gramsPerPiece;
      } else {
        return null;
      }
    }
    const quantityRatio = amountUsed / packageQuantity.amount;
    // Een veel te kleine verpakking (kruidenmix voor een kilo groente) is geen
    // zinnige match; die sluiten we uit in plaats van de prijs op te blazen.
    if (quantityRatio > MAX_PACKS_PER_INGREDIENT) return null;
    return {
      current: product.price * quantityRatio,
      regular: product.regularPrice * quantityRatio,
      quantityRatio
    };
  }

  normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Het zelfstandig naamwoord van een ingrediënt: in het Nederlands staat dat
   * achteraan ("zoete aardappel" -> "aardappel", "Griekse yoghurt" -> "yoghurt").
   * @param {string} name
   * @returns {string}
   */
  ingredientHeadword(name) {
    const words = this.ingredientKeywords(name);
    return words.length ? words[words.length - 1] : '';
  }

  /**
   * De betekenisvolle woorden van een ingrediënt. "Zuivelspread bieslook light"
   * levert "zuivelspread" en "bieslook"; een product dat één daarvan is, is het
   * gezochte ingrediënt.
   * @param {string} name
   * @returns {string[]}
   */
  ingredientKeywords(name) {
    return this.normalizeText(name)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !INGREDIENT_STOPWORDS.has(word) && !PRODUCT_ADJECTIVES.has(word));
  }

  words(text) {
    return this.normalizeText(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Vergelijkt één woord met het kernwoord van het ingrediënt. "broccoliroosjes"
   * en "puntpaprika" horen erbij, "boterhamworst" bij "boter" niet: daarvoor
   * moet het woord grotendeels uit het kernwoord bestaan.
   * @param {string} word
   * @param {string} headword
   * @returns {boolean}
   */
  wordMatchesHeadword(word, headword) {
    if (!word || !headword) return false;
    if (word === headword) return true;
    const plural = headword.endsWith('en') ? headword.slice(0, -2) : null;
    if (plural && word === plural) return true;
    if (word.endsWith('en') && word.slice(0, -2) === headword) return true;
    // "ei" hoort bij "eieren", "ui" bij "uien".
    if (headword.length <= 3 && word.startsWith(headword)) return true;
    // In het Nederlands staat de kern achteraan: "basmatirijst" is rijst en
    // "puntpaprika" is paprika. Vooraan matcht alleen een kortere vorm
    // ("uien" vs "ui"), zodat "bloemkool" geen bloem wordt.
    if (word.endsWith(headword) && word.length - headword.length >= 3) return true;
    return headword.startsWith(word);
  }

  /**
   * Bepaalt of een AH-product echt het ingrediënt is (en niet een gerecht of
   * mix waarin het toevallig voorkomt).
   * @param {string} ingredientName
   * @param {Object} product
   * @returns {boolean}
   */
  isRelevantProductForIngredient(ingredientName, product) {
    if (!product) return false;
    const headwords = this.ingredientKeywords(ingredientName);
    if (!headwords.length) return false;
    const matchesAny = word => headwords.some(keyword => this.wordMatchesHeadword(word, keyword));
    const ingredient = this.normalizeText(ingredientName);
    const title = this.normalizeText(product.title);
    const mainCategory = this.normalizeText(product.mainCategory);
    const subCategoryText = this.normalizeText(product.subCategory);
    if (PREPARED_FOOD_MAIN_CATEGORIES.some(category => mainCategory.includes(category))) return false;
    if (PREPARED_FOOD_SUBCATEGORIES.some(category => subCategoryText.includes(category))) return false;
    if (COMPOSITE_MARKERS.some(marker => title.includes(marker) && !ingredient.includes(marker))) return false;

    // Het schap is de betrouwbaarste aanwijzing: "AH Gele uien" zit in "Ui".
    const categoryMatches = this.words(product.subCategory).some(matchesAny);
    // In de titel moet het ingrediënt het eerste zelfstandig naamwoord zijn:
    // "gele uien" en "rode puntpaprika" wel, "bloemkool broccoli kleinverpakking"
    // en "boterhamworst" niet.
    let stripped = title;
    while (PRODUCT_PREFIX_PATTERN.test(stripped)) stripped = stripped.replace(PRODUCT_PREFIX_PATTERN, '');
    const significant = this.words(stripped)
      .find(word => !PRODUCT_ADJECTIVES.has(word) && !INGREDIENT_STOPWORDS.has(word));
    const titleLeads = Boolean(significant) && matchesAny(significant);
    if (!categoryMatches && !titleLeads) return false;
    // Een lijst of mengsel ("broccoli, wortel, bloemkool", "honing pinda &
    // cashewnoten") valt af.
    if (/,\s*[a-z]/.test(stripped)) return false;
    if (/\s[&+]\s|\sen\s/.test(stripped)) return false;
    return true;
  }

  /**
   * Hoe precies het product het ingrediënt is: 2 als het product ermee begint
   * ("AH Broccoli"), 1 als het alleen in hetzelfde schap ligt ("AH Bimi").
   * @param {string} ingredientName
   * @param {Object} product
   * @returns {number}
   */
  productExactness(ingredientName, product) {
    const headwords = this.ingredientKeywords(ingredientName);
    let stripped = this.normalizeText(product.title);
    while (PRODUCT_PREFIX_PATTERN.test(stripped)) stripped = stripped.replace(PRODUCT_PREFIX_PATTERN, '');
    const significant = this.words(stripped)
      .find(word => !PRODUCT_ADJECTIVES.has(word) && !INGREDIENT_STOPWORDS.has(word));
    const matches = significant && headwords.some(keyword => this.wordMatchesHeadword(significant, keyword));
    return matches ? 2 : 1;
  }

  /**
   * Sorteert producten op bruikbaarheid en daarna op prijs voor de benodigde
   * hoeveelheid, zodat de goedkoopste zinnige optie bovenaan staat.
   * @param {Object} ingredient
   * @param {Array} products
   * @param {number} scale
   * @returns {Array}
   */
  rankProductsForIngredient(ingredient, products = [], scale = 1) {
    const name = ingredient?.searchQuery || ingredient?.name || '';
    // Alleen online verkrijgbare producten horen standaard niet bij een recept.
    return this.filterProductsByOnlinePreference(products)
      .map(product => {
        const relevant = this.isRelevantProductForIngredient(name, product);
        const exactness = relevant ? this.productExactness(name, product) : 0;
        const quantityCost = this.calculateQuantityCost(ingredient, product, scale);
        const packageSize = this.parsePackageSize(product.unitSize);
        const ingredientQuantity = Number.isFinite(ingredient?.amount)
          ? this.normalizeQuantity(ingredient.amount, ingredient.unit || '')
          : null;
        const overshoot = packageSize && ingredientQuantity && packageSize.unit === ingredientQuantity.unit
          ? packageSize.amount / Math.max(ingredientQuantity.amount * scale, 1e-6)
          : 1;
        return {
          product,
          relevant,
          exactness,
          cost: quantityCost?.current ?? null,
          oversized: overshoot > MAX_PACK_OVERSHOOT
        };
      })
      .sort((a, b) => {
        if (a.relevant !== b.relevant) return Number(b.relevant) - Number(a.relevant);
        // Eerst exact het gevraagde ingrediënt, daarna pas de vervanger.
        if (a.exactness !== b.exactness) return b.exactness - a.exactness;
        if (a.oversized !== b.oversized) return Number(a.oversized) - Number(b.oversized);
        if (a.cost !== null && b.cost !== null) return a.cost - b.cost;
        if (a.cost !== null) return -1;
        if (b.cost !== null) return 1;
        return a.product.price - b.product.price;
      });
  }

  /**
   * Kiest het goedkoopste product dat ook echt het ingrediënt is.
   * @param {Object} ingredient
   * @param {Array} products
   * @param {number} scale
   * @returns {{product: Object|null, relevant: boolean}}
   */
  selectProductForIngredient(ingredient, products = [], scale = 1) {
    const ranked = this.rankProductsForIngredient(ingredient, products, scale);
    const best = ranked.find(entry => entry.relevant);
    return {
      product: best?.product || null,
      relevant: Boolean(best),
      ranked: ranked.map(entry => entry.product),
      matchedIds: ranked.filter(entry => entry.relevant).map(entry => entry.product.id)
    };
  }

  normalizeQuantity(amount, unit = '') {
    const normalizedUnit = unit.toLowerCase().replace(/\./g, '').trim();
    // Eenheid -> [dimensie, factor naar de basisEenheid (g, ml of stuk)].
    const conversion = QUANTITY_UNITS[normalizedUnit];
    if (conversion) return { amount: amount * conversion[1], unit: conversion[0] };
    // TheMealDB schrijft vaak alleen een getal, bijvoorbeeld "2" bij "Eggs".
    if (!normalizedUnit && Number.isFinite(amount)) return { amount, unit: 'count' };
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
    return formatEuro(amount, getLocale());
  }
}
