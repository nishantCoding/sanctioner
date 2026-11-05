import { ConfigError } from '../errors';
import type { CheckOptions } from '../types';
import type { Context, MiddlewareHandler } from 'hono';

export interface HonoAuthorizeOptions {
  role?: (c: Context) => string | null | undefined;
  accesses?: (c: Context) => string[] | null | undefined;
  denied?: (c: Context) => Response | Promise<Response>;
  basePath?: string;
}

export function createAuthZMiddleware(
  acl: { check: (options: CheckOptions) => boolean },
  options: HonoAuthorizeOptions,
): MiddlewareHandler {
  if (!options.role && !options.accesses) {
    throw new ConfigError('createAuthZMiddleware() requires at least one of: role, accesses');
  }

  const basePath = options.basePath ?? '';

  return async (c, next) => {
    const routePath = basePath + c.req.routePath;
    const role = options.role?.(c) ?? undefined;
    const accesses = options.accesses?.(c) ?? undefined;

    const allowed = acl.check({ method: c.req.method, path: routePath, role, accesses });
    if (allowed) {
      await next();
    } else if (options.denied) {
      return options.denied(c);
    } else {
      return c.json({ error: 'Forbidden' }, 403);
    }
  };
}
