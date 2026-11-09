/**
 * AH pricing math, shared by the app and the data pipeline.
 *
 * Recipes ask for amounts ("350 g broccoli", "2 eggs", "4 tortillas"); AH sells
 * packs ("500 g", "10 stuks", "320 g"). These helpers turn one into the other
 * and report what the used part costs, so the static price snapshot and a live
 * product search are priced identically.
 */

import { ingredientHeadword } from './ingredient-matching.js';

// More packs than this means the product does not fit the recipe's scale (for
// example a 36 g spice mix for 350 g of vegetables).
export const MAX_PACKS_PER_INGREDIENT = 6;
// A single ingredient line never costs this much. Above it the match is wrong
// (a €1 899 air conditioner once stood in for "muffin split"), so the cost is
// reported as unknown instead of inventing a nine-hundred-euro sandwich.
export const MAX_INGREDIENT_COST = 40;
// Volume and weight are close enough for sauces, oils and drinks.
const VOLUME_WEIGHT_EQUIVALENTS = new Set(['volume>weight', 'weight>volume']);

// Recipes ask for "4 tortillas" or "1 onion" where AH sells by weight. These
// reference weights bridge that; deliberately rounded, only to estimate cost.
export const PIECE_WEIGHT_GRAMS = {
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

export const QUANTITY_UNITS = {
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
  pcs: ['count', 1],
  clove: ['count', 1],
  cloves: ['count', 1],
  teen: ['count', 1],
  teentje: ['count', 1],
  teentjes: ['count', 1],
  slice: ['count', 1],
  slices: ['count', 1],
  plakje: ['count', 1],
  plakjes: ['count', 1],
  can: ['count', 1],
  cans: ['count', 1],
  blikje: ['count', 1],
  blikjes: ['count', 1],
  pkg: ['count', 1],
  pkgs: ['count', 1],
  packet: ['count', 1],
  packets: ['count', 1],
  pakje: ['count', 1],
  pakjes: ['count', 1],
  bunch: ['count', 1],
  bunches: ['count', 1],
  bosje: ['count', 1],
  bosjes: ['count', 1],
  sprig: ['count', 1],
  sprigs: ['count', 1],
  takje: ['count', 1],
  takjes: ['count', 1],
  leaf: ['count', 1],
  leaves: ['count', 1],
  handful: ['count', 1],
  handfuls: ['count', 1],
  handvol: ['count', 1],
  head: ['count', 1],
  heads: ['count', 1]
};

/**
 * Converts an amount + unit to a base unit of its dimension.
 * @param {number} amount
 * @param {string} [unit]
 * @returns {{amount: number, unit: 'weight'|'volume'|'count'}|null}
 */
export function normalizeQuantity(amount, unit = '') {
  const normalizedUnit = String(unit || '').toLowerCase().replace(/\./g, '').trim();
  const conversion = QUANTITY_UNITS[normalizedUnit];
  if (conversion) return { amount: amount * conversion[1], unit: conversion[0] };
  // Some sources write only a number, for example "2" next to "Eggs".
  if (!normalizedUnit && Number.isFinite(amount)) return { amount, unit: 'count' };
  return null;
}

/**
 * Reads the pack size of a product ("500 g", "2 x 150 g", "10 stuks").
 * @param {string} unitSize
 * @returns {{amount: number, unit: 'weight'|'volume'|'count'}|null}
 */
export function parsePackageSize(unitSize) {
  const raw = String(unitSize || '').trim();
  if (!raw) return null;
  // "per stuk" / "los" without a weight: one item.
  if (!/\d/.test(raw)) {
    return /\bstuks?\b|\bper\s+stuk\b|\blos\b/i.test(raw) ? { amount: 1, unit: 'count' } : null;
  }
  const multi = raw.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|dl|l)\b/i);
  if (multi) {
    const single = normalizeQuantity(Number(multi[2].replace(',', '.')), multi[3]);
    return single ? { amount: single.amount * Number(multi[1]), unit: single.unit } : null;
  }
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram|ml|cl|dl|l|liter|stuks?|stuk|pieces?|pcs?)\b/i);
  if (!match) return null;
  return normalizeQuantity(Number(match[1].replace(',', '.')), match[2]);
}

/**
 * Price per kilo, litre or piece, so packs can be compared. Falls back to AH's
 * own unit-price description when the pack size cannot be read.
 * @param {Object} product
 * @returns {{amount: number, unit: 'kg'|'l'|'stuk', regular: number}|null}
 */
export function unitPriceFor(product) {
  if (!product || !Number.isFinite(product.price) || product.price <= 0) return null;
  const regularPrice = Number.isFinite(product.regularPrice) && product.regularPrice > 0
    ? product.regularPrice
    : product.price;
  const packageSize = parsePackageSize(product.unitSize);
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
    // A single loose item: the piece price is the pack price, so show nothing.
    if (packageSize.unit === 'count') return null;
  }
  // "prijs per kg €3.31": AH puts the unit before the amount.
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
 * What the recipe's share of this product costs.
 * @param {Object} ingredient
 * @param {Object} product
 * @param {number} scale
 * @returns {{current: number, regular: number, quantityRatio: number}|null} null when the pack does not fit
 */
export function calculateQuantityCost(ingredient, product, scale) {
  if (!Number.isFinite(ingredient.amount) || ingredient.amount <= 0) return null;
  const ingredientQuantity = normalizeQuantity(ingredient.amount, ingredient.unit);
  const packageQuantity = parsePackageSize(product.unitSize);
  if (!ingredientQuantity || !packageQuantity) return null;

  let amountUsed = ingredientQuantity.amount * scale;
  if (packageQuantity.unit !== ingredientQuantity.unit) {
    const comparable = VOLUME_WEIGHT_EQUIVALENTS.has(`${ingredientQuantity.unit}>${packageQuantity.unit}`) ||
      VOLUME_WEIGHT_EQUIVALENTS.has(`${packageQuantity.unit}>${ingredientQuantity.unit}`);
    if (comparable) {
      // 1 ml = 1 g: a tablespoon of mustard against a pack in grams.
      amountUsed = ingredientQuantity.amount * scale;
    } else if (packageQuantity.unit === 'weight' && ingredientQuantity.unit === 'count') {
      // "4 tortillas" against a pack of 320 g.
      const gramsPerPiece = PIECE_WEIGHT_GRAMS[ingredientHeadword(ingredient.name)];
      if (!gramsPerPiece) return null;
      amountUsed = ingredientQuantity.amount * scale * gramsPerPiece;
    } else {
      return null;
    }
  }
  const quantityRatio = amountUsed / packageQuantity.amount;
  // A pack that is far too small (spice mix for a kilo of vegetables) is not a
  // sensible match; exclude it instead of inflating the price.
  if (quantityRatio > MAX_PACKS_PER_INGREDIENT) return null;
  if (product.price * quantityRatio > MAX_INGREDIENT_COST) return null;
  return {
    current: product.price * quantityRatio,
    regular: product.regularPrice * quantityRatio,
    quantityRatio
  };
}

/**
 * Rounds an amount to whole cents.
 * @param {number} amount
 * @returns {number}
 */
function toCents(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

/**
 * What a whole recipe costs from its chosen products.
 *
 * Pure and shared: the app prices a loaded recipe with it, and the pipeline
 * stores the same estimate in the catalogue so the grid can show and sort by
 * price before any recipe body is loaded.
 *
 * @param {Object} recipe
 * @param {number} [servings]
 * @returns {{totalPrice: number, pricePerPerson: number, totalStandardPrice: number,
 *   totalSavings: number, hasBonus: boolean, bonusCount: number, hasPriceData: boolean,
 *   hasAnyPriceData: boolean, matchedIngredientCount: number, ingredientCount: number,
 *   pricedIngredientCount: number, unmatchedIngredientCount: number,
 *   unpricedIngredientCount: number}}
 */
export function recipePriceEstimate(recipe, servings = 2) {
  const empty = {
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
  const ingredients = recipe?.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length === 0) return empty;

  const scale = servings / (recipe.baseServings || 2);
  let totalPrice = 0;
  let totalStandardPrice = 0;
  let bonusCount = 0;
  let allIngredientsPriced = true;
  let matchedIngredientCount = 0;
  let pricedIngredientCount = 0;

  ingredients.forEach(ingredient => {
    let actualPrice;
    let regularPrice;
    // Static dataset recipes are priced from the same product-shaped snapshot
    // as a live search, so they take the same branch.
    if (recipe.sourceUrl || recipe.livePriced || recipe.staticPriced) {
      const product = ingredient.selectedAHProduct;
      if (product) matchedIngredientCount++;
      const quantityCost = product && calculateQuantityCost(ingredient, product, scale);
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
      actualPrice = regularPrice * scale;
      regularPrice *= scale;
      matchedIngredientCount++;
    }

    totalPrice += actualPrice;
    totalStandardPrice += regularPrice;
    pricedIngredientCount++;
    if (regularPrice > actualPrice) bonusCount++;
  });

  totalPrice = toCents(totalPrice);
  totalStandardPrice = toCents(totalStandardPrice);
  return {
    totalPrice,
    pricePerPerson: servings > 0 ? toCents(totalPrice / servings) : 0,
    totalStandardPrice,
    totalSavings: toCents(Math.max(0, totalStandardPrice - totalPrice)),
    hasBonus: bonusCount > 0,
    bonusCount,
    hasPriceData: allIngredientsPriced,
    hasAnyPriceData: pricedIngredientCount > 0,
    matchedIngredientCount,
    ingredientCount: ingredients.length,
    pricedIngredientCount,
    unmatchedIngredientCount: ingredients.length - matchedIngredientCount,
    unpricedIngredientCount: ingredients.length - pricedIngredientCount
  };
}
