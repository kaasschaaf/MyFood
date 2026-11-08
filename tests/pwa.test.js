import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('manifest declares an installable standalone app', async () => {
  const manifest = JSON.parse(await read('manifest.json'));

  assert.equal(manifest.name.includes('Kost'), true);
  assert.equal(manifest.short_name, 'Kost');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));

  const icons = manifest.icons || [];
  for (const size of ['192x192', '512x512']) {
    assert.ok(
      icons.some(icon => icon.sizes === size && icon.type === 'image/png' && (icon.purpose || 'any').includes('any')),
      `manifest is missing a ${size} regular icon`
    );
    assert.ok(
      icons.some(icon => icon.sizes === size && (icon.purpose || '').includes('maskable')),
      `manifest is missing a ${size} maskable icon`
    );
  }
});

test('pages link the manifest, icons and service worker registration', async () => {
  for (const page of ['index.html', 'producten.html']) {
    const html = await read(page);
    assert.match(html, /<link rel="manifest" href="\.\/manifest\.json">/, `${page} has no manifest link`);
    assert.match(html, /<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png">/, `${page} has no apple touch icon`);
    assert.match(html, /<meta name="theme-color"/, `${page} has no theme-color`);
    assert.match(html, /src="\.\/js\/pwa\.js"/, `${page} does not register the service worker`);
  }
});

test('every precached service worker URL exists on disk', async () => {
  const sw = await read('sw.js');
  const precache = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(precache, 'PRECACHE_URLS is missing from sw.js');

  const urls = [...precache[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(urls.includes('./index.html'));
  assert.ok(urls.includes('./producten.html'));
  assert.ok(urls.includes('./manifest.json'));

  for (const url of urls) {
    await assert.doesNotReject(access(path.join(root, url)), `${url} is precached but does not exist`);
  }
});
