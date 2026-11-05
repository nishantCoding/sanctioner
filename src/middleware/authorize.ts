import { ConfigError } from '../errors';
import type { CheckOptions, AuthorizeOptions } from '../types';
import type { RequestHandler } from 'express';

export function createAuthZMiddleware(
  acl: { check: (options: CheckOptions) => boolean },
  options: AuthorizeOptions,
): RequestHandler {
  if (!options.role && !options.accesses) {
    throw new ConfigError('authorize() requires at least one of: role, accesses');
  }

  const denied = options.denied ?? ((_req, res) => res.status(403).json({ error: 'Forbidden' }));
  const basePath = options.basePath ?? '';

  return (req, res, next) => {
    const routePath = basePath + req.route.path;
    const role = options.role?.(req) ?? undefined;
    const accesses = options.accesses?.(req) ?? undefined;

    const allowed = acl.check({ method: req.method, path: routePath, role, accesses });
    allowed ? next() : denied(req, res);
  };
}
