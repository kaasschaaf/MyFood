/**
 * ClickHouse client for the public recipe dataset.
 *
 * The Kaggle "Recipe Dataset (over 2M)" is a 2.3 GB CSV behind a login, but the
 * same table is queryable without credentials on ClickHouse's public
 * playground (Kaggle links it as the original source). That makes the pipeline
 * reproducible in CI with no secrets: one HTTPS endpoint, JSONEachRow output.
 *
 * @see https://clickhouse.com/docs/en/getting-started/example-datasets/recipes
 */

const ENDPOINT = 'https://play.clickhouse.com/';
const USER = 'play';
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1500;

/**
 * Runs one SQL query and returns the parsed rows.
 * @param {string} sql
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<Object[]>}
 */
export async function query(sql, { signal, timeoutMs = 120000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set('user', USER);
      url.searchParams.set('default_format', 'JSONEachRow');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `${sql.trim().replace(/;$/, '')} FORMAT JSONEachRow`,
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`ClickHouse ${response.status}: ${body.slice(0, 300)}`);
      }
      const text = await response.text();
      return text
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const wait = BASE_BACKOFF_MS * attempt;
      console.warn(`  ClickHouse attempt ${attempt} failed (${error.message}); retrying in ${wait} ms`);
      await new Promise(resolve => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError;
}

/**
 * SQL fragment for the structural gate, kept in one place so the report and the
 * query cannot drift apart.
 * @returns {string}
 */
export function structureFilter() {
  return 'length(ingredients) BETWEEN 6 AND 14 AND length(directions) >= 3 AND length(title) < 90';
}

/**
 * Fetches candidate rows, newest-looking first is meaningless here so the
 * order is deterministic: by title, which keeps reruns comparable.
 * @param {{ limit: number, offset?: number, signal?: AbortSignal }} options
 * @returns {Promise<Array<{ title: string, ingredients: string[], directions: string[] }>>}
 */
export async function fetchCandidates({ limit, offset = 0, signal }) {
  const sql = `
    SELECT title, ingredients, directions
    FROM recipes
    WHERE ${structureFilter()}
    ORDER BY cityHash64(title)
    LIMIT ${Math.max(1, Math.floor(limit))}
    OFFSET ${Math.max(0, Math.floor(offset))}
  `;
  return query(sql, { signal });
}

/**
 * Counts how many rows the structural gate keeps, for the report header.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<number>}
 */
export async function countCandidates({ signal } = {}) {
  const rows = await query(`SELECT count() AS n FROM recipes WHERE ${structureFilter()}`, { signal });
  return Number(rows[0]?.n || 0);
}
