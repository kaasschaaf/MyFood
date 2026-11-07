import assert from 'node:assert/strict';
import { test } from 'node:test';
import proxy from './ah-api-proxy.js';

const origin = 'https://kaasschaaf.github.io';

test('proxies allowed AH product searches and returns CORS headers', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  let upstreamHeaders;
  globalThis.fetch = async (url, options) => {
    upstreamUrl = url;
    upstreamHeaders = options.headers;
    return new Response('{"products":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const response = await proxy.fetch(new Request(
      'https://myfood-ah-api-proxy.example.workers.dev/mobile-services/product/search/v2?query=griekse',
      {
        headers: {
          Origin: origin,
          Authorization: 'Bearer test-token',
          'x-application': 'AHWEBSHOP'
        }
      }
    ));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(new URL(upstreamUrl).host, 'api.ah.nl');
    assert.equal(new URL(upstreamUrl).searchParams.get('query'), 'griekse');
    assert.equal(upstreamHeaders.get('Authorization'), 'Bearer test-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects requests from origins outside the allowlist', async () => {
  const response = await proxy.fetch(new Request(
    'https://myfood-ah-api-proxy.example.workers.dev/mobile-services/product/search/v2',
    { headers: { Origin: 'https://untrusted.example' } }
  ));

  assert.equal(response.status, 403);
});

test('rejects routes that are not part of the AH API allowlist', async () => {
  const response = await proxy.fetch(new Request(
    'https://myfood-ah-api-proxy.example.workers.dev/anything',
    { headers: { Origin: origin } }
  ));

  assert.equal(response.status, 404);
});
