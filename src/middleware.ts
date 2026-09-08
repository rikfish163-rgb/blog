import { defineMiddleware } from 'astro:middleware';

import { AUTH_CORE_CONFIGURED, auth } from './auth';
import { ensureAuthSchema } from './server/auth-schema';

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered || !AUTH_CORE_CONFIGURED) {
    context.locals.user = null;
    context.locals.session = null;
    return next();
  }

  try {
    await ensureAuthSchema();
    const current = await auth.api.getSession({ headers: context.request.headers });
    context.locals.user = current?.user ?? null;
    context.locals.session = current?.session ?? null;
  } catch {
    // A public page must remain renderable when the auth store is unavailable.
    context.locals.user = null;
    context.locals.session = null;
  }

  return next();
});
