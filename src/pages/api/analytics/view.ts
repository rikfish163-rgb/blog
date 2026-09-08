import type { APIRoute } from 'astro';

import { isProductionEnvironment, isRobotUserAgent, normalizePathname, recordPageView } from '../../../server/analytics';

export const prerender = false;

const MAX_BODY_BYTES = 2_048;

function firstForwardedValue(request: Request, names: string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name);
    if (!value) continue;
    const first = value.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    origin !== new URL(request.url).origin ||
    fetchSite === 'cross-site' ||
    fetchSite === 'same-site'
  ) {
    return new Response('Cross-origin request rejected', { status: 403 });
  }
  if (!isProductionEnvironment()) return new Response(null, { status: 204 });

  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return new Response('JSON required', { status: 415 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 });

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }
    payload = JSON.parse(body) as unknown;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return new Response('Invalid payload', { status: 400 });
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'pathname') {
    return new Response('Only pathname is accepted', { status: 400 });
  }

  const pathname = normalizePathname((payload as { pathname?: unknown }).pathname);
  if (!pathname) return new Response('Invalid pathname', { status: 400 });

  const userAgent = request.headers.get('user-agent');
  if (isRobotUserAgent(userAgent)) return new Response(null, { status: 204 });

  const ip = clientAddress ?? firstForwardedValue(request, ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']);
  recordPageView({ pathname, ip, userAgent });
  return new Response(null, { status: 204 });
};
