/**
 * Cuisine detection for recipes without one.
 *
 * The recipe corpus is an international scrape: rows carry no cuisine, so the
 * pipeline used to write "Internationaal" for every single one. The filter row
 * is built from that field, which left two pills and 2 000 recipes behind one
 * of them.
 *
 * This looks at the title and the ingredient names instead. It is deliberately
 * keyword-based and everything is local: no network, no model, deterministic,
 * so a rebuild produces the same cuisines.
 *
 * The output is canonical (English) cuisine names, matching js/i18n.js, so a
 * detected cuisine and a TheMealDB area end up in the same filter pill.
 */

// Words that place a dish. A title hit counts more than an ingredient hit,
// because "kip" appears everywhere but "tikka" does not.
const CUISINE_WORDS = {
  Italian: ['pasta', 'spaghetti', 'penne', 'lasagne', 'lasagna', 'macaroni', 'risotto', 'gnocchi', 'fettuccine',
    'linguine', 'tagliatelle', 'ravioli', 'tortellini', 'pesto', 'parmesan', 'parmigiano', 'mozzarella', 'prosciutto',
    'pancetta', 'bolognese', 'carbonara', 'marinara', 'bruschetta', 'focaccia', 'tiramisu', 'italiaans', 'italian',
    'oregano', 'basilicum'],
  Chinese: ['chinese', 'chinees', 'wok', 'soy sauce', 'sojasaus', 'hoisin', 'oyster sauce', 'szechuan', 'sichuan',
    'dim sum', 'dumpling', 'spring roll', 'lo mein', 'chow mein', 'kung pao', 'sweet and sour', 'five spice'],
  Japanese: ['japanese', 'japans', 'sushi', 'miso', 'teriyaki', 'tempura', 'ramen', 'dashi', 'wasabi', 'nori',
    'edamame', 'katsu', 'yakitori', 'udon', 'soba'],
  Thai: ['thai', 'thaise', 'thais', 'coconut milk', 'kokosmelk', 'fish sauce', 'vissaus', 'lemongrass', 'citroengras',
    'galangal', 'pad thai', 'green curry', 'red curry', 'tom yum'],
  Indian: ['indian', 'indiaas', 'curry powder', 'garam masala', 'turmeric', 'kurkuma', 'paneer', 'masala', 'tikka',
    'biryani', 'dal', 'dahl', 'naan', 'samosa', 'korma', 'vindaloo', 'tandoori', 'chaat', 'raita', 'cumin', 'komijn'],
  Mexican: ['mexican', 'mexicaans', 'tortilla', 'taco', 'burrito', 'enchilada', 'quesadilla', 'salsa', 'guacamole',
    'jalapeno', 'jalapeño', 'refried beans', 'chipotle', 'fajita', 'tostada', 'pozole', 'mole'],
  Greek: ['greek', 'grieks', 'feta', 'tzatziki', 'souvlaki', 'moussaka', 'spanakopita', 'gyros', 'kalamata', 'ouzo'],
  Spanish: ['spanish', 'spaans', 'paella', 'chorizo', 'tapas', 'gazpacho', 'manchego', 'jamon', 'albondigas', 'sangria'],
  Turkish: ['turkish', 'turks', 'kebab', 'doner', 'lahmacun', 'borek', 'menemen', 'ezme', 'pide'],
  'Middle Eastern': ['middle eastern', 'midden-oosters', 'falafel', 'hummus', 'tahini', 'couscous', 'shawarma',
    'sumac', 'harissa', 'za atar', 'zaatar', 'pomegranate molasses', 'labneh', 'fattoush'],
  French: ['french', 'frans', 'dijon', 'tarragon', 'dragon', 'brie', 'camembert', 'gruyere', 'provencal',
    'provençaals', 'ratatouille', 'quiche', 'creme fraiche', 'crème fraîche', 'beurre', 'coq au vin', 'bouillabaisse',
    'hollandaise', 'baguette'],
  Dutch: ['dutch', 'hollands', 'nederlands', 'stamppot', 'boerenkool', 'erwtensoep', 'hutspot', 'pannenkoek',
    'poffertjes', 'stroopwafel', 'haring', 'kroket', 'bitterballen', 'zuurkool'],
  American: ['american', 'amerikaans', 'bbq', 'barbecue', 'burger', 'mac and cheese', 'meatloaf', 'cornbread',
    'cheddar', 'ranch', 'coleslaw', 'brownie', 'pancake', 'hot dog', 'sloppy joe'],
  British: ['british', 'engels', 'english', 'fish and chips', 'shepherd s pie', 'cottage pie', 'bangers', 'scone',
    'yorkshire', 'worcestershire', 'stilton'],
  Korean: ['korean', 'koreaans', 'kimchi', 'gochujang', 'bibimbap', 'bulgogi', 'tteokbokki'],
  Vietnamese: ['vietnamese', 'vietnamees', 'pho', 'banh mi', 'nuoc cham', 'rice paper'],
  Indonesian: ['indonesian', 'indonesisch', 'indonesisch', 'rendang', 'satay', 'sate', 'nasi goreng', 'bami',
    'sambal', 'tempeh', 'ketjap', 'kecap'],
  Moroccan: ['moroccan', 'marokkaans', 'tagine', 'ras el hanout', 'preserved lemon', 'harira'],
  Scandinavian: ['scandinavian', 'scandinavisch', 'smorrebrod', 'gravlax', 'lingonberry', 'cardamom']
};

// Short, very common words that say nothing about origin on their own.
const WEAK_WORDS = new Set(['curry', 'rice', 'soy', 'sauce', 'oil', 'cheese', 'bread', 'salad', 'soup']);

// Above this many keyword points a cuisine is claimed; below it the recipe
// stays international instead of being guessed.
const MIN_CONFIDENCE = 3;

/**
 * Normalises text for keyword matching.
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects the cuisine of a recipe from its title and ingredients.
 *
 * @param {{ title?: string, ingredientNames?: string[], description?: string }} recipe
 * @returns {string} canonical cuisine name, or 'International'
 */
export function cuisineFor({ title = '', ingredientNames = [], description = '' } = {}) {
  const titleText = ` ${normalize(title)} `;
  const ingredientText = ` ${normalize([...ingredientNames, description].join(' '))} `;
  if (titleText.trim().length < 2 && ingredientText.trim().length < 2) return 'International';

  let best = '';
  let bestScore = 0;
  for (const [cuisine, words] of Object.entries(CUISINE_WORDS)) {
    let score = 0;
    for (const word of words) {
      const needle = ` ${normalize(word)} `;
      if (!needle.trim()) continue;
      const weight = WEAK_WORDS.has(word) ? 1 : 2;
      if (titleText.includes(needle)) score += weight * 2;
      else if (ingredientText.includes(needle)) score += weight;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cuisine;
    }
  }
  return bestScore >= MIN_CONFIDENCE ? best : 'International';
}

/**
 * The keyword tables, exposed so tests can assert they stay disjoint enough to
 * be useful.
 * @returns {Record<string, string[]>}
 */
export function cuisineWords() {
  return CUISINE_WORDS;
}
