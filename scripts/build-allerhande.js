#!/usr/bin/env node
/**
 * Adds the Allerhande link-only entries to the catalog.
 *
 * AH's recipe pages answer 403 to anything that is not a real browser session,
 * so the ingredients and steps cannot be fetched. What can be fetched is the
 * sitemap: every Allerhande recipe with its title. Those become compact cards
 * that link to ah.nl, and they are appended after the real recipes.
 *
 * Usage:
 *   node build-allerhande.js --limit 250
 */

import { resolve } from 'node:path';

import { createReport } from './lib/report.js';
import { translateBatch } from './lib/translate.js';
import { DATA_DIR, catalogEntry, writeJson } from './lib/data.js';
import { parseArgs, readJsonFile } from './lib/cli.js';

const SITEMAP = 'https://www.ah.nl/sitemaps/entities/allerhande/recipes.xml';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const RECIPE_URL = /^https:\/\/www\.ah\.nl\/allerhande\/recept\/R-R(\d+)\/([^/]+)$/;

const args = parseArgs({ limit: 250, 'dry-run': false });
const LIMIT = Number(args.limit) || 250;

const report = createReport('build-allerhande', { meta: { limit: String(LIMIT) } });

/**
 * Parses the sitemap into recipe links.
 * @param {string} xml
 * @returns {Array<{ id: string, slug: string, url: string, title: string }>}
 */
export function parseSitemap(xml) {
  const urls = [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].trim());
  return urls.flatMap(url => {
    const match = url.match(RECIPE_URL);
    if (!match) return [];
    let slug = match[2];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // Keep the raw slug when the sitemap holds malformed escaping.
    }
    const title = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return [{
      id: `ah-allerhande-${match[1]}`,
      slug,
      url,
      title: title.charAt(0).toLocaleUpperCase('nl-NL') + title.slice(1)
    }];
  });
}

async function main() {
  const response = await report.phase('fetch sitemap', () => fetch(SITEMAP, { headers: { 'User-Agent': USER_AGENT } }));
  if (!response.ok) throw new Error(`Allerhande-sitemap laden mislukt (${response.status}).`);
  const xml = await response.text();
  const links = parseSitemap(xml);
  report.data('sitemap links', links.length, links.length.toLocaleString('en-US'));

  const selected = links.slice(0, LIMIT);
  if (args['dry-run']) {
    report.data('selected', selected.length);
    report.data('mode', 'dry-run (nothing written)');
    await report.finish();
    return;
  }

  const titlesEn = await report.phase('translate titles', () => translateBatch(selected.map(link => link.title), 'nl>en'));

  const catalogPath = resolve(DATA_DIR, 'catalog.json');
  const catalog = readJsonFile(catalogPath, []);
  const existing = new Set(catalog.map(entry => entry.id));

  const entries = selected
    .filter(link => !existing.has(link.id))
    .map((link, index) => catalogEntry({
      id: link.id,
      shard: '',
      title: link.title,
      titleEn: titlesEn[index] || link.title,
      cuisine: 'Nederlands',
      mealType: 'Recept',
      dishType: 'allerhande',
      prepTimeMinutes: 0,
      baseServings: 2,
      difficulty: '',
      nutrition: null,
      tags: ['ah', 'allerhande', 'link'],
      image: '',
      ingredients: [],
      source: 'allerhande',
      sourceUrl: link.url
    }));
  // catalogEntry keeps the fields the grid needs; the link itself is added here.
  const linkById = new Map(selected.map(link => [link.id, link.url]));
  entries.forEach(entry => {
    entry.sourceUrl = linkById.get(entry.id) || '';
  });

  await report.phase('write catalog', async () => {
    writeJson(catalogPath, [...catalog, ...entries]);
  });

  report.data('allerhande entries', entries.length, `${entries.length.toLocaleString('en-US')} link-only cards`);
  report.data('catalog total', catalog.length + entries.length, (catalog.length + entries.length).toLocaleString('en-US'));
  report.size(catalogPath);
  await report.finish();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
