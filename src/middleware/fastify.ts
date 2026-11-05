import { ConfigError } from '../errors';
import type { CheckOptions } from '../types';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface FastifyAuthorizeOptions {
  role?: (req: FastifyRequest) => string | null | undefined;
  accesses?: (req: FastifyRequest) => string[] | null | undefined;
  denied?: (req: FastifyRequest, reply: FastifyReply) => void;
  basePath?: string;
}

export function createAuthZHook(
  acl: { check: (options: CheckOptions) => boolean },
  options: FastifyAuthorizeOptions,
): (req: FastifyRequest, reply: FastifyReply) => void {
  if (!options.role && !options.accesses) {
    throw new ConfigError('createAuthZHook() requires at least one of: role, accesses');
  }

  const denied = options.denied ?? ((_req, reply) => reply.code(403).send({ error: 'Forbidden' }));
  const basePath = options.basePath ?? '';

  return (req, reply) => {
    const routePath = basePath + (req.routeOptions.url ?? '');
    const role = options.role?.(req) ?? undefined;
    const accesses = options.accesses?.(req) ?? undefined;

    const allowed = acl.check({ method: req.method, path: routePath, role, accesses });
    if (!allowed) denied(req, reply);
  };
}
