/**
 * Dinner curation - decides whether a raw dataset row is a main-course dinner
 * dish Kost should ship.
 *
 * The public recipe dataset is a general corpus: about a third of it is baking
 * and dessert, and titles are often blog leftovers. Kost is a dinner app, so
 * every row runs through a small funnel of gates, each of which reports how
 * many rows it kept and dropped. That report is what makes the dataset size
 * tunable later.
 */

import { canonicalIngredients } from '../../js/ingredient-canonical.js';
import { ingredientKeywords } from '../../js/ingredient-matching.js';

// Baking and sweet dishes, matched against the title.
const DESSERT_TITLE = new RegExp([
  'cake', 'cookies?', 'brownies?', 'muffins?', 'cupcakes?', 'dessert', 'fudge', 'smoothies?',
  'milkshake', 'marmalade', 'frosting', 'icing', 'custard', 'pudding', 'biscuits?', 'doughnuts?',
  'donuts?', 'cobbler', 'crumble', 'mousse', 'sorbet', 'ice cream', 'candy', 'caramel', 'meringue',
  'pancakes?', 'waffles?', 'scones?', 'toffee', 'truffles?', 'pie', 'tarts?', 'sweet', 'sugar',
  'chocolate', 'granola', 'parfait', 'trifle', 'sundae', 'marshmallow', 'brittle', 'nutella',
  'jam', 'jelly', 'yoghurt bowl', 'smoothie bowl', 'banana bread', 'cinnamon roll', 'french toast'
].join('|'), 'i');

// Dessert make-up in the ingredient list, which catches "Chocolate Lasagna".
const DESSERT_INGREDIENTS = new RegExp([
  'cool whip', 'marshmallow', 'frosting', 'confectioners sugar', 'icing sugar', 'sweetened condensed',
  'chocolate chips', 'cake mix', 'graham cracker', 'jello', 'gelatin', 'sprinkles', 'cocoa powder',
  'vanilla extract', 'food colouring', 'food coloring', 'meringue', 'custard powder', 'whipping cream'
].join('|'), 'i');

// A dinner has to look like a main course. Proteins, starches and dish forms.
const DINNER_ANCHOR = new RegExp([
  // Protein
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'veal', 'duck', 'salmon', 'cod', 'tuna', 'haddock',
  'shrimp', 'prawn', 'fish', 'tofu', 'sausage', 'meatball', 'chorizo', 'bacon', 'ham', 'mince',
  'steak', 'brisket', 'thigh', 'breast', 'drumstick', 'kebab', 'goat', 'venison', 'rabbit',
  // Starch
  'pasta', 'rice', 'noodle', 'potato', 'tortilla', 'couscous', 'quinoa', 'polenta', 'barley',
  'lentil', 'bean', 'chickpea',
  // Dish form
  'curry', 'stew', 'roast', 'grill', 'stir fry', 'stirfry', 'soup', 'salad', 'casserole', 'taco',
  'burger', 'pizza', 'risotto', 'chili', 'chilli', 'lasagn', 'skillet', 'sheet pan', 'slow cooker',
  'crock', 'bake', 'braise', 'gratin', 'pie', 'wrap', 'enchilada', 'fajita', 'paella', 'goulash',
  'tagine', 'biryani', 'pad thai', 'ramen', 'pho', 'schnitzel', 'parmigiana', 'stuffed', 'vegetable',
  'veggie', 'mushroom', 'aubergine', 'eggplant', 'zucchini', 'courgette', 'spinach', 'broccoli',
  'cauliflower', 'cabbage', 'kale', 'leek', 'pumpkin', 'squash', 'sweet potato'
].join('|'), 'i');

// Blog leftovers that end up in titles.
const NOISE_TITLE = /(https?:|www\.|\.com|recipe by|leave a comment|advertisement|print this|jump to recipe|posted by|originally published|adapted from|source:)/i;

// Sweet-dominance: if these are most of the ingredient lines it is baking.
const SWEET_INGREDIENTS = new Set([
  'sugar', 'suiker', 'butter', 'boter', 'flour', 'bloem', 'honey', 'honing', 'syrup', 'siroop',
  'chocolate', 'chocolade', 'cream', 'room', 'egg', 'ei', 'eieren', 'milk', 'melk', 'vanilla',
  'custard', 'jam', 'marmalade', 'cocoa', 'cacao', 'marzipan', 'icing', 'glaze', 'sprinkles'
]);

const MIN_INGREDIENTS = 6;
const MAX_INGREDIENTS = 14;
const MIN_STEPS = 3;
const MAX_TITLE = 90;
const MIN_PARSEABLE_RATIO = 0.6;
const MAX_SWEET_RATIO = 0.4;
// Two recipes with (almost) the same ingredients are the same dish.
const MAX_FINGERPRINT_SIMILARITY = 0.9;

/**
 * Structural gate: enough substance to price, but not an essay.
 * @param {Object} row
 * @returns {boolean}
 */
export function passesStructure(row) {
  const ingredients = row?.ingredients || [];
  const steps = row?.directions || [];
  const title = String(row?.title || '').trim();
  return ingredients.length >= MIN_INGREDIENTS &&
    ingredients.length <= MAX_INGREDIENTS &&
    steps.length >= MIN_STEPS &&
    title.length > 3 &&
    title.length < MAX_TITLE;
}

/**
 * Normalises a title for dedupe and display.
 * @param {string} title
 * @returns {string}
 */
export function cleanTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    // "… Soup Recipe" and "… (Recipe)" are page titles, not dish names.
    .replace(/\s*[-–—|:]?\s*\(?\brecipes?\b\)?\s*$/i, '')
    // File-extension leftovers from scraped page titles ("Baked Kibbee.kgm").
    .replace(/\.(?:kgm|html?|php|aspx?|txt|pdf|docx?)\s*$/i, '')
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, '')
    .trim();
}

/**
 * A coarse dish type for the UI filters, derived from the title.
 * @param {string} title
 * @returns {string}
 */
export function dishTypeFor(title) {
  const value = String(title || '').toLowerCase();
  if (/pasta|spaghetti|penne|lasagn|macaroni|noodle|tagliatelle|fettuccine|linguine|risotto|rice/.test(value)) return 'pasta-rijst';
  if (/soup|soep|broth|bouillon/.test(value)) return 'soep';
  if (/salad|salade/.test(value)) return 'salade';
  if (/curry|stew|stoof|goulash|tagine|chili|chilli/.test(value)) return 'stoof-curry';
  if (/fish|salmon|cod|tuna|shrimp|prawn|vis|zalm|kabeljauw|garnalen/.test(value)) return 'vis';
  if (/chicken|kip|turkey|kalkoen/.test(value)) return 'kip';
  if (/beef|pork|lamb|veal|steak|rund|varken|lam|gehakt|mince/.test(value)) return 'vlees';
  if (/vegetarian|veggie|vegetarisch|tofu|bean|lentil|chickpea/.test(value)) return 'vegetarisch';
  if (/bake|oven|roast|casserole|gratin|sheet pan/.test(value)) return 'oven';
  if (/stir fry|stirfry|wok|skillet|pan/.test(value)) return 'wok-pan';
  return 'overig';
}

/**
 * Runs the full funnel over rows and reports each gate.
 * @param {Object[]} rows
 * @param {{ report?: Object, limit?: number }} [options]
 * @returns {{ recipes: Object[], gates: Array<{ name: string, in: number, out: number }> }}
 */
export function curateDinnerRecipes(rows, { report, limit = Infinity } = {}) {
  const gates = [];
  const gate = (name, input, predicate) => {
    const kept = [];
    for (const row of input) {
      if (predicate(row)) kept.push(row);
    }
    gates.push({ name, in: input.length, out: kept.length });
    report?.count(name, kept.length, input.length - kept.length);
    return kept;
  };

  let current = gate('structure', rows || [], passesStructure);
  current = gate('noise', current, row => !NOISE_TITLE.test(String(row.title || '')));
  current = gate('dessert (title)', current, row => !DESSERT_TITLE.test(cleanTitle(row.title)));
  current = gate('dessert (ingredients)', current, row => !DESSERT_INGREDIENTS.test((row.ingredients || []).join(' ')));
  current = gate('dinner anchor', current, row => DINNER_ANCHOR.test(String(row.title || '')));
  current = gate('sweet dominance', current, row => sweetRatio(row) <= MAX_SWEET_RATIO);
  current = gate('parseable', current, row => parseableRatio(row) >= MIN_PARSEABLE_RATIO);

  const seenTitles = new Set();
  const seenFingerprints = [];
  const unique = gate('duplicate', current, row => {
    const title = cleanTitle(row.title).toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (!title || seenTitles.has(title)) return false;
    const keys = ingredientKeysOf(row);
    // Only a near-identical ingredient set counts as the same recipe; two
    // dishes that share oil, salt and onion are still different dinners.
    const duplicate = seenFingerprints.some(existing => jaccard(keys, existing) >= MAX_FINGERPRINT_SIMILARITY);
    if (duplicate) return false;
    seenTitles.add(title);
    seenFingerprints.push(keys);
    return true;
  });

  return {
    recipes: unique.slice(0, limit),
    gates
  };
}

/**
 * Share of ingredient lines that canonicalise to a usable key.
 * @param {Object} row
 * @returns {number}
 */
export function parseableRatio(row) {
  const lines = row?.ingredients || [];
  if (!lines.length) return 0;
  const usable = lines.filter(line => {
    const items = canonicalIngredients(line);
    return items.some(item => item.key && item.key.length > 1);
  }).length;
  return usable / lines.length;
}

/**
 * Share of ingredient lines that are sweet/baking staples.
 * @param {Object} row
 * @returns {number}
 */
export function sweetRatio(row) {
  const items = (row?.ingredients || []).flatMap(line => canonicalIngredients(line));
  if (!items.length) return 1;
  const sweet = items.filter(item => {
    const words = ingredientKeywords(item.nameNl || item.nameEn || '');
    return words.some(word => SWEET_INGREDIENTS.has(word));
  }).length;
  return sweet / items.length;
}

/**
 * The canonical ingredient keys of a row.
 * @param {Object} row
 * @returns {string[]}
 */
export function ingredientKeysOf(row) {
  return (row?.ingredients || [])
    .flatMap(line => canonicalIngredients(line))
    .map(item => item.key)
    .filter(Boolean);
}

/**
 * Stable fingerprint of the ingredient set.
 * @param {Object} row
 * @returns {string}
 */
export function fingerprintOf(row) {
  return [...new Set(ingredientKeysOf(row))].sort().join('|');
}

/**
 * Jaccard similarity of two key sets.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
export function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const value of setA) if (setB.has(value)) shared++;
  return shared / (setA.size + setB.size - shared);
}
