// Same-origin bridge to the private Node API service. Browser cookies, Origin,
// CSRF and idempotency headers reach the existing server unchanged.
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUEST_HEADERS = [
  'accept', 'content-type', 'cookie', 'origin', 'x-csrf-token', 'idempotency-key',
];
const RESPONSE_HEADERS = [
  'content-type', 'cache-control', 'set-cookie', 'content-disposition',
  'x-content-type-options',
  'retry-after', 'x-request-id',
];

async function forward(request: Request): Promise<Response> {
  const requestId = `req_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const unavailable = (message: string) => Response.json(
    { error: { code: 'SERVICE_UNAVAILABLE', message }, meta: { requestId } },
    { status: 503, headers: { 'cache-control': 'private, no-store', 'x-request-id': requestId } },
  );
  try {
  const requestUrl = new URL(request.url);
  const base = process.env.API_INTERNAL_URL || 'http://127.0.0.1:18080';
  const destination = new URL(requestUrl.pathname + requestUrl.search, base);
  if (!['http:', 'https:'].includes(destination.protocol)) {
    return unavailable('API не настроен');
  }
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Only enable this header behind an ingress that overwrites it and prevents
  // direct client access. Never forward browser-supplied signing headers.
  const ipHeader = process.env.BRIDGE_CLIENT_IP_HEADER;
  const proxySecret = process.env.API_PROXY_SECRET;
  const clientIp = ipHeader ? request.headers.get(ipHeader)?.trim() : undefined;
  if (proxySecret && clientIp && isIP(clientIp)) {
    headers.set('x-abai-client-ip', clientIp);
    headers.set('x-abai-proxy-key', proxySecret);
  }
    const upstream = await fetch(destination, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      duplex: 'half',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(
        requestUrl.pathname === '/api/v1/assistant/chat' ? 60_000 : 15_000,
      )]),
    } as RequestInit & { duplex: 'half' });
    const responseHeaders = new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    return new Response(upstream.status === 204 ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return unavailable('API временно недоступен');
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
