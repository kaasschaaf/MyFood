/**
 * Ingredient matching - decides whether an AH product really is the ingredient
 * a recipe asks for, and how good a match it is.
 *
 * These rules are shared by the app (live product search) and the data
 * pipeline (which bakes an ingredient -> products mapping into products.json),
 * so a static choice and a live choice are made the same way. Everything here
 * is pure: anything that needs prices, package sizes or the visitor's
 * online-only preference is passed in through `deps`.
 */

// Ingredient names contain a lot of filler; only the nouns say something about
// which product belongs to it.
export const INGREDIENT_STOPWORDS = new Set([
  'fresh', 'freshly', 'dried', 'ground', 'chopped', 'sliced', 'diced', 'minced', 'crushed', 'grated',
  'peeled', 'large', 'small', 'medium', 'whole', 'plain', 'extra', 'virgin', 'boneless', 'skinless',
  'lean', 'raw', 'cooked', 'of', 'the', 'and', 'with', 'for', 'to', 'taste', 'a', 'an', 'or', 'x',
  'into', 'cut', 'pieces', 'piece', 'halve', 'half', 'cloves', 'clove', 'leaves', 'leaf', 'pinch',
  'splash', 'sprinkling', 'handful', 'can', 'cans', 'tin', 'packet', 'pack', 'grams', 'gram', 'g',
  'kg', 'ml', 'l', 'oz', 'lb', 'lbs', 'cups', 'cup', 'tbsp', 'tsp', 'tablespoons', 'teaspoons',
  'stuks', 'stuk', 'el', 'tl', 'ca', 'about', 'optional', 'plus', 'more', 'as', 'needed', 'good',
  'big', 'little', 'few', 'some', 'each', 'your', 'favourite', 'favorite'
]);

// Words that mark the product as a dish or mix in which the ingredient merely
// appears. A "bakplaat mix broccoli" is not broccoli.
export const COMPOSITE_MARKERS = [
  'mix', 'kruidenmix', 'maaltijdmix', 'maaltijdpakket', 'ovenschotel', 'dagschotel', 'schotel',
  'stamppot', 'soep', 'salade', 'burger', 'hapje', 'knijpfruit', 'maaltijd', 'pizza', 'saus',
  'dressing', 'snack', 'chips', 'lasagne', 'tortellini', 'cake', 'taart', 'muffin', 'pannenkoek',
  'smoothie', 'granola', 'koek', 'gebak', 'pronto', 'ovengroente', 'roerbakgroente', 'soepgroente',
  'kruiden', 'specerij', 'bouillon', 'instant',
  // Processed: contains the ingredient, but not usable as a loose ingredient.
  'zoetzuur', 'ingelegd', 'poeder', 'puree', 'siroop', 'jam', 'chutney', 'gemarineerd',
  'pesto', 'tapenade', 'hummus', 'ketchup', 'mayonaise',
  // Other basics that look like the ingredient.
  'karnemelk', 'koffiemelk', 'sojamelk', 'amandelmelk', 'havermelk', 'rijstmelk', 'geitenmelk',
  'chocolademelk', 'drinkyoghurt', 'sojadrink', 'amandeldrink', 'bloemkool', 'opscuimmelk',
  'baristamelk', 'stemgember', 'bakgember', 'passata', 'tomatenpuree'
];

// Adjectives that stand before the noun ("gele uien", "rode puntpaprika") and
// say nothing about the product itself.
export const PRODUCT_ADJECTIVES = new Set([
  'geel', 'gele', 'rood', 'rode', 'wit', 'witte', 'groen', 'groene', 'bruin', 'bruine', 'paars', 'paarse',
  'oranje', 'zwart', 'zwarte', 'klein', 'kleine', 'groot', 'grote', 'jong', 'jonge', 'oud', 'oude', 'vers',
  'verse', 'diepvries', 'extra', 'fijn', 'fijne', 'grof', 'grove', 'heel', 'halve', 'half', 'sweet', 'mild',
  'milde', 'zoet', 'zoete', 'pittig', 'pittige', 'naturel', 'puur', 'luxe', 'klasse', 'gesneden', 'geraspt',
  'gemalen', 'ongezouten', 'gezouten', 'vrije', 'uitloop', 'scharrel', 'biologisch', 'bio', 'hollandse',
  'mager', 'magere', 'halfvolle', 'volle', 'houdbare', 'gepasteuriseerde', 'rauwe', 'grofgesneden',
  'light', 'luchtig', 'romig', 'romige', 'fris', 'frisse', 'zoetzuur',
  'nederlandse', 'italiaanse', 'franse', 'duitse', 'spaanse', 'griekse', 'verse', 'los', 'per', 'ca'
]);

// Brands and qualifiers that stand before the product name.
export const PRODUCT_PREFIXES = [
  'ah', 'jumbo', 'plus', 'aldi', 'lidl', 'dirk', 'coop', 'spar', 'honig', 'maggi', 'knorr', 'bonduelle',
  'olvarit', 'conimex', 'hak', 'iglo', 'mora', 'heinz', 'calve', 'unox', 'campina', 'optimel', 'arla',
  'melkan', 'natura', 'biologisch', 'bio', 'vers', 'verse', 'diepvries', 'hollandse', 'nederlandse',
  'terra', 'ella s kitchen'
];
export const PRODUCT_PREFIX_PATTERN = new RegExp(`^(?:${PRODUCT_PREFIXES.join('|')}) +`);

// Shelves with ready-made dishes or baby food: the ingredient is in there, but
// it is not a usable substitute. Only the sub-shelf is checked; AH files sugar
// under "Maaltijden, salades".
export const PREPARED_FOOD_MAIN_CATEGORIES = ['baby en kind'];
export const PREPARED_FOOD_SUBCATEGORIES = [
  'knijphapje', 'maaltijden vanaf', 'hapje', 'verse soepen', 'soep', 'stamppot', 'salade'
];

// More packs than this means the product does not fit the recipe's scale (for
// example a 36 g spice mix for 350 g of vegetables).
export const MAX_PACKS_PER_INGREDIENT = 6;
// A pack that is much bigger than needed ("30 eggs" for 2 eggs) is the cheapest
// per unit, but not what you buy for this recipe.
export const MAX_PACK_OVERSHOOT = 4;

/**
 * Lowercase and strip diacritics.
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Splits text into plain lowercase words.
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The meaningful words of an ingredient. "Zuivelspread bieslook light" yields
 * "zuivelspread" and "bieslook"; a product that is one of those is the
 * ingredient being looked for.
 * @param {string} name
 * @returns {string[]}
 */
export function ingredientKeywords(name) {
  return normalizeText(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !INGREDIENT_STOPWORDS.has(word) && !PRODUCT_ADJECTIVES.has(word));
}

/**
 * The noun of an ingredient: in Dutch it comes last ("zoete aardappel" ->
 * "aardappel", "Griekse yoghurt" -> "yoghurt").
 * @param {string} name
 * @returns {string}
 */
export function ingredientHeadword(name) {
  const keywords = ingredientKeywords(name);
  return keywords.length ? keywords[keywords.length - 1] : '';
}

/**
 * Compares one word with the ingredient's headword. "broccoliroosjes" and
 * "puntpaprika" belong to it; "boterhamworst" does not belong to "boter",
 * because the word has to consist mostly of the headword.
 * @param {string} word
 * @param {string} headword
 * @returns {boolean}
 */
export function wordMatchesHeadword(word, headword) {
  if (!word || !headword) return false;
  if (word === headword) return true;
  const plural = headword.endsWith('en') ? headword.slice(0, -2) : null;
  if (plural && word === plural) return true;
  if (word.endsWith('en') && word.slice(0, -2) === headword) return true;
  // "ei" belongs to "eieren", "ui" to "uien". A one-letter headword would make
  // every word that starts with that letter a match ("c" matching "chips").
  if (headword.length >= 2 && headword.length <= 3 && word.startsWith(headword)) return true;
  // In Dutch the head is at the end: "basmatirijst" is rice and "puntpaprika"
  // is paprika. A shorter form in front only matches ("uien" vs "ui"), so
  // "bloemkool" does not become flour.
  if (word.endsWith(headword) && word.length - headword.length >= 3) return true;
  return headword.startsWith(word);
}

/**
 * Whether an AH product really is the ingredient (and not a dish or mix that
 * happens to contain it).
 * @param {string} ingredientName
 * @param {Object} product
 * @returns {boolean}
 */
export function isRelevantProductForIngredient(ingredientName, product) {
  if (!product) return false;
  const headwords = ingredientKeywords(ingredientName);
  if (!headwords.length) return false;
  const matchesAny = word => headwords.some(keyword => wordMatchesHeadword(word, keyword));
  const ingredient = normalizeText(ingredientName);
  const title = normalizeText(product.title);
  const mainCategory = normalizeText(product.mainCategory);
  const subCategoryText = normalizeText(product.subCategory);
  if (PREPARED_FOOD_MAIN_CATEGORIES.some(category => mainCategory.includes(category))) return false;
  if (PREPARED_FOOD_SUBCATEGORIES.some(category => subCategoryText.includes(category))) return false;
  if (COMPOSITE_MARKERS.some(marker => title.includes(marker) && !ingredient.includes(marker))) return false;

  // The shelf is the most reliable hint: "AH Gele uien" sits under "Ui".
  const categoryMatches = words(product.subCategory).some(matchesAny);
  // In the title the ingredient has to be the first noun: "gele uien" and
  // "rode puntpaprika" yes, "bloemkool broccoli kleinverpakking" and
  // "boterhamworst" no.
  let stripped = title;
  while (PRODUCT_PREFIX_PATTERN.test(stripped)) stripped = stripped.replace(PRODUCT_PREFIX_PATTERN, '');
  const significant = words(stripped)
    .find(word => !PRODUCT_ADJECTIVES.has(word) && !INGREDIENT_STOPWORDS.has(word));
  const titleLeads = Boolean(significant) && matchesAny(significant);
  if (!categoryMatches && !titleLeads) return false;
  // A list or mix ("broccoli, wortel, bloemkool", "honing pinda & cashewnoten")
  // is out.
  if (/,\s*[a-z]/.test(stripped)) return false;
  if (/\s[&+]\s|\sen\s/.test(stripped)) return false;
  return true;
}

/**
 * How exact the product is: 2 when it starts with the ingredient
 * ("AH Broccoli"), 1 when it only sits on the same shelf ("AH Bimi").
 * @param {string} ingredientName
 * @param {Object} product
 * @returns {number}
 */
export function productExactness(ingredientName, product) {
  const headwords = ingredientKeywords(ingredientName);
  let stripped = normalizeText(product.title);
  while (PRODUCT_PREFIX_PATTERN.test(stripped)) stripped = stripped.replace(PRODUCT_PREFIX_PATTERN, '');
  const significant = words(stripped)
    .find(word => !PRODUCT_ADJECTIVES.has(word) && !INGREDIENT_STOPWORDS.has(word));
  const matches = significant && headwords.some(keyword => wordMatchesHeadword(significant, keyword));
  return matches ? 2 : 1;
}

/**
 * Sorts products by usability and then by price for the needed quantity, so
 * the cheapest sensible option comes first.
 *
 * @param {Object} ingredient
 * @param {Array} products
 * @param {number} [scale]
 * @param {{
 *   filterProducts?: (products: Array) => Array,
 *   quantityCost?: (ingredient: Object, product: Object, scale: number) => ({current: number}|null),
 *   packageSize?: (unitSize: string) => ({amount: number, unit: string}|null),
 *   normalizeQuantity?: (amount: number, unit: string) => ({amount: number, unit: string}|null)
 * }} [deps]
 * @returns {Array<{product: Object, relevant: boolean, exactness: number, cost: number|null, oversized: boolean}>}
 */
export function rankProductsForIngredient(ingredient, products = [], scale = 1, deps = {}) {
  const name = ingredient?.searchQuery || ingredient?.name || '';
  const filterProducts = deps.filterProducts || (list => list);
  const quantityCostFor = deps.quantityCost || (() => null);
  const packageSizeFor = deps.packageSize || (() => null);
  const normalizeQuantityFor = deps.normalizeQuantity || (() => null);

  // Products that are only available online are not part of a recipe by default.
  return filterProducts(products)
    .map(product => {
      const relevant = isRelevantProductForIngredient(name, product);
      const exactness = relevant ? productExactness(name, product) : 0;
      const quantityCost = quantityCostFor(ingredient, product, scale);
      const packageSize = packageSizeFor(product.unitSize);
      const ingredientQuantity = Number.isFinite(ingredient?.amount)
        ? normalizeQuantityFor(ingredient.amount, ingredient.unit || '')
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
      // The exact ingredient first, substitutes after that.
      if (a.exactness !== b.exactness) return b.exactness - a.exactness;
      if (a.oversized !== b.oversized) return Number(a.oversized) - Number(b.oversized);
      if (a.cost !== null && b.cost !== null) return a.cost - b.cost;
      if (a.cost !== null) return -1;
      if (b.cost !== null) return 1;
      return a.product.price - b.product.price;
    });
}

/**
 * Picks the cheapest product that really is the ingredient.
 * @param {Object} ingredient
 * @param {Array} products
 * @param {number} [scale]
 * @param {Object} [deps] see rankProductsForIngredient
 * @returns {{product: Object|null, relevant: boolean, ranked: Array, matchedIds: string[]}}
 */
export function selectProductForIngredient(ingredient, products = [], scale = 1, deps = {}) {
  const ranked = rankProductsForIngredient(ingredient, products, scale, deps);
  const best = ranked.find(entry => entry.relevant);
  return {
    product: best?.product || null,
    relevant: Boolean(best),
    ranked: ranked.map(entry => entry.product),
    matchedIds: ranked.filter(entry => entry.relevant).map(entry => entry.product.id)
  };
}
