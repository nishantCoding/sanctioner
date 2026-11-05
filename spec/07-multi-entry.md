# Spec 07: Multi-Entry Package Structure

Restructure the package to expose separate entry points for core and framework-specific code. Consumers import only what they need — no unnecessary framework dependencies.

---

## Problem

Currently `ACLite.authorize()` lives on the class and imports Express types. A Fastify or Hono user installing `aclite` would pull in Express as a peer dependency even though they don't use it.

---

## Solution

Use the `exports` field in `package.json` to provide multiple entry points from a single package.

### Consumer usage

```typescript
// Core — zero framework dependency
import { ACLite, MemoryAdapter, RedisAdapter } from 'aclite';

// Express — only if using Express
import { createAuthZMiddleware } from 'aclite/express';
```

### Adding future frameworks

The `exports` pattern scales to any framework. To add Fastify/Hono/Koa support later:

1. Create `src/<framework>.ts` with the middleware/plugin factory
2. Add `"./<framework>"` entry to `exports` in `package.json`
3. Add the framework as an optional peer dependency

No changes to core needed. Each framework entry point imports `check()` from core and wraps it in framework-specific glue. This spec only implements the Express entry point.

---

## File Changes

### Remove from `src/acl.ts`

- Remove `authorize()` method from the `ACLite` class.
- Remove `import type { RequestHandler } from 'express'`.
- Remove `import { createAuthZMiddleware } from './middleware/authorize'`.
- Remove `import type { AuthorizeOptions } from './types'`.

The class becomes fully framework-agnostic.

### New file: `src/express.ts`

The Express entry point. Re-exports the middleware factory and the `AuthorizeOptions` type.

```typescript
export { createAuthZMiddleware } from './middleware/authorize';
export type { AuthorizeOptions } from './types';
```

### Update `src/index.ts`

Remove `AuthorizeOptions` from exports — it moves to `src/express.ts`.

```typescript
export { ACLite } from './acl';
export { MemoryAdapter } from './adapters/memory.adapter';
export { RedisAdapter } from './adapters/redis.adapter';
export type { RedisAdapterOptions, RedisClient } from './adapters/redis.adapter';
export type { ACLAdapter } from './adapters/adapter.interface';
export type {
  ACLOptions,
  CheckOptions,
  RoleDefinition,
  RoleConfig,
  UpdateRoleOptions,
  AccessMap,
  RoleMap,
} from './types';
export {
  CircularHierarchyError,
  LockedError,
  DuplicateError,
  ConfigError,
} from './errors';
```

### Update `src/middleware/authorize.ts`

No code changes needed. The `createAuthZMiddleware` function already accepts an `acl` parameter with `{ check: (options: CheckOptions) => boolean }`. It does not depend on the ACLite class directly.

### Update `package.json`

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./express": {
      "types": "./dist/express.d.ts",
      "default": "./dist/express.js"
    }
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "express": ">=4.0.0",
    "ioredis": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "express": {
      "optional": true
    },
    "ioredis": {
      "optional": true
    }
  }
}
```

- `main` and `types` kept for backward compatibility with older bundlers.
- `exports` provides the modern resolution.
- Both `express` and `ioredis` are optional peer dependencies.

---

## Express middleware usage after this change

Before (method on class):
```typescript
import { ACLite } from 'aclite';
const acl = new ACLite();
app.use(acl.authorize({ role: (req) => req.decoded.role }));
```

After (standalone function):
```typescript
import { ACLite } from 'aclite';
import { createAuthZMiddleware } from 'aclite/express';
const acl = new ACLite();
app.use(createAuthZMiddleware(acl, { role: (req) => req.decoded.role }));
```

---

## Checklist

- [ ] `authorize()` removed from `ACLite` class
- [ ] `ACLite` class has zero Express imports
- [ ] `src/express.ts` exports `createAuthZMiddleware` and `AuthorizeOptions`
- [ ] `src/index.ts` no longer exports `AuthorizeOptions`
- [ ] `package.json` `exports` field maps `.` and `./express`
- [ ] `express` is optional peer dependency
- [ ] `main` and `types` fields kept for backward compat
- [ ] Existing `src/middleware/authorize.ts` unchanged
