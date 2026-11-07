const ALLOWED_ORIGINS = new Set([
  'https://kaasschaaf.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

const ALLOWED_ROUTES = [
  { method: 'POST', pattern: /^\/mobile-auth\/v1\/auth\/token\/anonymous$/ },
  { method: 'GET', pattern: /^\/mobile-services\/product\/search\/v2$/ },
  { method: 'GET', pattern: /^\/mobile-services\/product\/detail\/v4\/fir\/\d+$/ }
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, X-Application',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin'
  };
}

function errorResponse(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return new Response('Origin not allowed.', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const routeAllowed = ALLOWED_ROUTES.some(route =>
      route.method === request.method && route.pattern.test(url.pathname)
    );
    if (!routeAllowed) return errorResponse('Route not allowed.', 404, origin);

    const headers = new Headers();
    for (const name of ['Accept', 'Authorization', 'Content-Type', 'X-Application']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const upstreamUrl = new URL(`${url.pathname}${url.search}`, 'https://api.ah.nl');
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? request.body : undefined
    });
    const responseHeaders = new Headers(corsHeaders(origin));
    const contentType = upstreamResponse.headers.get('Content-Type');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders
    });
  }
};
