/**
 * Albert Heijn client for the pipeline.
 *
 * Runs in Node, so no CORS proxy and no Worker are involved: the anonymous
 * token and product search are called directly. Requests are throttled and
 * retried because the anonymous API is undocumented and rate-limited.
 *
 * Only two things are needed here: search products for a canonical ingredient,
 * and read the nutrition of a chosen product once. Prices are the only part
 * that is refreshed weekly (see refresh-prices.js).
 */

const BASE = 'https://api.ah.nl';
const MIN_INTERVAL_MS = 300;
const MAX_ATTEMPTS = 3;
const PAGE_SIZE = 50;

let accessToken = null;
let tokenExpiresAt = 0;
let lastRequestAt = 0;
let queue = Promise.resolve();
let requestCount = 0;
let failureCount = 0;
// The nutrition detail endpoint currently answers 404 for anonymous tokens.
// After a run of failures, stop asking: each call costs a throttled request and
// the snapshot is still useful without protein figures.
const NUTRITION_FAILURE_LIMIT = 20;
let nutritionFailures = 0;
let nutritionDisabled = false;

async function waitForSlot() {
  const previous = queue;
  let release;
  queue = new Promise(resolve => { release = resolve; });
  await previous;
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  release();
}

/**
 * Anonymous AH token, cached until it expires.
 * @returns {Promise<string>}
 */
export async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  await waitForSlot();
  const response = await fetch(`${BASE}/mobile-auth/v1/auth/token/anonymous`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-application': 'AHWEBSHOP'
    },
    body: JSON.stringify({ clientId: 'appie' })
  });
  if (!response.ok) throw new Error(`AH anonieme token mislukt (${response.status}).`);
  const payload = await response.json();
  accessToken = payload.access_token;
  // The token is short-lived; refresh a minute early.
  tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 600) * 1000 - 60000;
  return accessToken;
}

/**
 * Fetches one page of product search results.
 * @param {string} query
 * @param {{ page?: number }} [options]
 * @returns {Promise<Object[]>}
 */
async function searchPage(query, { page = 0 } = {}) {
  await waitForSlot();
  const url = new URL(`${BASE}/mobile-services/product/search/v2`);
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('sortOn', 'RELEVANCE');

  const call = async token => fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-application': 'AHWEBSHOP',
      Authorization: `Bearer ${token}`
    }
  });

  requestCount++;
  let response = await call(await getToken());
  if (response.status === 401) {
    accessToken = null;
    response = await call(await getToken());
  }
  if (!response.ok) throw new Error(`AH zoeken mislukt (${response.status}) voor "${query}".`);
  const payload = await response.json();
  return payload.products || [];
}

/**
 * Searches products with retries.
 * @param {string} query
 * @param {{ page?: number }} [options]
 * @returns {Promise<Object[]>}
 */
export async function searchProducts(query, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await searchPage(query, options);
    } catch (error) {
      lastError = error;
      failureCount++;
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

/**
 * Reads the nutrition of one product.
 * @param {string} productId
 * @returns {Promise<{ caloriesPer100: number|null, proteinGrams: number|null, proteinScore: number|null }>}
 */
export async function getNutrition(productId) {
  if (nutritionDisabled) throw new Error('AH productdetails zijn voor deze run uitgeschakeld na herhaalde fouten.');
  try {
    return await fetchNutrition(productId);
  } catch (error) {
    nutritionFailures++;
    if (nutritionFailures >= NUTRITION_FAILURE_LIMIT && !nutritionDisabled) {
      nutritionDisabled = true;
      console.warn(`  AH productdetails niet beschikbaar (${nutritionFailures} fouten); nutrition wordt overgeslagen voor de rest van deze run.`);
    }
    throw error;
  }
}

/**
 * Reads and maps the nutrition of one product.
 * @param {string} productId
 * @returns {Promise<{ caloriesPer100: number|null, proteinGrams: number|null, proteinScore: number|null }>}
 */
async function fetchNutrition(productId) {
  await waitForSlot();
  const url = `${BASE}/mobile-services/product/detail/v4/fir/${encodeURIComponent(productId)}`;
  const call = async token => fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-application': 'AHWEBSHOP',
      Authorization: `Bearer ${token}`
    }
  });
  requestCount++;
  let response = await call(await getToken());
  if (response.status === 401) {
    accessToken = null;
    response = await call(await getToken());
  }
  if (!response.ok) throw new Error(`AH productdetail mislukt (${response.status}) voor ${productId}.`);
  const details = await response.json();
  const header = details.tradeItem?.nutritionalInformation?.nutrientHeaders?.[0];
  const nutrients = header?.nutrients || [];
  const value = name => {
    const nutrient = nutrients.find(item => String(item.name || '').toLowerCase() === name);
    const amount = Number(nutrient?.value);
    return Number.isFinite(amount) ? amount : null;
  };
  const kcal = value('energie') ?? value('energy');
  const protein = value('eiwit') ?? value('protein');
  const caloriesPer100 = Number.isFinite(kcal) ? kcal : null;
  const proteinGrams = Number.isFinite(protein) ? protein : null;
  return {
    caloriesPer100,
    proteinGrams,
    proteinScore: proteinGrams === null || !caloriesPer100
      ? null
      : Math.min(100, Math.round((proteinGrams * 4 / caloriesPer100) * 100))
  };
}

/**
 * Request counters for the run report.
 * @returns {{ requests: number, failures: number }}
 */
export function ahStats() {
  return {
    requests: requestCount,
    failures: failureCount,
    nutritionDisabled,
    nutritionRequests: nutritionDisabled ? NUTRITION_FAILURE_LIMIT : null
  };
}
