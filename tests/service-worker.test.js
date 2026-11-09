import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'sw.js'), 'utf8');

/**
 * Runs sw.js in a worker-like sandbox and returns the values under test.
 * @param {string} scope service worker scope URL
 * @returns {{staticCache: string, fontCache: string, isStaleCache: (key: string) => boolean}}
 */
function loadWorker(scope) {
  const self = {
    registration: { scope },
    location: new URL(scope),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: () => {}
  };
  const context = vm.createContext({
    self,
    caches: { keys: async () => [], open: async () => ({ addAll: async () => {}, put: async () => {} }), delete: async () => true, match: async () => undefined },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Response: class { constructor(body, init) { this.body = body; Object.assign(this, init); } },
    URL,
    Promise,
    console
  });
  vm.runInContext(
    `${source}\nglobalThis.__probe = { staticCache: STATIC_CACHE, fontCache: FONT_CACHE, isStaleCache };`,
    context
  );
  const probe = context.__probe;
  return { staticCache: probe.staticCache, fontCache: probe.fontCache, isStaleCache: probe.isStaleCache };
}

test('production and the preview use different cache names', () => {
  const production = loadWorker('https://kaasschaaf.github.io/MyFood/');
  const preview = loadWorker('https://kaasschaaf.github.io/MyFood/dev/');

  assert.match(production.staticCache, /^kost-static-v\d+@MyFood$/);
  assert.match(preview.staticCache, /^kost-static-v\d+@MyFood-dev$/);
  assert.notEqual(production.staticCache, preview.staticCache);
  assert.notEqual(production.fontCache, preview.fontCache);
});

test('a local server gets its own cache name too', () => {
  assert.match(loadWorker('http://localhost:3000/').staticCache, /^kost-static-v\d+@root$/);
  assert.match(loadWorker('http://localhost:4173/dev/').staticCache, /^kost-static-v\d+@dev$/);
});

test('the app only deletes its own old caches', () => {
  const production = loadWorker('https://kaasschaaf.github.io/MyFood/');
  assert.equal(production.isStaleCache(production.staticCache), false);
  assert.equal(production.isStaleCache(production.fontCache), false);
  // Older versions of itself.
  assert.equal(production.isStaleCache('kost-static-v5@MyFood'), true);
  // The preview's cache belongs to the preview.
  assert.equal(production.isStaleCache('kost-static-v6@MyFood-dev'), false);
  // Scope-less names from before the preview existed belong to the root app.
  assert.equal(production.isStaleCache('kost-static-v6'), true);
  assert.equal(production.isStaleCache('kost-fonts-v6'), true);
  assert.equal(production.isStaleCache('something-else'), false);
});

test('the preview never touches production storage', () => {
  const preview = loadWorker('https://kaasschaaf.github.io/MyFood/dev/');
  assert.equal(preview.isStaleCache(preview.staticCache), false);
  assert.equal(preview.isStaleCache(preview.fontCache), false);
  assert.equal(preview.isStaleCache('kost-static-v6@MyFood'), false);
  assert.equal(preview.isStaleCache('kost-static-v6'), false);
  assert.equal(preview.isStaleCache('kost-static-v5@MyFood-dev'), true);
});
