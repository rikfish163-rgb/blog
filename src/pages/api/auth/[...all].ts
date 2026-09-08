import type { APIRoute } from 'astro';

import { AUTH_CORE_CONFIGURED, auth } from '../../../auth';
import { ensureAuthSchema } from '../../../server/auth-schema';

export const prerender = false;

export const ALL: APIRoute = async (ctx) => {
  if (!AUTH_CORE_CONFIGURED) {
    return new Response('Authentication is not configured', { status: 503 });
  }
  await ensureAuthSchema();
  return auth.handler(ctx.request);
};
