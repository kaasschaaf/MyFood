/**
 * Ingredient canonicalisation - turns a raw recipe line into a stable,
 * comparable ingredient.
 *
 * Raw lines are messy: "1 1/2 cups (180 g) all-purpose flour, divided",
 * "To taste salt", "2 large free-range eggs", "1 (14 oz) can chopped tomatoes
 * [drained]". To dedupe ingredients across 2,000 recipes, to look up one AH
 * product per ingredient and to let a visitor type "zout" on the Mijn
 * producten page, all of those have to collapse to the same key.
 *
 * The key is Dutch, because that is what Albert Heijn understands and what the
 * static products file is keyed on. The display name keeps the source wording.
 *
 * Shared by the data pipeline (scripts/) and the app, so a static choice and a
 * runtime choice agree.
 */

import { translateIngredientToDutch } from './ingredient-dutch.js';
import { toMetric } from './measure.js';

// A single ingredient line never needs this much: past these limits the stored
// number is a data error, not a big batch.
const MAX_LINE_GRAMS = 2000;
const MAX_LINE_ML = 2000;

// Qualifiers that say nothing about the ingredient itself. Matched at the end
// of the line (after the quantity has been removed).
const TRAILING_QUALIFIERS = [
  'to taste',
  'naar smaak',
  'to serve',
  'for serving',
  'to garnish',
  'for garnish',
  'to decorate',
  'for decoration',
  'as needed',
  'if needed',
  'as required',
  'optional',
  'divided',
  'plus more for dusting',
  'plus more for serving',
  'plus extra for dusting',
  'plus more',
  'for dusting',
  'for the garnish',
  'for greasing',
  'for frying',
  'for drizzling',
  'for brushing'
];

// Same idea, but these turn up in the middle of a line ("chicken, cubed").
const INLINE_QUALIFIERS = [
  'finely chopped',
  'roughly chopped',
  'finely sliced',
  'thinly sliced',
  'finely diced',
  'coarsely grated',
  'freshly ground',
  'freshly grated',
  'freshly squeezed',
  'at room temperature',
  'room temperature',
  'ice cold',
  'very cold',
  'cut into pieces',
  'cut into chunks',
  'cut into slices',
  'cut into rounds',
  'cut into matchsticks',
  'sliced into rounds',
  'cut into cubes',
  'cut into wedges',
  'cut into strips',
  'cut in half',
  'halved lengthwise',
  'drained and rinsed',
  'drained',
  'rinsed',
  'peeled and diced',
  'peeled and chopped',
  'cubed',
  'chopped',
  'sliced',
  'diced',
  'minced',
  'crushed',
  'grated',
  'shredded',
  'melted',
  'softened',
  'beaten',
  'whisked',
  'sifted',
  'packed',
  'heaped',
  'rounded',
  'level',
  'trimmed',
  'washed',
  'patted dry',
  'at hand',
  'in total',
  'approximately',
  'approx',
  // Dutch recipe wording.
  'gesnipperd', 'gesnipperde', 'gesneden', 'fijngesneden', 'grofgesneden', 'geraspt', 'gemalen',
  'gehakt', 'geschaafd', 'geperst', 'uitgeperst', 'gekneusd', 'geklopt', 'gesmolten', 'zacht geworden',
  'op kamertemperatuur', 'kamertemperatuur', 'afgespoeld', 'uitgelekt', 'gespoeld', 'gewassen',
  'in blokjes', 'in reepjes', 'in ringen', 'in plakjes', 'in stukjes', 'in kwarten', 'in vieren',
  'fijngehakt', 'grofgehakt', 'kleingesneden', 'losgeklopt', 'geroosterd', 'gedroogd', 'verwarmd'
];

const NOISE_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'and', 'or', 'with', 'plus', 'more', 'extra',
  'about', 'approximately', 'approx', 'some', 'good', 'quality', 'your', 'favourite', 'favorite',
  'fresh', 'freshly', 'large', 'small', 'medium', 'whole', 'plain', 'taste', 'needed', 'required'
]);

// A unit that follows the leading number, longest first so "tablespoons" wins
// over "tbsp".
const UNIT_WORDS = [
  'fluid ounces', 'fluid ounce', 'fl oz', 'floz',
  'tablespoons', 'tablespoon', 'tbsp', 'tbs', 'teaspoons', 'teaspoon', 'tsp',
  'kilograms', 'kilogram', 'kilos', 'kilo', 'kg', 'grams', 'gram', 'gr', 'g',
  'millilitres', 'milliliters', 'millilitre', 'milliliter', 'ml', 'cl', 'dl', 'litres', 'liters', 'litre', 'liter', 'l',
  'ounces', 'ounce', 'oz', 'pounds', 'pound', 'lbs', 'lb',
  'cups', 'cup', 'pints', 'pint', 'quarts', 'quart', 'c',
  'packets', 'packet', 'packs', 'pack', 'pkg', 'tins', 'tin', 'cans', 'can', 'jars', 'jar', 'bottles', 'bottle',
  'slices', 'slice', 'pieces', 'piece', 'cloves', 'clove', 'sprigs', 'sprig', 'leaves', 'leaf',
  'tenen', 'teen', 'takjes', 'takje', 'plakjes', 'plakje', 'blikjes', 'blikje', 'zakjes', 'zakje',
  'pinches', 'pinch', 'dash', 'dashes', 'splash', 'handful', 'handfuls', 'bunch', 'bunches',
  'stuks', 'stuk', 'el', 'tl', 'eetlepels', 'eetlepel', 'theelepels', 'theelepel',
  'portions', 'portion', 'servings', 'serves'
];

// Longest alternatives first, so "fluid ounces" wins over "fluid".
const UNIT_PATTERN = new RegExp(`^(?:${UNIT_WORDS.join('|')})\\b\\.?`, 'i');

/**
 * Normalises text for comparison: no accents, no punctuation, single spaces.
 * @param {string} value
 * @returns {string}
 */
export function normalizeIngredient(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a leading quantity, including fractions, mixed numbers and ranges.
 * @param {string} text
 * @returns {{ amount: number|null, rest: string }}
 */
export function parseLeadingAmount(text) {
  const value = String(text || '').trim();
  // "2-3", "2 to 3", "2 or 3"
  const range = value.match(/^(\d+(?:[.,]\d+)?)\s*(?:-|–|to|or)\s*(\d+(?:[.,]\d+)?)/i);
  if (range) {
    const low = Number(range[1].replace(',', '.'));
    const high = Number(range[2].replace(',', '.'));
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return { amount: (low + high) / 2, rest: value.slice(range[0].length).trim() };
    }
  }
  // "1 1/2", "3/4", "1.5", "1,5", "2"
  const mixed = value.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (denominator) {
      return { amount: whole + numerator / denominator, rest: value.slice(mixed[0].length).trim() };
    }
  }
  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator) return { amount: numerator / denominator, rest: value.slice(fraction[0].length).trim() };
  }
  const plain = value.match(/^(\d+(?:[.,]\d+)?)/);
  if (plain) {
    const amount = Number(plain[1].replace(',', '.'));
    if (Number.isFinite(amount)) return { amount, rest: value.slice(plain[0].length).trim() };
  }
  return { amount: null, rest: value };
}

/**
 * Reads the unit that directly follows the amount.
 * @param {string} text
 * @returns {{ unit: string, rest: string }}
 */
export function parseLeadingUnit(text) {
  const value = String(text || '').trim();
  const match = value.match(UNIT_PATTERN);
  if (!match) return { unit: '', rest: value };
  return { unit: match[0].replace(/\.$/, '').trim(), rest: value.slice(match[0].length).trim() };
}

/**
 * Removes bracketed notes: "(180 g)", "[drained]", "{optional}".
 * @param {string} text
 * @returns {string}
 */
export function stripBrackets(text) {
  return String(text || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Removes trailing qualifiers ("to taste", "for garnish", "plus more for…").
 * @param {string} text
 * @returns {string}
 */
export function stripQualifiers(text) {
  // "cut into 3/4-inch slices" and friends, with or without a size.
  let value = ` ${String(text || '')
    .replace(/\b(?:cut|sliced|chopped|diced|torn)\s+(?:\w+\s+)?into\b[^,;]*?\b(?:slices?|pieces?|chunks?|cubes?|rounds?|wedges?|strips?|matchsticks?|thirds?|quarters?|halves)\b/gi, ' ')
    .replace(/\s+/g, ' ')} `;
  value = ` ${normalizeIngredient(value)} `;
  let changed = true;
  while (changed) {
    changed = false;
    for (const qualifier of TRAILING_QUALIFIERS) {
      const needle = ` ${qualifier} `;
      if (value.includes(needle)) {
        // Only strip it at the end so "salt for the pasta water" survives.
        if (value.trimEnd().endsWith(qualifier)) {
          value = ` ${value.trimEnd().slice(0, value.trimEnd().length - qualifier.length)} `;
          changed = true;
        }
      }
    }
    for (const qualifier of INLINE_QUALIFIERS) {
      const needle = ` ${qualifier} `;
      if (value.includes(needle)) {
        value = value.split(needle).join(' ');
        changed = true;
      }
    }
  }
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Drops leading filler words ("a pinch of" → "").
 * @param {string} text
 * @returns {string}
 */
export function stripNoiseWords(text) {
  const words = normalizeIngredient(text).split(' ').filter(Boolean);
  while (words.length && NOISE_WORDS.has(words[0])) words.shift();
  while (words.length && NOISE_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

// A measurement belongs in the amount, never in the name. Sources write
// "2 tablespoons olive oil 1 teaspoon salt" or "1 lb ground beef, 4 lb roast"
// on one line; whatever lands in the name is removed here.
const MEASURE_WORDS = 'fluid ounces?|fl oz|tablespoons?|teaspoons?|tbsp|tblsp|tbs|tsp|cups?|ounces?|oz|lbs?|pounds?|pints?|quarts?|gallons?|ml|cl|dl|litres?|liters?|l|grams?|gr|g|kg';
const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|quarter';
const MEASUREMENT_PHRASE = new RegExp(`\\d+(?:\\s+\\d+)?(?:[.,/]\\d+)?\\s*(?:${MEASURE_WORDS})\\b`, 'g');
// "four pound beef roast", "seven ounce cans", "about two pounds"
const SPELLED_MEASUREMENT_PHRASE = new RegExp(`\\b(?:${NUMBER_WORDS})\\s+(?:${MEASURE_WORDS})\\b`, 'gi');
// "tablespoons paprika", "lb rigatoni", "heaping tbsp relish": a measure left
// behind by a line the parser could not split.
const LEADING_MEASUREMENT = new RegExp(`^(?:[a-z]\\s+)?(?:${MEASURE_WORDS})\\b\\s*`, 'i');
const INLINE_STRAY_MEASUREMENT = new RegExp(`\\b[a-z]+\\s+(?:${MEASURE_WORDS})\\b`, 'gi');
// Retail noise that crawls along with copied shopping lists.
const PROMO_PHRASE = /\b(?:target|thru)\b.*$/i;

/**
 * Removes measurements and shop noise from an ingredient name.
 * @param {string} text
 * @returns {string}
 */
export function stripMeasurements(text) {
  const cleaned = stripNoiseWords(text)
    .replace(PROMO_PHRASE, ' ')
    .replace(MEASUREMENT_PHRASE, ' ')
    .replace(SPELLED_MEASUREMENT_PHRASE, ' ')
    .replace(INLINE_STRAY_MEASUREMENT, ' ');
  return stripNoiseWords(cleaned.replace(LEADING_MEASUREMENT, ' '));
}

/**
 * Repairs a fraction whose slash the source lost: "34 cup sour cream" is
 * three-quarter cup, "23 cup sugar" two-thirds. Only applied to measuring
 * units when the literal reading is far too large for one ingredient line, so
 * "14 oz tomatoes" stays fourteen ounces.
 * @param {number|null} amount
 * @param {string} unit
 * @returns {number|null}
 */
export function repairLostFraction(amount, unit) {
  if (!Number.isFinite(amount) || amount < 11 || !Number.isInteger(amount)) return amount;
  const direct = toMetric(amount, unit);
  const grams = direct.unit === 'kg' ? direct.amount * 1000 : direct.unit === 'g' ? direct.amount : null;
  const millilitres = direct.unit === 'l' ? direct.amount * 1000 : direct.unit === 'ml' ? direct.amount : null;
  const tooMuch = (grams !== null && grams > MAX_LINE_GRAMS) || (millilitres !== null && millilitres > MAX_LINE_ML);
  if (!tooMuch) return amount;
  const digits = String(amount);
  if (digits.length !== 2) return amount;
  const numerator = Number(digits[0]);
  const denominator = Number(digits[1]);
  return numerator < denominator ? numerator / denominator : amount;
}

/**
 * Splits a raw ingredient line into amount, unit and name.
 * @param {string} line
 * @returns {{ amount: number|null, unit: string, name: string }}
 */
export function parseIngredientLine(line) {
  const original = String(line || '').trim();
  if (!original) return { amount: null, unit: '', name: '' };

  let rest = original;
  // "[1/2 cup] milk" and "2 (14 oz) cans tomatoes" both need the bracket gone
  // before the amount can be read, but a leading bracket may hold the amount.
  const leadingBracket = rest.match(/^[([{]\s*(\d+(?:[.,]\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*([a-z]*)\s*[)\]}]/i);
  if (leadingBracket) {
    const { amount } = parseLeadingAmount(leadingBracket[1]);
    const unit = normalizeIngredient(leadingBracket[2]);
    rest = rest.slice(leadingBracket[0].length).trim();
    const name = stripNoiseWords(stripQualifiers(stripBrackets(rest)));
    return { amount, unit, name };
  }

  rest = stripBrackets(rest);
  const { amount: firstAmount, rest: firstRest } = parseLeadingAmount(rest);
  let amount = firstAmount;
  let afterAmount = firstRest;
  // The source data lost some fraction slashes ("1 12 cups water" for
  // "1 1/2 cups water"), leaving a second number in front of the unit. The
  // number nearest the unit is the real amount.
  if (amount !== null && /^(\d+(?:[.,]\d+)?)\s*[a-z]/i.test(afterAmount)) {
    const second = parseLeadingAmount(afterAmount);
    if (second.amount !== null && parseLeadingUnit(second.rest).unit) {
      amount = second.amount;
      afterAmount = second.rest;
    }
  }
  const { unit, rest: afterUnit } = parseLeadingUnit(afterAmount);
  amount = repairLostFraction(amount, unit);
  // When a unit was read, an empty remainder means the line is only a
  // measurement ("5 oz."), not an ingredient.
  const name = stripNoiseWords(stripQualifiers(unit ? afterUnit : afterUnit || afterAmount));
  return { amount, unit, name };
}

/**
 * Dutch search key for an ingredient name. Falls back to the normalised
 * English name when the glossary does not know it, so a key always exists.
 * @param {string} name
 * @returns {string}
 */
export function canonicalIngredientKey(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  const translated = translateIngredientToDutch(value);
  if (translated.changed && translated.text) return normalizeIngredient(translated.text);
  return normalizeIngredient(value);
}

/**
 * Canonical form of one ingredient line, ready for dedupe and product lookup.
 * @param {string} line
 * @returns {{ key: string, nameEn: string, nameNl: string, amount: number|null, unit: string, raw: string }}
 */
export function canonicalIngredient(line) {
  const raw = String(line || '').trim();
  const parsed = parseIngredientLine(raw);
  // Qualifiers can survive the parse when they follow the amount directly
  // ("2 cloves garlic, crushed" → "garlic"), so clean the name once more.
  const parsedName = stripMeasurements(stripQualifiers(parsed.name));
  // "5 oz." is a measurement without a product; falling back to the raw line
  // would store "oz" as an ingredient, so only fall back when no unit parsed.
  const name = parsedName || (parsed.unit ? '' : stripMeasurements(stripQualifiers(raw)));
  const translated = translateIngredientToDutch(name);
  const nameNl = translated.changed && translated.text ? normalizeIngredient(translated.text) : normalizeIngredient(name);
  return {
    key: canonicalIngredientKey(name),
    nameEn: normalizeIngredient(name),
    nameNl,
    amount: parsed.amount,
    unit: parsed.unit,
    raw
  };
}

/**
 * Splits "salt and pepper" or "olive oil & butter" into separate ingredients.
 * Only splits when the amount is absent and every part is a name the glossary
 * understands, so "chicken and rice casserole" stays one ingredient.
 * @param {string} line
 * @returns {Array<{ key: string, nameEn: string, nameNl: string, amount: number|null, unit: string, raw: string }>}
 */
export function canonicalIngredients(line) {
  // "1 lb hot dogs or 8 oz bologna" offers two products for one line; keeping
  // them together leaves a measurement inside the name.
  const alternatives = String(line || '').split(/\s+or\s+/i).map(part => part.trim());
  if (alternatives.length > 1 && alternatives.every(part => parseIngredientLine(part).amount !== null)) {
    return alternatives.map(part => canonicalIngredient(part));
  }
  const single = canonicalIngredient(line);
  const parsed = parseIngredientLine(line);
  if (parsed.amount !== null) return [single];
  const parts = String(parsed.name || '')
    .split(/\s+(?:and|&|\+|met)\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [single];
  const known = parts.every(part => {
    const translated = translateIngredientToDutch(part);
    return translated.changed && translated.complete;
  });
  if (!known) return [single];
  return parts.map(part => canonicalIngredient(part));
}

/**
 * Whether a line yielded enough to be worth storing ("To taste salt" is fine,
 * "some stuff" is not).
 * @param {string} line
 * @returns {boolean}
 */
export function isUsableIngredientLine(line) {
  const ingredient = canonicalIngredient(line);
  return Boolean(ingredient.key && ingredient.key.length > 1);
}
