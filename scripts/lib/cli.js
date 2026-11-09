/**
 * Small CLI helpers shared by the pipeline scripts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Parses `--key value`, `--key=value` and `--flag` arguments.
 * @param {Record<string, string|number|boolean>} defaults
 * @param {string[]} [argv]
 * @returns {Record<string, string|number|boolean>}
 */
export function parseArgs(defaults = {}, argv = process.argv.slice(2)) {
  const values = { ...defaults };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      values[body.slice(0, equals)] = coerce(body.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[body] = coerce(next);
      index++;
    } else {
      values[body] = true;
    }
  }
  return values;
}

/**
 * Turns "false"/"true"/"123" into the value it looks like.
 * @param {string} value
 * @returns {string|number|boolean}
 */
function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Reads a JSON file, returning the fallback when it is missing or invalid.
 * @param {string} path
 * @param {*} fallback
 * @returns {*}
 */
export function readJsonFile(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Writes a JSON artifact used to resume a run (`--stage`).
 * @param {string} path
 * @param {*} value
 */
export function writeStage(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value)}\n`);
  } catch (error) {
    console.warn(`  stage could not be written (${error.message})`);
  }
}

/**
 * Whether a file exists.
 * @param {string} path
 * @returns {boolean}
 */
export function fileExists(path) {
  return existsSync(path);
}
