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

const UNIT_PATTERN = new RegExp(`^(?:${UNIT_WORDS.join('|')})\\b\\.?`);

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
  const { amount, rest: afterAmount } = parseLeadingAmount(rest);
  const { unit, rest: afterUnit } = parseLeadingUnit(afterAmount);
  const name = stripNoiseWords(stripQualifiers(afterUnit || afterAmount));
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
  const name = stripNoiseWords(stripQualifiers(parsed.name)) || stripNoiseWords(stripQualifiers(raw));
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
