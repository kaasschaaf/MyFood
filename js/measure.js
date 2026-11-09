/**
 * Metric measures.
 *
 * Recipes arrive from every corner of the internet: cups, ounces, pounds,
 * pints and quarts next to grams and millilitres. Kost shows **metric only**, so
 * every amount is converted once, here, and every unit label comes from the
 * same table.
 *
 * Spoons are converted to millilitres too (1 tsp = 5 ml, 1 tbsp = 15 ml):
 * they are a volume, and "5 ml" needs no explanation.
 *
 * Counted things (cloves, slices, cans) stay counts — "2 teentjes knoflook" is
 * clearer than "10 g knoflook" — but their labels are localised.
 */

// Everything that measures weight, expressed in grams.
const WEIGHT_UNITS = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  gramme: 1,
  grammes: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592
};

// Everything that measures volume, expressed in millilitres.
const VOLUME_UNITS = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  cc: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  // Spoons.
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  tl: 5,
  theelepel: 5,
  theelepels: 5,
  tbsp: 15,
  tbs: 15,
  tablespoon: 15,
  tablespoons: 15,
  el: 15,
  eetlepel: 15,
  eetlepels: 15,
  // Cups and the rest of the imperial family.
  cup: 240,
  cups: 240,
  c: 240,
  'fl oz': 30,
  'floz': 30,
  'fluid ounce': 30,
  'fluid ounces': 30,
  pint: 473,
  pints: 473,
  quart: 946,
  quarts: 946,
  gallon: 3785,
  gallons: 3785,
  glass: 200
};

// Counted units, mapped to one canonical key per kind of thing.
const COUNT_UNITS = {
  piece: 'piece',
  pieces: 'piece',
  stuk: 'piece',
  stuks: 'piece',
  pc: 'piece',
  pcs: 'piece',
  clove: 'clove',
  cloves: 'clove',
  teen: 'clove',
  tenen: 'clove',
  teentje: 'clove',
  teentjes: 'clove',
  slice: 'slice',
  slices: 'slice',
  plak: 'slice',
  plakje: 'slice',
  plakjes: 'slice',
  can: 'can',
  cans: 'can',
  tin: 'can',
  tins: 'can',
  blik: 'can',
  blikje: 'can',
  blikjes: 'can',
  pkg: 'pkg',
  pkgs: 'pkg',
  packet: 'pkg',
  packets: 'pkg',
  pack: 'pkg',
  packs: 'pkg',
  pak: 'pkg',
  pakje: 'pkg',
  pakjes: 'pkg',
  bunch: 'bunch',
  bunches: 'bunch',
  bos: 'bunch',
  bosje: 'bunch',
  bosjes: 'bunch',
  sprig: 'sprig',
  sprigs: 'sprig',
  takje: 'sprig',
  takjes: 'sprig',
  leaf: 'leaf',
  leaves: 'leaf',
  blaadje: 'leaf',
  blaadjes: 'leaf',
  handful: 'handful',
  handfuls: 'handful',
  handvol: 'handful',
  dash: 'dash',
  dashes: 'dash',
  pinch: 'pinch',
  pinches: 'pinch',
  snufje: 'pinch',
  snufjes: 'pinch',
  head: 'head',
  heads: 'head',
  portie: 'piece',
  porties: 'piece',
  portion: 'piece',
  portions: 'piece',
  serving: 'piece',
  servings: 'piece'
};

// Localised labels for the counted units.
const COUNT_LABELS = {
  piece: { nl: ['stuk', 'stuks'], en: ['piece', 'pieces'] },
  clove: { nl: ['teentje', 'teentjes'], en: ['clove', 'cloves'] },
  slice: { nl: ['plakje', 'plakjes'], en: ['slice', 'slices'] },
  can: { nl: ['blikje', 'blikjes'], en: ['can', 'cans'] },
  pkg: { nl: ['pakje', 'pakjes'], en: ['packet', 'packets'] },
  bunch: { nl: ['bosje', 'bosjes'], en: ['bunch', 'bunches'] },
  sprig: { nl: ['takje', 'takjes'], en: ['sprig', 'sprigs'] },
  leaf: { nl: ['blaadje', 'blaadjes'], en: ['leaf', 'leaves'] },
  handful: { nl: ['handvol', 'handvol'], en: ['handful', 'handfuls'] },
  dash: { nl: ['snufje', 'snufjes'], en: ['dash', 'dashes'] },
  pinch: { nl: ['snufje', 'snufjes'], en: ['pinch', 'pinches'] },
  head: { nl: ['stuk', 'stuks'], en: ['head', 'heads'] }
};

/**
 * Normalises a unit string for lookup: lowercase, no dots, single spaces.
 * @param {string} unit
 * @returns {string}
 */
export function normalizeUnit(unit) {
  return String(unit || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a unit is already metric (so a stored amount needs no conversion).
 * @param {string} unit
 * @returns {boolean}
 */
export function isMetricUnit(unit) {
  const value = normalizeUnit(unit);
  return ['g', 'gr', 'gram', 'grams', 'kg', 'kilo', 'kilogram', 'kilograms', 'ml', 'milliliter',
    'milliliters', 'millilitre', 'millilitres', 'cl', 'dl', 'l', 'liter', 'liters', 'litre',
    'litres'].includes(value);
}

/**
 * Rounds to a sensible cooking precision: whole units above 10, one decimal
 * below.
 * @param {number} value
 * @returns {number}
 */
export function roundAmount(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 100) return Math.round(value);
  if (value >= 10) return Math.round(value * 2) / 2;
  return Math.round(value * 10) / 10;
}

/**
 * Converts an amount + unit to metric, choosing g/ml or kg/l for readability.
 *
 * @param {number|null} amount
 * @param {string} unit
 * @returns {{ amount: number|null, unit: string }} `unit` is one of g, kg, ml, l
 *   or a canonical count key from COUNT_UNITS; '' when the unit is unknown.
 */
export function toMetric(amount, unit) {
  const value = Number(amount);
  const key = normalizeUnit(unit);

  if (!Number.isFinite(value) || value <= 0) {
    // "a dash of salt": the word is the quantity, so keep a counted unit and
    // drop a measuring unit that has no number.
    return { amount: null, unit: COUNT_UNITS[key] || '' };
  }

  if (Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, key)) {
    const grams = value * WEIGHT_UNITS[key];
    return grams >= 1000
      ? { amount: roundAmount(grams / 1000), unit: 'kg' }
      : { amount: roundAmount(grams), unit: 'g' };
  }

  if (Object.prototype.hasOwnProperty.call(VOLUME_UNITS, key)) {
    const millilitres = value * VOLUME_UNITS[key];
    return millilitres >= 1000
      ? { amount: roundAmount(millilitres / 1000), unit: 'l' }
      : { amount: roundAmount(millilitres), unit: 'ml' };
  }

  if (Object.prototype.hasOwnProperty.call(COUNT_UNITS, key)) {
    // Counts keep their number; "0.5 blikje" reads badly, so a fractional
    // count is rounded to one whole item.
    const count = Math.max(1, Math.round(value));
    return { amount: count, unit: COUNT_UNITS[key] };
  }

  // Unknown unit: keep the amount, drop the word so no imperial label leaks
  // through ("2 large" becomes "2").
  return { amount: roundAmount(value), unit: '' };
}

/**
 * Localised label for a canonical unit.
 * @param {string} unit canonical unit from toMetric
 * @param {number|null} amount used to pick singular or plural
 * @param {'nl'|'en'} [lang]
 * @returns {string}
 */
export function unitLabel(unit, amount, lang = 'nl') {
  const key = String(unit || '');
  if (!key) return '';
  // g/kg/ml/l are the same in both languages.
  if (['g', 'kg', 'ml', 'l'].includes(key)) return key;
  const labels = COUNT_LABELS[key];
  if (!labels) return key;
  const [one, other] = labels[lang === 'en' ? 'en' : 'nl'];
  return Number(amount) === 1 || amount == null ? one : other;
}

/**
 * Formats a number the way the active language writes it (1,5 vs 1.5).
 * @param {number} amount
 * @param {'nl'|'en'} [lang]
 * @returns {string}
 */
export function formatAmount(amount, lang = 'nl') {
  if (!Number.isFinite(amount)) return '';
  const rounded = roundAmount(amount);
  return rounded.toLocaleString(lang === 'en' ? 'en-GB' : 'nl-NL', {
    maximumFractionDigits: rounded < 10 ? 1 : 0
  });
}

/**
 * Full display string for an ingredient amount: "1,5 l", "250 g", "2 teentjes".
 * @param {number|null} amount
 * @param {string} unit
 * @param {'nl'|'en'} [lang]
 * @returns {string}
 */
export function formatQuantity(amount, unit, lang = 'nl') {
  const value = Number(amount);
  const metric = toMetric(Number.isFinite(value) ? value : null, unit);
  const label = unitLabel(metric.unit, metric.amount, lang);
  if (!Number.isFinite(metric.amount)) return label;
  return `${formatAmount(metric.amount, lang)} ${label}`.trim();
}
