/**
 * Run report for the data pipeline.
 *
 * Every pipeline script wants the same thing: how long each phase took, how
 * many rows each filter kept or dropped, how big the output is, and how fast
 * that was. This prints one aligned block at the end of a run so the dataset
 * size can be chosen from measurements instead of guesses.
 *
 * Usage:
 *   const report = createReport('build-recipes');
 *   await report.phase('fetch', () => fetchCandidates());
 *   report.count('gate.structure', kept, dropped);
 *   report.data('recipes', 2000);
 *   report.size('data/catalog.json');
 *   await report.finish();
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORT_DIR = resolve(dirname(dirname(fileURLToPath(import.meta.url))), '.reports');

/**
 * Formats milliseconds as `1m05s` / `12.3s`.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  if (totalMs < 1000) return `${totalMs}ms`;
  const seconds = totalMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m${String(remainder).padStart(2, '0')}s`;
}

/**
 * Formats a byte count as KB/MB.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats a count with thousands separators.
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/**
 * Pads a row for the aligned block.
 * @param {string[]} cells
 * @param {number[]} widths
 * @returns {string}
 */
function row(cells, widths) {
  return cells
    .map((cell, index) => String(cell).padEnd(widths[index] ?? 0))
    .join('  ')
    .trimEnd();
}

/**
 * Builds a markdown table from the same data, for the GitHub step summary.
 * @param {Object} report
 * @returns {string}
 */
export function toMarkdown(report) {
  const lines = [`### ${report.name}`];
  const meta = Object.entries(report.meta || {})
    .map(([key, value]) => `${key}=\`${value}\``)
    .join(' · ');
  if (meta) lines.push('', meta);
  lines.push('', `Total: **${formatDuration(report.totalMs)}**`);

  if (report.phases.length) {
    lines.push('', '| Phase | Time | Share |', '| --- | --- | --- |');
    for (const phase of report.phases) {
      lines.push(`| ${phase.name} | ${formatDuration(phase.ms)} | ${phase.share.toFixed(1)}% |`);
    }
  }

  if (report.counters.length) {
    lines.push('', '| Gate | In | Out | Dropped |', '| --- | --- | --- | --- |');
    for (const counter of report.counters) {
      lines.push(`| ${counter.name} | ${formatCount(counter.in)} | ${formatCount(counter.out)} | ${formatCount(counter.dropped)} |`);
    }
  }

  if (report.dataPoints.length) {
    lines.push('', '| Metric | Value |', '| --- | --- |');
    for (const point of report.dataPoints) {
      lines.push(`| ${point.name} | ${point.display ?? formatCount(point.value)} |`);
    }
  }

  if (report.files?.length) {
    lines.push('', '| File | Size |', '| --- | --- |');
    for (const file of report.files) {
      lines.push(`| ${file.path} | ${formatBytes(file.bytes)} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Extrapolates build time and data size for other recipe counts.
 * @param {{ recipes: number, ms: number, bytes: number, productsPerRecipe?: number, msPerPriceRequest?: number }} input
 * @param {number[]} [sizes]
 * @returns {Array<{ recipes: number, ms: number, bytes: number, products: number, priceMs: number }>}
 */
export function estimateSizes(input, sizes = [500, 2000, 5000, 10000]) {
  const recipes = Math.max(1, input.recipes || 1);
  const msPerRecipe = (input.ms || 0) / recipes;
  const bytesPerRecipe = (input.bytes || 0) / recipes;
  const productsPerRecipe = input.productsPerRecipe || 0;
  const msPerPriceRequest = input.msPerPriceRequest || 0;
  return sizes.map(size => {
    const products = Math.round(size * productsPerRecipe);
    return {
      recipes: size,
      ms: msPerRecipe * size,
      bytes: bytesPerRecipe * size,
      products,
      priceMs: products * msPerPriceRequest
    };
  });
}

/**
 * Creates a report instance.
 * @param {string} name
 * @param {{ meta?: Record<string, string>, writeFile?: boolean, log?: (line: string) => void }} [options]
 */
export function createReport(name, options = {}) {
  const log = options.log || (line => console.log(line));
  const writeFile = options.writeFile !== false;
  const startedAt = process.hrtime.bigint();
  const phases = [];
  const counters = [];
  const dataPoints = [];
  const files = [];
  let estimateInput = null;

  const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;

  return {
    name,
    meta: options.meta || {},
    phases,
    counters,
    dataPoints,

    /**
     * Times an async phase and records it.
     * @template T
     * @param {string} phaseName
     * @param {() => Promise<T>} callback
     * @returns {Promise<T>}
     */
    async phase(phaseName, callback) {
      const phaseStart = process.hrtime.bigint();
      try {
        return await callback();
      } finally {
        const ms = Number(process.hrtime.bigint() - phaseStart) / 1e6;
        phases.push({ name: phaseName, ms, share: 0 });
        log(`  ${phaseName.padEnd(24)} ${formatDuration(ms)}`);
      }
    },

    /**
     * Records a filter gate: how many rows went in and how many survived.
     * @param {string} counterName
     * @param {number} kept
     * @param {number} [dropped]
     */
    count(counterName, kept, dropped) {
      const out = Number(kept) || 0;
      const removed = Number.isFinite(dropped) ? Number(dropped) : 0;
      counters.push({ name: counterName, in: out + removed, out, dropped: removed });
    },

    /**
     * Records a plain metric.
     * @param {string} dataName
     * @param {number|string} value
     * @param {string} [display]
     */
    data(dataName, value, display) {
      dataPoints.push({ name: dataName, value, display });
    },

    /**
     * Records the size of a written file.
     * @param {string} path
     */
    size(path) {
      let bytes = 0;
      try {
        bytes = statSync(path).size;
      } catch {
        bytes = 0;
      }
      files.push({ path, bytes });
      return bytes;
    },

    /**
     * Makes `finish()` include a sizing table extrapolated from this run.
     * @param {{ productsPerRecipe?: number, msPerPriceRequest?: number }} input
     */
    sizing(input) {
      estimateInput = input;
    },

    /**
     * Prints the summary block, writes the JSON artifact and returns the report.
     * @returns {Promise<Object>}
     */
    async finish() {
      const totalMs = elapsedMs();
      phases.forEach(phase => {
        phase.share = totalMs > 0 ? (phase.ms / totalMs) * 100 : 0;
      });

      const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
      const recipes = Number(dataPoints.find(point => point.name === 'recipes')?.value || 0);

      log('');
      log(`${name}${recipes ? ` · ${formatCount(recipes)} recipes` : ''} · ${formatDuration(totalMs)}`);
      log('-'.repeat(66));

      if (phases.length) {
        const widths = [22, 10, 8];
        log(row(['phase', 'time', 'share'], widths));
        for (const phase of phases) {
          log(row([phase.name, formatDuration(phase.ms), `${phase.share.toFixed(1)}%`], widths));
        }
        log('-'.repeat(66));
      }

      if (counters.length) {
        const widths = [24, 12, 12, 12];
        log(row(['gate', 'in', 'out', 'dropped'], widths));
        for (const counter of counters) {
          log(row([counter.name, formatCount(counter.in), formatCount(counter.out), formatCount(counter.dropped)], widths));
        }
        log('-'.repeat(66));
      }

      if (dataPoints.length) {
        const width = Math.max(...dataPoints.map(point => point.name.length), 12);
        for (const point of dataPoints) {
          log(row([point.name, point.display ?? formatCount(point.value)], [width, 28]));
        }
        log('-'.repeat(66));
      }

      if (files.length) {
        for (const file of files) {
          log(row([file.path, formatBytes(file.bytes)], [40, 12]));
        }
        log('-'.repeat(66));
      }

      if (recipes > 0) {
        const throughput = (recipes / (totalMs / 1000)).toFixed(1);
        log(`throughput      ${throughput} recipes/s${totalBytes ? ` · ${formatBytes(totalBytes)} total` : ''}`);
      }

      if (estimateInput && recipes > 0) {
        log('');
        log('size estimate (measured rates)');
        const widths = [10, 14, 16, 12, 18];
        log(row(['recipes', 'build time', 'recipes data', 'products', 'weekly price job'], widths));
        for (const estimate of estimateSizes({
          recipes,
          ms: totalMs,
          bytes: totalBytes,
          productsPerRecipe: estimateInput.productsPerRecipe || 0,
          msPerPriceRequest: estimateInput.msPerPriceRequest || 0
        })) {
          log(row([
            formatCount(estimate.recipes),
            formatDuration(estimate.ms),
            formatBytes(estimate.bytes),
            formatCount(estimate.products),
            estimate.priceMs ? formatDuration(estimate.priceMs) : '-'
          ], widths));
        }
      }

      const result = {
        name,
        finishedAt: new Date().toISOString(),
        totalMs,
        meta: options.meta || {},
        phases,
        counters,
        dataPoints,
        files: files.map(file => ({ path: file.path, bytes: file.bytes }))
      };

      if (writeFile) {
        try {
          const path = join(REPORT_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
          log(`report          ${path}`);
        } catch (error) {
          log(`report          could not be written (${error.message})`);
        }
      }

      // GitHub Actions picks this up when the env var exists.
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (summaryPath) {
        try {
          writeFileSync(summaryPath, toMarkdown(result), { flag: 'a' });
        } catch (error) {
          log(`summary         could not be written (${error.message})`);
        }
      }

      return result;
    }
  };
}
