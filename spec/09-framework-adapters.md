# Spec 09: Framework Adapters (Fastify & Hono)

Middleware wrappers for Fastify and Hono, following the same pattern as the Express adapter. Each framework gets its own entry point (`aclite/fastify`, `aclite/hono`) and its own options type with framework-native request/response types.

---

## Pattern

Every framework adapter follows the same structure:

1. **Options interface** — extractors typed to the framework's request/response
2. **Middleware factory** — takes `acl` (only needs `check()`) + options, returns framework-native middleware
3. **Entry point file** — `src/<framework>.ts` re-exports factory + options type
4. **`package.json`** — `exports` entry + optional peer dependency

The core logic is identical across frameworks: extract route path + identity from request → call `acl.check()` → allow or deny.

---

## File: `src/middleware/fastify.ts`

### Types

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';

interface FastifyAuthorizeOptions {
  role?: (req: FastifyRequest) => string | null | undefined;
  accesses?: (req: FastifyRequest) => string[] | null | undefined;
  denied?: (req: FastifyRequest, reply: FastifyReply) => void;
  basePath?: string;
}
```

### Function: `createAuthZHook`

```typescript
function createAuthZHook(
  acl: { check: (options: CheckOptions) => boolean },
  options: FastifyAuthorizeOptions,
): (req: FastifyRequest, reply: FastifyReply) => void;
```

Returns a Fastify `onRequest` or `preHandler` hook function.

#### Logic

```
1. routePath = (basePath ?? '') + req.routeOptions.url
2. role = options.role?.(req) ?? undefined
3. accesses = options.accesses?.(req) ?? undefined
4. allowed = acl.check({ method: req.method, path: routePath, role, accesses })
5. allowed → return (hook completes, Fastify proceeds)
   denied  → options.denied(req, reply) or default: reply.code(403).send({ error: 'Forbidden' })
```

**Route path:** Fastify provides the route pattern (e.g., `/users/:id`) via `req.routeOptions.url` (Fastify v4+). This is equivalent to Express's `req.route.path`.

**Default denied:**
```typescript
(req, reply) => reply.code(403).send({ error: 'Forbidden' })
```

#### Validation

Throws `ConfigError` at setup time if neither `role` nor `accesses` extractor is provided.

---

## File: `src/middleware/hono.ts`

### Types

```typescript
import type { Context, Next, MiddlewareHandler } from 'hono';

interface HonoAuthorizeOptions {
  role?: (c: Context) => string | null | undefined;
  accesses?: (c: Context) => string[] | null | undefined;
  denied?: (c: Context) => Response | Promise<Response>;
  basePath?: string;
}
```

### Function: `createAuthZMiddleware`

```typescript
function createAuthZMiddleware(
  acl: { check: (options: CheckOptions) => boolean },
  options: HonoAuthorizeOptions,
): MiddlewareHandler;
```

Returns a Hono middleware function `(c, next) => Promise<void | Response>`.

#### Logic

```
1. routePath = (basePath ?? '') + c.req.routePath
2. role = options.role?.(c) ?? undefined
3. accesses = options.accesses?.(c) ?? undefined
4. allowed = acl.check({ method: c.req.method, path: routePath, role, accesses })
5. allowed → await next()
   denied  → options.denied(c) or default: c.json({ error: 'Forbidden' }, 403)
```

**Route path:** Hono provides the route pattern via `c.req.routePath` (e.g., `/users/:id`).

**Default denied:**
```typescript
(c) => c.json({ error: 'Forbidden' }, 403)
```

#### Validation

Throws `ConfigError` at setup time if neither `role` nor `accesses` extractor is provided.

---

## Entry Point Files

### `src/fastify.ts`

```typescript
export { createAuthZHook } from './middleware/fastify';
export type { FastifyAuthorizeOptions } from './middleware/fastify';
```

### `src/hono.ts`

```typescript
export { createAuthZMiddleware } from './middleware/hono';
export type { HonoAuthorizeOptions } from './middleware/hono';
```

---

## Package Changes

### `package.json` — exports

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./express": { "types": "./dist/express.d.ts", "default": "./dist/express.js" },
    "./fastify": { "types": "./dist/fastify.d.ts", "default": "./dist/fastify.js" },
    "./hono": { "types": "./dist/hono.d.ts", "default": "./dist/hono.js" }
  }
}
```

### `package.json` — peer dependencies

```json
{
  "peerDependencies": {
    "express": ">=4.0.0",
    "fastify": ">=4.0.0",
    "hono": ">=3.0.0",
    "ioredis": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "express": { "optional": true },
    "fastify": { "optional": true },
    "hono": { "optional": true },
    "ioredis": { "optional": true }
  }
}
```

All framework dependencies are optional. Consumer only installs what they use.

---

## Type Approach

Each framework adapter defines its own options interface using `import type` from the framework package. Since framework packages are optional peer dependencies, the types only resolve when the consumer has the framework installed and imports from `aclite/<framework>`.

For development/compilation, framework packages are added as devDependencies.

---

## Consumer Usage

### Fastify

```typescript
import { ACLite } from 'aclite';
import { createAuthZHook } from 'aclite/fastify';

const acl = new ACLite();
await acl.access('viewUsers', ['GET /users']);
await acl.role('staff', ['viewUsers']);

fastify.addHook('preHandler', createAuthZHook(acl, {
  role: (req) => req.headers['x-role'] as string,
}));
```

### Hono

```typescript
import { ACLite } from 'aclite';
import { createAuthZMiddleware } from 'aclite/hono';

const acl = new ACLite();
await acl.access('viewUsers', ['GET /users']);
await acl.role('staff', ['viewUsers']);

app.use('*', createAuthZMiddleware(acl, {
  role: (c) => c.get('role'),
}));
```

---

## Checklist

- [ ] `src/middleware/fastify.ts` — factory + options type
- [ ] `src/middleware/hono.ts` — factory + options type
- [ ] `src/fastify.ts` — entry point re-exports
- [ ] `src/hono.ts` — entry point re-exports
- [ ] `package.json` — exports entries for `./fastify` and `./hono`
- [ ] `package.json` — fastify and hono as optional peer deps
- [ ] devDependencies — fastify and hono added for type checking
- [ ] `AuthorizeOptions` stays Express-specific (no changes to existing types)
- [ ] Each factory throws `ConfigError` if no extractor provided
- [ ] All framework types imported via `import type` (type-only, no runtime dep)
