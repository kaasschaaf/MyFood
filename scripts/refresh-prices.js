#!/usr/bin/env node
/**
 * Weekly price refresh.
 *
 * Reads data/products.json, re-queries Albert Heijn for the *stored* product
 * queries only, and rewrites data/prices.json. Nothing else is touched, so the
 * job is small enough to run every Monday morning.
 *
 * Safety: if too many products have disappeared from AH, or the run is
 * interrupted, the existing prices.json is kept instead of being replaced by a
 * half-filled file.
 *
 * Usage:
 *   node refresh-prices.js                (all keys)
 *   node refresh-prices.js --limit 25     (smoke test)
 *   node refresh-prices.js --dry-run
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createReport } from './lib/report.js';
import { ahStats, searchProducts } from './lib/ah.js';
import { DATA_DIR, writeJson } from './lib/data.js';
import { parseArgs, readJsonFile } from './lib/cli.js';
import { writeCatalogMetrics } from './lib/recipe-price.js';
import { normalizeProduct } from '../js/ah-product.js';

const MAX_MISSING_RATIO = 0.2;
const args = parseArgs({ limit: 0, 'dry-run': false, concurrency: 3, 'min-coverage': 0.8 });
const MIN_COVERAGE = Number(args['min-coverage']) || 0.8;

const report = createReport('refresh-prices', { meta: { limit: String(args.limit || 'all') } });

/**
 * Reads the stored price snapshot.
 * @returns {{ generatedAt: string, version: number, prices: Record<string, Object> }}
 */
function loadPrices() {
  try {
    return JSON.parse(readFileSync(resolve(DATA_DIR, 'prices.json'), 'utf8'));
  } catch {
    return { generatedAt: '', version: 1, prices: {} };
  }
}

/**
 * Runs tasks with limited concurrency.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} callback
 * @returns {Promise<Array>}
 */
async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await callback(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Median of a numeric list.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Loads every recipe from the shards named in the catalogue.
 * @returns {Object[]}
 */
function loadRecipes() {
  const catalog = readJsonFile(resolve(DATA_DIR, 'catalog.json'), []);
  const shards = [...new Set(catalog.map(entry => entry.shard).filter(Boolean))];
  return shards.flatMap(shard => readJsonFile(resolve(DATA_DIR, 'recipes', shard), []) || []);
}

async function main() {
  const products = readJsonFile(resolve(DATA_DIR, 'products.json'), null);
  if (!products?.keys) {
    throw new Error('data/products.json ontbreekt. Draai eerst scripts/build-products.js.');
  }
  const previous = loadPrices();
  const entries = Object.values(products.keys);
  report.data('ingredient keys', entries.length, `${entries.length.toLocaleString('en-US')} keys`);
  report.data('products in snapshot', Object.keys(previous.prices || {}).length,
    `${Object.keys(previous.prices || {}).length.toLocaleString('en-US')} priced products`);

  const targets = Number(args.limit) > 0 ? entries.slice(0, Number(args.limit)) : entries;
  if (args['dry-run']) {
    report.data('mode', 'dry-run (nothing written)');
    await report.finish();
    return;
  }

  let processed = 0;
  const lookups = await report.phase('ah lookups', () => mapWithConcurrency(targets, Number(args.concurrency) || 3, async entry => {
    try {
      const raw = await searchProducts(entry.queryNl || entry.key);
      return { entry, products: raw.map(normalizeProduct).filter(Boolean) };
    } catch (error) {
      console.warn(`  search failed for "${entry.key}": ${error.message}`);
      return { entry, products: [], error: error.message };
    } finally {
      processed++;
      if (processed % 100 === 0) console.log(`  ${processed}/${targets.length} keys`);
    }
  }));

  const prices = { ...(previous.prices || {}) };
  let updated = 0;
  let missing = 0;
  let bonusChanges = 0;
  const deltas = [];

  lookups.forEach(({ entry, products: found }) => {
    if (!found?.length) {
      missing++;
      return;
    }
    const byId = new Map(found.map(product => [product.id, product]));
    let matchedAny = false;
    (entry.options || []).forEach(option => {
      const product = byId.get(option.productId);
      if (!product) return;
      matchedAny = true;
      const before = prices[product.id];
      if (before) {
        if (Boolean(before.isBonus) !== product.isBonus) bonusChanges++;
        const delta = product.price - Number(before.price || 0);
        if (Number.isFinite(delta)) deltas.push(delta);
      }
      prices[product.id] = {
        price: product.price,
        regularPrice: product.regularPrice,
        isBonus: product.isBonus,
        bonusDescription: product.bonusDescription,
        unitSize: product.unitSize,
        availableOnline: product.availableOnline,
        isOnlineOnly: product.isOnlineOnly,
        updatedAt: new Date().toISOString()
      };
      option.unitSize = product.unitSize || option.unitSize;
      updated++;
    });
    if (!matchedAny) missing++;
  });

  const storedProducts = Object.keys(previous.prices || {}).length;
  const coverage = storedProducts ? (updated / Math.max(storedProducts, 1)) : 1;
  const missingRatio = targets.length ? missing / targets.length : 0;

  report.data('updated products', updated, `${updated.toLocaleString('en-US')} products`);
  report.data('keys without match', missing, `${missing.toLocaleString('en-US')} / ${targets.length.toLocaleString('en-US')} (${(missingRatio * 100).toFixed(1)}%)`);
  report.data('bonus changes', bonusChanges);
  if (deltas.length) {
    const sorted = [...deltas].sort((a, b) => a - b);
    report.data('price delta', median(deltas), `min ${sorted[0].toFixed(2)} · median ${median(deltas).toFixed(2)} · max ${sorted.at(-1).toFixed(2)}`);
  }

  const stats = ahStats();
  report.data('ah requests', stats.requests, `${stats.requests.toLocaleString('en-US')} requests · ${stats.failures} failed`);

  const tooManyMissing = missingRatio > MAX_MISSING_RATIO;
  const tooLowCoverage = storedProducts > 0 && coverage < MIN_COVERAGE;
  if (tooManyMissing || tooLowCoverage) {
    report.data('result', 'aborted');
    report.data('reason', tooManyMissing
      ? `${(missingRatio * 100).toFixed(1)}% of keys had no match (limit ${(MAX_MISSING_RATIO * 100).toFixed(0)}%)`
      : `only ${(coverage * 100).toFixed(1)}% of stored products came back (limit ${(MIN_COVERAGE * 100).toFixed(0)}%)`);
    await report.finish();
    console.error('Prijzen niet bijgewerkt: te veel producten ontbreken.');
    process.exitCode = 1;
    return;
  }

  await report.phase('write data', async () => {
    writeJson(resolve(DATA_DIR, 'prices.json'), {
      generatedAt: new Date().toISOString(),
      version: 1,
      prices
    });
  });

  // The grid shows and sorts by the price stored in the catalogue, so it has to
  // follow the snapshot or it would keep advertising last week's totals.
  const catalogStats = await report.phase('price catalogue', () =>
    writeCatalogMetrics(loadRecipes(), products, { prices }));
  report.data('catalogue prices', catalogStats.priced,
    `${catalogStats.priced.toLocaleString('en-US')} of ${catalogStats.total.toLocaleString('en-US')} recipes priced`);

  report.data('coverage', coverage, `${(coverage * 100).toFixed(1)}% of stored products`);
  report.size(resolve(DATA_DIR, 'prices.json'));
  await report.finish();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
