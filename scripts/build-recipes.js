#!/usr/bin/env node
/**
 * Builds the static recipe dataset.
 *
 * Fetches candidate rows from the public mirror of the 2M recipe dataset,
 * curates them down to main-course dinners, canonicalises the ingredients,
 * translates titles and steps into English with a local model, and writes:
 *
 *   data/catalog.json      lean index for the recipe grid
 *   data/recipes/NNN.json  full recipes, 100 per shard
 *   data/meta.json         counts, sources and licence
 *
 * The nine hand-written recipes in data/recipes.json are always merged in and
 * keep their curated nutrition and AH product names.
 *
 * Usage:
 *   node build-recipes.js --limit 2000
 *   node build-recipes.js --limit 100 --dry-run
 *   node build-recipes.js --stage filter --limit 2000   (reuse fetched rows)
 */

import { resolve } from 'node:path';

import { createReport } from './lib/report.js';
import { countCandidates, fetchCandidates } from './lib/clickhouse.js';
import { cleanTitle, curateDinnerRecipes, dishTypeFor } from './lib/dinner.js';
import { describeRecipe } from './lib/describe.js';
import { translationStats, translateBatch } from './lib/translate.js';
import { DATA_DIR, SCRIPT_FILE, SHARD_SIZE, catalogEntry, metaBlock, recipeId, shardName, writeJson } from './lib/data.js';
import { canonicalIngredients } from '../js/ingredient-canonical.js';
import { toMetric } from '../js/measure.js';
import { estimateRecipeNutrition } from '../js/nutrition-estimator.js';
import { parseArgs, readJsonFile, writeStage } from './lib/cli.js';

const args = parseArgs({ limit: 2000, offset: 0, 'dry-run': false, stage: '', verbose: false });
const CURATED_PATH = resolve(DATA_DIR, 'recipes.json');
const STAGE_FETCH = resolve(SCRIPT_FILE(''), '.cache/stage-candidates.json');
const LIMIT = Number(args.limit) || 2000;

const report = createReport('build-recipes', {
  meta: { limit: String(LIMIT), offset: String(args.offset), dataset: 'clickhouse:recipes' }
});

/**
 * Canonicalises one ingredient line into the stored shape.
 * @param {string} line
 * @returns {Array<Object>}
 */
function toIngredients(line) {
  return canonicalIngredients(line)
    .filter(item => item.key && item.key.length > 1)
    .map(item => {
      // The dataset mixes cups, spoons, ounces and pounds with grams; store one
      // metric unit vocabulary so the app never has to convert on the fly.
      const metric = toMetric(item.amount, item.unit);
      return {
        name: item.nameNl || item.nameEn,
        nameEn: item.nameEn,
        key: item.key,
        amount: metric.amount,
        unit: metric.unit
      };
    });
}

/**
 * Dataset steps are sometimes whole blog paragraphs. Cut them at a sentence
 * boundary: the app shows a step, not an essay, and shorter input means
 * noticeably faster local translation.
 * @param {string} step
 * @param {number} [max]
 * @returns {string}
 */
function truncateStep(step, max = 400) {
  if (step.length <= max) return step;
  const cut = step.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return `${(end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim()}`;
}

/**
 * Converts one curated dataset row into the app's recipe shape.
 * @param {Object} row
 * @param {number} index
 * @returns {Object}
 */
function toRecipe(row, index) {
  const titleEn = cleanTitle(row.title);
  const ingredients = (row.ingredients || []).flatMap(toIngredients);
  const instructionsEn = (row.directions || [])
    .map(step => truncateStep(String(step).replace(/\s+/g, ' ').trim()))
    .filter(step => step.length > 3);
  const dishType = dishTypeFor(titleEn);
  const { description, descriptionEn } = describeRecipe({
    cuisine: 'Internationaal',
    mealType: 'Hoofdgerecht',
    ingredients
  });

  const recipe = {
    id: recipeId(titleEn),
    shard: shardName(index),
    // The dataset is English; `title`/`instructions` are filled with the Dutch
    // translation right after the batch runs.
    title: titleEn,
    titleEn,
    description,
    descriptionEn,
    cuisine: 'Internationaal',
    mealType: 'Hoofdgerecht',
    dishType,
    prepTimeMinutes: 0,
    difficulty: '',
    baseServings: 4,
    image: '',
    tags: ['diner', dishType],
    ingredients,
    instructions: instructionsEn,
    instructionsEn,
    source: 'dataset'
  };
  recipe.nutrition = estimateRecipeNutrition(recipe, recipe.baseServings);
  return recipe;
}

/**
 * The hand-written recipes, mapped onto the new shape.
 * @returns {Object[]}
 */
function loadCuratedRecipes() {
  return readJsonFile(CURATED_PATH, []).map(recipe => {
    const ingredients = (recipe.ingredients || []).map(ingredient => {
      const [item] = canonicalIngredients(`${ingredient.amount ?? ''} ${ingredient.unit ?? ''} ${ingredient.name}`);
      const metric = toMetric(ingredient.amount, ingredient.unit);
      return {
        ...ingredient,
        key: item?.key || '',
        nameEn: item?.nameEn || '',
        amount: metric.amount,
        unit: metric.unit
      };
    });
    const { descriptionEn } = describeRecipe({
      cuisine: recipe.cuisine,
      mealType: recipe.mealType,
      ingredients
    });
    return {
      ...recipe,
      shard: '',
      // A hand-written English title beats machine translation of the Dutch
      // one; the pipeline only fills this in when the recipe has none.
      titleEn: recipe.titleEn || '',
      descriptionEn,
      dishType: dishTypeFor(recipe.title),
      source: 'curated',
      ingredients,
      nutrition: recipe.nutrition || estimateRecipeNutrition(recipe, recipe.baseServings)
    };
  });
}

/**
 * Gives every ingredient a Dutch display name.
 *
 * The glossary already covers most names, but the dataset holds plenty of
 * English the glossary does not know ("dry orzo"). Only the display name is
 * translated: the key stays exactly as built, so products.json stays valid.
 * @param {Object[]} recipes
 */
async function translateIngredientNames(recipes) {
  const pending = new Map();
  recipes.forEach(recipe => (recipe.ingredients || []).forEach(ingredient => {
    if (ingredient.name !== ingredient.nameEn) return;
    if (!ingredient.nameEn || pending.has(ingredient.nameEn)) return;
    pending.set(ingredient.nameEn, '');
  }));
  if (!pending.size) return;

  const names = [...pending.keys()];
  const translated = await translateBatch(names, 'en>nl');
  const byName = new Map(names.map((name, index) => [name, translated[index]]));
  recipes.forEach(recipe => (recipe.ingredients || []).forEach(ingredient => {
    const value = byName.get(ingredient.nameEn);
    if (!value || value === ingredient.nameEn) return;
    if (ingredient.name !== ingredient.nameEn) return;
    ingredient.name = value;
  }));
}

/**
 * Fills in the other language for every recipe.
 *
 * Dataset rows arrive in English, so their Dutch title and steps are
 * translated en>nl. The hand-written recipes are Dutch and get an English
 * version nl>en. Either way both languages end up in the data, and the app
 * never has to translate a recipe at runtime.
 * @param {Object[]} recipes
 */
async function translateRecipes(recipes) {
  const fromEnglish = recipes.filter(recipe => recipe.source === 'dataset');
  const fromDutch = recipes.filter(recipe => recipe.source === 'curated');

  if (fromEnglish.length) {
    const titlesNl = await translateBatch(fromEnglish.map(recipe => recipe.titleEn || recipe.title), 'en>nl');
    fromEnglish.forEach((recipe, index) => {
      // The model occasionally appends junk ("Baked Kibbee.kgm"), so the
      // translated title is cleaned exactly like the source title.
      recipe.title = cleanTitle(titlesNl[index] || recipe.titleEn || recipe.title);
    });
    await translateIngredientNames(fromEnglish);
    // The description lists ingredient names, so rebuild it once those are
    // Dutch instead of English.
    fromEnglish.forEach(recipe => {
      recipe.description = describeRecipe({
        cuisine: recipe.cuisine,
        mealType: recipe.mealType,
        ingredients: recipe.ingredients
      }).description;
    });

    const steps = fromEnglish.flatMap(recipe => recipe.instructionsEn || []);
    if (steps.length) {
      const stepsNl = await translateBatch(steps, 'en>nl');
      let cursor = 0;
      fromEnglish.forEach(recipe => {
        const count = (recipe.instructionsEn || []).length;
        recipe.instructions = stepsNl.slice(cursor, cursor + count);
        cursor += count;
      });
    }
  }

  if (fromDutch.length) {
    const titlesEn = await translateBatch(fromDutch.map(recipe => recipe.title), 'nl>en');
    fromDutch.forEach((recipe, index) => {
      // A curated recipe may ship its own English title; only translate the
      // ones without.
      if (!recipe.titleEn) recipe.titleEn = titlesEn[index] || recipe.title;
    });
    const steps = fromDutch.flatMap(recipe => recipe.instructions || []);
    if (steps.length) {
      const stepsEn = await translateBatch(steps, 'nl>en');
      let cursor = 0;
      fromDutch.forEach(recipe => {
        const count = (recipe.instructions || []).length;
        recipe.instructionsEn = stepsEn.slice(cursor, cursor + count);
        cursor += count;
      });
    }
  }
}

/**
 * Writes one generated data file.
 * @param {string[]} parts
 * @param {Object|Array} value
 * @returns {string} path
 */
function writeData(parts, value) {
  const path = resolve(DATA_DIR, ...parts);
  writeJson(path, value);
  return path;
}

async function main() {
  const curated = loadCuratedRecipes();
  report.data('curated recipes', curated.length);

  let candidates;
  if (args.stage === 'filter' || args.stage === 'translate') {
    candidates = readJsonFile(STAGE_FETCH, []) || [];
    console.log(`  reusing ${candidates.length} staged candidate rows`);
  } else {
    const structural = await report.phase('count (clickhouse)', () => countCandidates());
    report.data('structure candidates', structural, structural.toLocaleString('en-US'));
    // Fetch well beyond the target: the funnel keeps a minority of rows.
    const fetchSize = Math.min(200000, Math.max(LIMIT * 8, 2000));
    candidates = await report.phase('fetch (clickhouse)', () => fetchCandidates({ limit: fetchSize, offset: Number(args.offset) }));
    report.data('fetched rows', candidates.length, candidates.length.toLocaleString('en-US'));
    writeStage(STAGE_FETCH, candidates);
  }

  const curatedResult = await report.phase('curate (dinner)', () => curateDinnerRecipes(candidates, { report, limit: LIMIT }));
  const built = curatedResult.recipes.map(toRecipe);

  const merged = [...curated, ...built];
  merged.forEach((recipe, index) => {
    recipe.shard = shardName(index);
  });

  await report.phase('translate (local)', () => translateRecipes(merged));

  const stats = translationStats();
  const total = stats.translated + stats.hits;
  report.data('translations', total,
    `${total.toLocaleString('en-US')} segments · ${stats.hits.toLocaleString('en-US')} cached · ${stats.translated.toLocaleString('en-US')} translated`);

  const ingredientKeys = new Set();
  merged.forEach(recipe => recipe.ingredients.forEach(ingredient => {
    if (ingredient.key) ingredientKeys.add(ingredient.key);
  }));

  report.data('recipes', merged.length);
  report.data('dataset recipes', built.length);
  report.data('ingredients', ingredientKeys.size, `${ingredientKeys.size.toLocaleString('en-US')} unique keys`);

  if (args['dry-run']) {
    report.data('mode', 'dry-run (nothing written)');
    await report.finish();
    return;
  }

  const shards = new Map();
  merged.forEach(recipe => {
    if (!shards.has(recipe.shard)) shards.set(recipe.shard, []);
    shards.get(recipe.shard).push(recipe);
  });

  await report.phase('write data', async () => {
    writeData(['catalog.json'], merged.map(catalogEntry));

    let shardBytes = 0;
    for (const [name, recipes] of shards) {
      shardBytes += Buffer.byteLength(`${JSON.stringify(recipes)}\n`);
      writeData(['recipes', name], recipes);
    }
    report.data('shards', shards.size, `${shards.size} files · ${(shardBytes / 1024 / 1024).toFixed(2)} MB`);

    writeData(['meta.json'], metaBlock({
      counts: {
        recipes: merged.length,
        curated: curated.length,
        dataset: built.length,
        ingredients: ingredientKeys.size,
        shards: shards.size,
        shardSize: SHARD_SIZE
      },
      build: {
        limit: LIMIT,
        offset: Number(args.offset),
        fetched: candidates.length,
        gates: curatedResult.gates
      }
    }));
  });

  report.size(resolve(DATA_DIR, 'catalog.json'));
  report.size(resolve(DATA_DIR, 'meta.json'));
  report.sizing({
    productsPerRecipe: ingredientKeys.size / Math.max(merged.length, 1),
    msPerPriceRequest: 800
  });
  await report.finish();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
