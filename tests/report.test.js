import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createReport,
  estimateSizes,
  formatBytes,
  formatCount,
  formatDuration,
  toMarkdown
} from '../scripts/lib/report.js';

test('durations are readable at every scale', () => {
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(950), '950ms');
  assert.equal(formatDuration(12300), '12.3s');
  assert.equal(formatDuration(65000), '1m05s');
  assert.equal(formatDuration(600000), '10m00s');
});

test('bytes and counts are formatted for the report', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatCount(1234567), '1,234,567');
});

test('a report records phases, gates and metrics and prints them once', async () => {
  const lines = [];
  const report = createReport('unit-test', { log: line => lines.push(line), writeFile: false });

  const value = await report.phase('fetch', async () => 42);
  assert.equal(value, 42);

  report.count('gate.structure', 700, 300);
  report.data('recipes', 2000);
  report.sizing({ productsPerRecipe: 1.05, msPerPriceRequest: 800 });

  const result = await report.finish();

  assert.equal(result.name, 'unit-test');
  assert.equal(result.phases.length, 1);
  assert.equal(result.phases[0].name, 'fetch');
  assert.equal(result.counters[0].in, 1000, 'gate input is kept + dropped');
  assert.equal(result.counters[0].out, 700);
  assert.equal(result.counters[0].dropped, 300);
  assert.ok(result.dataPoints.some(point => point.name === 'recipes' && point.value === 2000));

  const output = lines.join('\n');
  assert.match(output, /unit-test · 2,000 recipes/);
  assert.match(output, /phase\s+time\s+share/);
  assert.match(output, /gate\s+in\s+out\s+dropped/);
  assert.match(output, /1,000\s+700\s+300/);
  assert.match(output, /size estimate/);
  assert.match(output, /weekly price job/);
});

test('the sizing table extrapolates from measured rates', () => {
  const estimates = estimateSizes(
    { recipes: 100, ms: 60000, bytes: 250 * 1024, productsPerRecipe: 1.1, msPerPriceRequest: 800 },
    [100, 1000]
  );
  assert.equal(estimates.length, 2);
  // 100 recipes took 60s, so 1000 recipes is 10 minutes.
  assert.equal(Math.round(estimates[1].ms / 1000), 600);
  assert.equal(Math.round(estimates[1].bytes / 1024), 2500);
  assert.equal(estimates[1].products, 1100);
  // 1100 products x 800 ms = 880 s.
  assert.equal(Math.round(estimates[1].priceMs / 1000), 880);
});

test('the markdown summary mirrors the printed numbers', async () => {
  const report = createReport('md-test', { log: () => {}, writeFile: false });
  await report.phase('normalise', async () => {});
  report.count('gate.dessert', 80, 20);
  report.data('recipes', 80);
  const result = await report.finish();

  const markdown = toMarkdown(result);
  assert.match(markdown, /### md-test/);
  assert.match(markdown, /\| Phase \| Time \| Share \|/);
  assert.match(markdown, /\| normalise \|/);
  assert.match(markdown, /\| gate.dessert \| 100 \| 80 \| 20 \|/);
  assert.match(markdown, /\| recipes \| 80 \|/);
});

test('a phase records its time even when it throws', async () => {
  const report = createReport('throw-test', { log: () => {}, writeFile: false });
  await assert.rejects(report.phase('boom', async () => {
    throw new Error('nope');
  }), /nope/);
  const result = await report.finish();
  assert.equal(result.phases.length, 1);
  assert.equal(result.phases[0].name, 'boom');
});
