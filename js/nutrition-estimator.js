/**
 * Nutrition estimator - gives external recipes (TheMealDB) the same protein and
 * health metrics as the hand-written Dutch recipes.
 *
 * Everything here is offline: a compact food table with values per 100 g (or
 * per 100 ml for liquids) plus a piece weight, so "2 eggs" or "1 onion" can be
 * weighed too. The numbers are estimates; `estimated: true` says so.
 */

// Reference weights for units that count pieces, cans or bunches.
const COUNT_WEIGHTS = {
  stuks: 0,
  stuk: 0,
  piece: 0,
  pieces: 0,
  large: 0,
  medium: 0,
  small: 0,
  whole: 0,
  clove: 4,
  cloves: 4,
  slice: 25,
  slices: 25,
  can: 400,
  cans: 400,
  tin: 400,
  tins: 400,
  packet: 100,
  packets: 100,
  bunch: 30,
  bunches: 30,
  handful: 30,
  sprig: 2,
  sprigs: 2,
  leaf: 0.3,
  leaves: 0.3,
  pinch: 0.5,
  pinches: 0.5
};

const GRAM_UNITS = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  mg: 0.001,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6
};

// Volume is converted to grams with a density of 1, which is close enough for
// water, milk, stock and oil at cooking scale.
const VOLUME_UNITS = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  litre: 1000,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  tl: 5,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  el: 15,
  cup: 240,
  cups: 240,
  glass: 200
};

/**
 * Food table. Values per 100 g unless the entry sets `piece` (grams per piece).
 * `veg` marks fruit, vegetables and legumes (fibre and vitamin rich), which
 * drive the health score.
 */
const FOODS = [
  // Bouillon, nat en andere bijna-kcaloze ingrediënten eerst: "chicken stock"
  // mag niet als kip worden gerekend.
  { match: /stock|bouillon|broth|gravy|water/, kcal: 8, protein: 0.5, carbs: 1, fat: 0.2, fibre: 0 },

  // Vlees, vis en vega
  { match: /chicken breast|kipfilet|chicken fillet/, kcal: 165, protein: 31, carbs: 0, fat: 3.6, fibre: 0, piece: 170 },
  { match: /chicken (thigh|leg|drumstick)|chicken legs|kip.*(dij|bout)/, kcal: 209, protein: 26, carbs: 0, fat: 11, fibre: 0, piece: 120 },
  { match: /chicken|kip\b/, kcal: 190, protein: 28, carbs: 0, fat: 7, fibre: 0, piece: 150 },
  { match: /turkey|kalkoen/, kcal: 189, protein: 29, carbs: 0, fat: 7, fibre: 0, piece: 150 },
  { match: /duck|eend/, kcal: 337, protein: 19, carbs: 0, fat: 28, fibre: 0, piece: 200 },
  { match: /veal|kalf/, kcal: 172, protein: 31, carbs: 0, fat: 5, fibre: 0, piece: 150 },
  { match: /lamb/, kcal: 294, protein: 25, carbs: 0, fat: 21, fibre: 0, piece: 150 },
  { match: /bacon|pancetta|spek/, kcal: 350, protein: 25, carbs: 1, fat: 27, fibre: 0, piece: 15 },
  { match: /ham|prosciutto|parma ham/, kcal: 145, protein: 21, carbs: 1, fat: 6, fibre: 0, piece: 20 },
  { match: /chorizo|sausage|worst|kielbasa|black pudding/, kcal: 300, protein: 18, carbs: 2, fat: 25, fibre: 0, piece: 70 },
  { match: /oxtail|beef|rund|steak|brisket|mince|minced|gehakt/, kcal: 250, protein: 26, carbs: 0, fat: 15, fibre: 0, piece: 150 },
  { match: /pork|varken/, kcal: 242, protein: 27, carbs: 0, fat: 14, fibre: 0, piece: 150 },
  { match: /goat meat|geitenvlees/, kcal: 143, protein: 27, carbs: 0, fat: 3, fibre: 0, piece: 150 },
  { match: /salmon|zalm/, kcal: 208, protein: 20, carbs: 0, fat: 13, fibre: 0, piece: 150 },
  { match: /tuna|tonijn/, kcal: 132, protein: 28, carbs: 0, fat: 1, fibre: 0, piece: 150 },
  { match: /sardine|pilchard|anchovy|haring|herring|mackerel/, kcal: 208, protein: 20, carbs: 0, fat: 13, fibre: 0, piece: 30 },
  { match: /cod|haddock|monkfish|white fish|kabeljauw|schelvis/, kcal: 82, protein: 18, carbs: 0, fat: 0.7, fibre: 0, piece: 150 },
  { match: /prawn|shrimp|garnaal|squid|calamari|mussel|clam|oyster/, kcal: 99, protein: 24, carbs: 0.2, fat: 0.3, fibre: 0, piece: 12 },
  { match: /tofu|tahoe/, kcal: 76, protein: 8, carbs: 1.9, fat: 4.8, fibre: 0.3, veg: true, piece: 100 },
  { match: /falafel/, kcal: 333, protein: 13, carbs: 32, fat: 18, fibre: 5, veg: true, piece: 20 },

  // Zuivel en kaas
  { match: /parmesan|pecorino|gruy|stilton|mature cheddar|cheddar|gouda|colby|monterey|cheese|kaas/, kcal: 400, protein: 25, carbs: 1.3, fat: 33, fibre: 0, piece: 30 },
  { match: /feta/, kcal: 264, protein: 14, carbs: 4, fat: 21, fibre: 0, piece: 30 },
  { match: /mozzarella/, kcal: 280, protein: 18, carbs: 3, fat: 17, fibre: 0, piece: 30 },
  { match: /mascarpone/, kcal: 429, protein: 4, carbs: 3, fat: 44, fibre: 0 },
  { match: /ricotta/, kcal: 174, protein: 11, carbs: 3, fat: 13, fibre: 0 },
  { match: /cream cheese|roomkaas/, kcal: 342, protein: 6, carbs: 4, fat: 34, fibre: 0 },
  { match: /greek yogurt|griekse yoghurt/, kcal: 97, protein: 9, carbs: 4, fat: 5, fibre: 0 },
  { match: /yogurt|yoghurt|fromage frais/, kcal: 60, protein: 10, carbs: 4, fat: 0.4, fibre: 0 },
  { match: /creme fraiche|sour cream|soured cream|zure room/, kcal: 200, protein: 2.5, carbs: 3, fat: 20, fibre: 0 },
  { match: /double cream|heavy cream|clotted cream|slagroom|cream|room/, kcal: 340, protein: 2, carbs: 3, fat: 36, fibre: 0 },
  { match: /condensed milk|gecondenseerde melk/, kcal: 321, protein: 8, carbs: 54, fat: 9, fibre: 0 },
  { match: /buttermilk|karnemelk/, kcal: 40, protein: 3.3, carbs: 4.8, fat: 0.9, fibre: 0 },
  { match: /milk|melk/, kcal: 62, protein: 3.3, carbs: 4.7, fat: 3.4, fibre: 0 },
  { match: /butter|boter|ghee/, kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, fibre: 0 },
  { match: /ice cream|ijs/, kcal: 207, protein: 3.5, carbs: 24, fat: 11, fibre: 0.7 },

  // Eieren
  { match: /egg|ei\b|eieren/, kcal: 143, protein: 13, carbs: 0.7, fat: 9.5, fibre: 0, piece: 50 },

  // Oliën en vetten
  { match: /oil|olie/, kcal: 884, protein: 0, carbs: 0, fat: 100, fibre: 0 },

  // Bonen, linzen en noten
  { match: /lentil|linze|dal\b/, kcal: 116, protein: 9, carbs: 20, fat: 0.4, fibre: 8, veg: true },
  { match: /chickpea|kikkererwt/, kcal: 164, protein: 9, carbs: 27, fat: 2.6, fibre: 8, veg: true },
  { match: /bean|boon|bonen/, kcal: 127, protein: 8.7, carbs: 23, fat: 0.5, fibre: 6.4, veg: true },
  { match: /baked beans/, kcal: 94, protein: 5, carbs: 15, fat: 0.5, fibre: 4, veg: true },
  { match: /peanut butter|pindakaas/, kcal: 588, protein: 25, carbs: 20, fat: 50, fibre: 6 },
  { match: /nut|noot|almond|amandel|cashew|walnut|pecan|hazel|pistachio|pine nut|sesame/, kcal: 600, protein: 20, carbs: 20, fat: 50, fibre: 8, veg: true },

  // Granen, pasta en brood
  { match: /pasta|spaghetti|penne|macaroni|rigatoni|farfalle|tagliatelle|fettuccine|linguine|pappardelle|lasagne|noodle|noedel|vermicelli|udon/, kcal: 350, protein: 12, carbs: 71, fat: 1.5, fibre: 3 },
  { match: /rice|rijst/, kcal: 350, protein: 7, carbs: 78, fat: 0.6, fibre: 1.3 },
  { match: /couscous|bulgur|quinoa/, kcal: 360, protein: 13, carbs: 70, fat: 2, fibre: 5 },
  { match: /oats|oatmeal|havermout|porridge/, kcal: 389, protein: 17, carbs: 66, fat: 7, fibre: 10, veg: true },
  { match: /flour|meel|bloem|starch|zetmeel|polenta|cornmeal/, kcal: 364, protein: 10, carbs: 76, fat: 1, fibre: 2.7 },
  { match: /bread|brood|baguette|ciabatta|pita|naan|tortilla|wrap|bun|muffin|roll/, kcal: 280, protein: 9, carbs: 50, fat: 4, fibre: 3 },
  { match: /pastry|filo|puff|shortcrust|deeg/, kcal: 400, protein: 6, carbs: 40, fat: 25, fibre: 2 },

  // Aardappel en groente
  { match: /potato|aardappel/, kcal: 77, protein: 2, carbs: 17, fat: 0.1, fibre: 2.2, veg: true, piece: 170 },
  { match: /sweet potato|zoete aardappel/, kcal: 86, protein: 1.6, carbs: 20, fat: 0.1, fibre: 3, veg: true, piece: 180 },
  { match: /onion|ui\b|sjalot|shallot|scallion|spring onion|challot/, kcal: 40, protein: 1.1, carbs: 9, fat: 0.1, fibre: 1.7, veg: true, piece: 110 },
  { match: /garlic|knoflook/, kcal: 149, protein: 6.4, carbs: 33, fat: 0.5, fibre: 2.1, veg: true, piece: 4 },
  { match: /carrot|wortel|peen/, kcal: 41, protein: 0.9, carbs: 10, fat: 0.2, fibre: 2.8, veg: true, piece: 70 },
  { match: /broccoli/, kcal: 34, protein: 2.8, carbs: 7, fat: 0.4, fibre: 2.6, veg: true },
  { match: /cauliflower|bloemkool/, kcal: 25, protein: 1.9, carbs: 5, fat: 0.3, fibre: 2, veg: true },
  { match: /spinach|spinazie/, kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, fibre: 2.2, veg: true },
  { match: /kale|boerenkool/, kcal: 49, protein: 4.3, carbs: 9, fat: 0.9, fibre: 3.6, veg: true },
  { match: /lettuce|sla|rocket|rucola|iceberg/, kcal: 15, protein: 1.4, carbs: 2.9, fat: 0.2, fibre: 1.3, veg: true },
  { match: /cucumber|komkommer/, kcal: 15, protein: 0.7, carbs: 3.6, fat: 0.1, fibre: 0.5, veg: true, piece: 300 },
  { match: /tomato|tomaat/, kcal: 20, protein: 0.9, carbs: 3.9, fat: 0.2, fibre: 1.2, veg: true, piece: 120 },
  { match: /pepper|paprika/, kcal: 31, protein: 1, carbs: 6, fat: 0.3, fibre: 2.1, veg: true, piece: 120 },
  { match: /chilli|chili|peper/, kcal: 40, protein: 1.9, carbs: 9, fat: 0.4, fibre: 1.5, veg: true, piece: 15 },
  { match: /courgette|zucchini/, kcal: 17, protein: 1.2, carbs: 3, fat: 0.3, fibre: 1, veg: true, piece: 200 },
  { match: /aubergine|egg plant/, kcal: 25, protein: 1, carbs: 6, fat: 0.2, fibre: 3, veg: true, piece: 250 },
  { match: /mushroom|champignon/, kcal: 22, protein: 3.1, carbs: 3.3, fat: 0.3, fibre: 1, veg: true, piece: 15 },
  { match: /peas|erwt|doperwt/, kcal: 81, protein: 5.4, carbs: 14, fat: 0.4, fibre: 5, veg: true },
  { match: /green bean|sperzieboon|broad bean|sugar snap/, kcal: 31, protein: 1.8, carbs: 7, fat: 0.2, fibre: 2.7, veg: true },
  { match: /cabbage|kool|sprout|spruit/, kcal: 25, protein: 1.3, carbs: 6, fat: 0.1, fibre: 2.5, veg: true },
  { match: /celery|selderij|leek|prei|fennel|venkel/, kcal: 30, protein: 1.2, carbs: 6, fat: 0.2, fibre: 2, veg: true, piece: 80 },
  { match: /pumpkin|squash|pompoen/, kcal: 26, protein: 1, carbs: 6.5, fat: 0.1, fibre: 1.5, veg: true },
  { match: /beetroot|biet/, kcal: 43, protein: 1.6, carbs: 10, fat: 0.2, fibre: 2.8, veg: true, piece: 100 },
  { match: /asparagus|asperge/, kcal: 20, protein: 2.2, carbs: 3.9, fat: 0.1, fibre: 2.1, veg: true, piece: 25 },
  { match: /sweetcorn|corn|mais/, kcal: 86, protein: 3.3, carbs: 19, fat: 1.4, fibre: 2.7, veg: true },
  { match: /avocado/, kcal: 160, protein: 2, carbs: 8.5, fat: 15, fibre: 6.7, veg: true, piece: 150 },
  { match: /olive|olijf/, kcal: 145, protein: 1, carbs: 6, fat: 15, fibre: 3.2, veg: true, piece: 4 },
  { match: /pickle|gherkin|augurk|sauerkraut|zuurkool/, kcal: 20, protein: 1, carbs: 3, fat: 0.1, fibre: 1.5, veg: true },
  { match: /bean sprout|taugé/, kcal: 30, protein: 3, carbs: 6, fat: 0.2, fibre: 1.8, veg: true },

  // Fruit
  { match: /apple|appel/, kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, fibre: 2.4, veg: true, piece: 180 },
  { match: /pear|peer/, kcal: 57, protein: 0.4, carbs: 15, fat: 0.1, fibre: 3.1, veg: true, piece: 180 },
  { match: /banana|banaan/, kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, fibre: 2.6, veg: true, piece: 120 },
  { match: /berr|framboos|blauwe bes|aardbei|blackberr|redcurrant|rhubarb|rabarber/, kcal: 50, protein: 1, carbs: 12, fat: 0.4, fibre: 3, veg: true },
  { match: /lemon|citroen|lime/, kcal: 29, protein: 1.1, carbs: 9, fat: 0.3, fibre: 2.8, veg: true, piece: 60 },
  { match: /orange|sinaasappel/, kcal: 47, protein: 0.9, carbs: 12, fat: 0.1, fibre: 2.4, veg: true, piece: 140 },
  { match: /raisin|rozijn|sultana|currant|date|dadel|apricot|abrikoos|prune|fig/, kcal: 300, protein: 3, carbs: 70, fat: 0.6, fibre: 7, veg: true },
  { match: /coconut|kokos/, kcal: 660, protein: 7, carbs: 24, fat: 64, fibre: 16 },

  // Sauzen, oliën, zoet en overig
  { match: /sugar|suiker|syrup|siroop|honey|honing|jam|marmalade|marzipan/, kcal: 350, protein: 0.3, carbs: 88, fat: 0.1, fibre: 0.3 },
  { match: /chocolate|chocolade|cocoa|cacao/, kcal: 500, protein: 7, carbs: 50, fat: 30, fibre: 7 },
  { match: /ketchup/, kcal: 100, protein: 1, carbs: 26, fat: 0.1, fibre: 0.5 },
  { match: /mayonnaise|mayo/, kcal: 680, protein: 1, carbs: 1, fat: 75, fibre: 0 },
  { match: /soy sauce|sojasaus/, kcal: 53, protein: 8, carbs: 5, fat: 0.1, fibre: 0.8 },
  { match: /fish sauce|vissaus/, kcal: 35, protein: 5, carbs: 3.6, fat: 0, fibre: 0 },
  { match: /curry paste|harissa|gochujang|doubanjiang|miso/, kcal: 150, protein: 5, carbs: 15, fat: 8, fibre: 2 },
  { match: /vinegar|azijn|wine|wijn|sake|mirin|rum|sherry|brandy|beer|stout|cider/, kcal: 20, protein: 0.5, carbs: 2, fat: 0, fibre: 0 },
  { match: /salt|zout|pepper|peper|spice|kruid|seasoning|paprika|oregano|thyme|tijm|basil|basilicum|parsley|peterselie|cinnamon|kaneel|cumin|komijn|turmeric|kurkuma|ginger|gember|garlic powder|baking powder|soda|yeast|gist/, kcal: 120, protein: 6, carbs: 20, fat: 4, fibre: 12, veg: true }
];

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// Sanity limits: a recipe line that weighs more than this is a parsing
// accident, and a portion with more than this many calories is not a dinner.
const MAX_GRAMS_PER_LINE = 2500;
const MAX_PIECES = 12;
// A portion stays within these bounds; beyond them the servings field is wrong.
const MAX_KCAL_PER_SERVING = 900;
const MAX_PROTEIN_PER_SERVING = 55;
const MAX_PORTIONS = 12;

function normalizeUnit(unit) {
  return String(unit || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

/**
 * Finds the table entry for an ingredient name, if any.
 * @param {string} name
 * @returns {Object|null}
 */
export function findFood(name) {
  const value = String(name || '').toLowerCase();
  if (!value) return null;
  for (const food of FOODS) {
    if (food.match.test(value)) return food;
  }
  return null;
}

/**
 * Grams for one ingredient line, or null when the amount cannot be weighed.
 * @param {Object} ingredient
 * @param {Object} food
 * @returns {number|null}
 */
export function ingredientGrams(ingredient, food) {
  const amount = Number(ingredient?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = normalizeUnit(ingredient.unit);
  const grams = (() => {
    if (GRAM_UNITS[unit]) return amount * GRAM_UNITS[unit];
    if (VOLUME_UNITS[unit]) return amount * VOLUME_UNITS[unit];
    const countWeight = COUNT_WEIGHTS[unit] || 0;
    if (countWeight > 0) return amount * countWeight;
    // Anything else ("2 large", "1 chopped") is treated as a count. A big
    // number without a unit is not a pile of pieces ("200 rund lam" is grams),
    // so the piece weight only applies to plausible counts.
    if (!food?.piece || amount > MAX_PIECES) return null;
    return amount * food.piece;
  })();
  if (!Number.isFinite(grams) || grams <= 0) return null;
  // A single ingredient line never weighs more than a large pan's worth; the
  // dataset sometimes writes "200" where it means grams.
  return Math.min(grams, MAX_GRAMS_PER_LINE);
}

/**
 * Estimates per-serving nutrition for a recipe.
 * @param {Object} recipe
 * @param {number} [servings]
 * @returns {{calories:number, proteinGrams:number, carbsGrams:number, fatGrams:number, healthScore:number, estimated:boolean}|null}
 */
export function estimateRecipeNutrition(recipe, servings) {
  const ingredients = recipe?.ingredients || [];
  if (!ingredients.length) return null;
  const portions = Number(servings) > 0 ? Number(servings) : (Number(recipe.baseServings) > 0 ? Number(recipe.baseServings) : 2);

  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fibre = 0;
  let vegGrams = 0;
  let totalGrams = 0;
  let matched = 0;

  ingredients.forEach(ingredient => {
    const food = findFood(ingredient.name) ||
      findFood(ingredient.displayName) ||
      Object.values(ingredient.translations || {}).map(findFood).find(Boolean);
    if (!food) return;
    const grams = ingredientGrams(ingredient, food);
    if (!grams || !Number.isFinite(grams)) return;
    matched++;
    const factor = grams / 100;
    calories += food.kcal * factor;
    protein += food.protein * factor;
    carbs += food.carbs * factor;
    fat += food.fat * factor;
    fibre += (food.fibre || 0) * factor;
    totalGrams += grams;
    if (food.veg) vegGrams += grams;
  });

  // One recognisable ingredient is not a nutrition profile.
  if (matched < 2 || calories <= 0 || totalGrams <= 0) return null;

  if (calories / portions < 60) return null;
  // The dataset's servings field is frequently wrong ("serves 4" on a family
  // pot), so derive the portion count from the food that is actually in the
  // pot: a portion never carries more than a big dinner plate of energy or a
  // very protein-heavy serving. Everything is divided by the same number, so
  // the ratios (and the health score) stay intact.
  const requiredPortions = Math.max(
    portions,
    Math.ceil(calories / MAX_KCAL_PER_SERVING),
    Math.ceil(protein / MAX_PROTEIN_PER_SERVING)
  );
  // Needing more than a dozen portions means the amounts were misread: no
  // estimate is better than a card claiming 19 000 kcal.
  if (requiredPortions > MAX_PORTIONS) return null;
  const effectivePortions = Math.max(1, requiredPortions);
  const perServing = calories / effectivePortions;
  if (perServing < 60) return null;

  const proteinShare = (protein * 4) / calories;
  const fatShare = (fat * 9) / calories;
  const fibrePer100Kcal = fibre / (calories / 100);
  const vegShare = vegGrams / totalGrams;

  const score = Math.round(
    35 * clamp(proteinShare / 0.3) +
    25 * clamp(fibrePer100Kcal / 2.5) +
    20 * clamp(vegShare / 0.45) +
    20 * (1 - clamp((fatShare - 0.3) / 0.3))
  );

  return {
    calories: Math.round(calories / effectivePortions),
    proteinGrams: Math.round(protein / effectivePortions),
    carbsGrams: Math.round(carbs / effectivePortions),
    fatGrams: Math.round(fat / effectivePortions),
    healthScore: Math.min(98, Math.max(15, score)),
    estimated: true
  };
}
