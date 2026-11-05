# sanctioner

[![npm version](https://img.shields.io/npm/v/sanctioner.svg)](https://www.npmjs.com/package/sanctioner)
[![license](https://img.shields.io/npm/l/sanctioner.svg)](https://github.com/user/sanctioner/blob/main/LICENSE)

O(1) route-level access control for Node.js. Framework-agnostic core with middleware for Express, Fastify, and Hono.

## Install

```bash
npm install sanctioner
```

## Quick Start

```typescript
import { ACLite } from 'sanctioner';

const acl = new ACLite();

// Define accesses (named permissions → routes)
await acl.access('viewUsers', ['GET /users', 'GET /users/:id']);
await acl.access('manageUsers', ['POST /users', 'DELETE /users/:id']);

// Define roles (bundles of accesses)
await acl.role('staff', ['viewUsers']);
await acl.role('admin', { inherits: 'staff', accesses: ['manageUsers'] });

// Check authorization
acl.check({ method: 'GET', path: '/users', role: 'staff' });     // true
acl.check({ method: 'POST', path: '/users', role: 'staff' });    // false
acl.check({ method: 'POST', path: '/users', role: 'admin' });    // true
```

## How It Works

**Access is the atomic unit.** An access is a named permission that maps to one or more routes. It's the smallest thing you can grant. `viewUsers` → `['GET /users', 'GET /users/:id']`. The access name is what you reason about; the routes are what it protects.

**Roles are bundles of accesses.** A role groups accesses under a name for convenience. `staff` might have `['viewUsers', 'viewReports']`. Roles can inherit from one parent — `admin` inherits `staff` and adds `manageUsers`. This is sugar, not a requirement. You can skip roles entirely and check accesses directly.

**Wildcard roles bypass everything.** A role defined with `'*'` passes all checks regardless of route. Useful for superadmin-type roles.

```typescript
await acl.role('superAdmin', '*');
acl.check({ method: 'DELETE', path: '/anything', role: 'superAdmin' }); // true
```

**Authorization is O(1).** Internally, all access→route and role→access mappings are flattened into a single `Set` of composite keys. Every `check()` call is a single `Set.has()` — no tree walking, no iteration.

```
Role (optional sugar)
  └── inherits accesses from parent
  └── has its own accesses
        └── Access (atomic unit)
              └── maps to routes: "GET /users", "POST /users"

check({ method: 'GET', path: '/users', role: 'staff' })
  → Set.has("GET /users staff") → true/false
```

## Framework Middleware

Each framework has its own entry point. Install only what you use — all framework dependencies are optional.

### Express

```bash
npm install express
```

```typescript
import { ACLite } from 'sanctioner';
import { createAuthZMiddleware } from 'sanctioner/express';

const acl = new ACLite();
await acl.access('viewUsers', ['GET /users']);
await acl.role('staff', ['viewUsers']);

const middleware = createAuthZMiddleware(acl, {
  role: (req) => req.headers['x-role'] as string,
});

// Route-level middleware (req.route.path must be available)
app.get('/users', middleware, (req, res) => res.json({ ok: true }));
```

### Fastify

```bash
npm install fastify
```

```typescript
import { ACLite } from 'sanctioner';
import { createAuthZHook } from 'sanctioner/fastify';

const acl = new ACLite();
await acl.access('viewUsers', ['GET /users']);
await acl.role('staff', ['viewUsers']);

const hook = createAuthZHook(acl, {
  role: (req) => req.headers['x-role'] as string,
});

// preHandler hook
fastify.get('/users', { preHandler: hook }, () => ({ ok: true }));
```

### Hono

```bash
npm install hono
```

```typescript
import { ACLite } from 'sanctioner';
import { createAuthZMiddleware } from 'sanctioner/hono';

const acl = new ACLite();
await acl.access('viewUsers', ['GET /users']);
await acl.role('staff', ['viewUsers']);

const middleware = createAuthZMiddleware(acl, {
  role: (c) => c.req.header('x-role') ?? null,
});

app.use('/users', middleware);
app.get('/users', (c) => c.json({ ok: true }));
```

### Custom Denied Handler

All middleware adapters default to `403 { error: 'Forbidden' }`. Override with the `denied` option to return a different status or body (e.g. 401 for unauthenticated):

```typescript
// Express
createAuthZMiddleware(acl, {
  role: (req) => req.headers['x-role'] as string,
  denied: (req, res) => res.status(401).json({ message: 'Not allowed' }),
});

// Fastify
createAuthZHook(acl, {
  role: (req) => req.headers['x-role'] as string,
  denied: (req, reply) => reply.code(401).send({ message: 'Not allowed' }),
});

// Hono
createAuthZMiddleware(acl, {
  role: (c) => c.req.header('x-role') ?? null,
  denied: (c) => c.json({ message: 'Not allowed' }, 401),
});
```

### Checking by Accesses

Instead of extracting a role, you can extract accesses directly. Useful when your JWT contains a list of permissions rather than a role name.

```typescript
createAuthZMiddleware(acl, {
  accesses: (req) => {
    const header = req.headers['x-accesses'] as string;
    return header ? header.split(',') : null;
  },
});
```

## Direct `check()`

For custom frameworks or non-HTTP use cases, call `check()` directly:

```typescript
acl.check({ method: 'GET', path: '/users', role: 'staff' });          // by role
acl.check({ method: 'GET', path: '/users', accesses: ['viewUsers'] }); // by accesses
```

When both `role` and `accesses` are provided, role takes precedence. If no `role` or `accesses` is provided, returns `false`.

## Redis Adapter

For persistence and multi-instance sync:

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import { ACLite, RedisAdapter } from 'sanctioner';

const redis = new Redis();
const subscriber = new Redis(); // separate connection for pub/sub

const adapter = new RedisAdapter({
  client: redis,
  subscriber,
  prefix: 'myapp:acl:', // optional, defaults to 'sanctioner:'
});

const acl = new ACLite({ adapter });

// Hydrate from Redis + subscribe to changes from other instances
await acl.load();
```

When any instance mutates ACL data, it publishes a change notification. All other instances with a subscriber connection automatically reload. This keeps multiple server instances in sync without polling.

## API Reference

### ACLite

| Method | Description |
|---|---|
| `new ACLite(options?)` | Create instance. Options: `{ adapter?, mutable? }` |
| `access(name, routes)` | Register a named access with route patterns |
| `revokeAccess(name, routes?)` | Remove an access entirely, or remove specific routes |
| `role(name, definition)` | Register a role. Definition: `string[]`, `{ inherits?, accesses? }`, or `'*'` |
| `updateRole(name, options)` | Modify role accesses. Options: `{ addAccesses?, removeAccesses? }` |
| `removeRole(name)` | Remove a role (fails if other roles inherit from it) |
| `check(options)` | O(1) authorization check. Options: `{ method, path, role?, accesses? }` |
| `load()` | Hydrate from adapter and subscribe to changes |
| `lock()` | Prevent all further mutations |
| `isLocked()` | Check if instance is locked |
| `resolve(roleName)` | Get flattened accesses for a role (walks inheritance) |
| `getAccessRoutes(accessName)` | Get routes mapped to an access |
| `getRoleAccesses(roleName)` | Get direct accesses for a role |
| `getRouteAccesses(routeKey)` | Get all accesses that cover a route (e.g. `'GET /users'`) |

### Constructor Options

| Option | Type | Default | Description |
|---|---|---|---|
| `adapter` | `ACLAdapter` | `MemoryAdapter` | Storage adapter |
| `mutable` | `boolean` | `true` | If `false`, instance starts locked |

### Middleware Options

All framework adapters accept the same options (typed to their framework's request/context):

| Option | Type | Description |
|---|---|---|
| `role` | `(req/c) => string \| null` | Extract role from request |
| `accesses` | `(req/c) => string[] \| null` | Extract accesses from request |
| `denied` | `(req/c, res/reply) => void` | Custom denied handler |
| `basePath` | `string` | Prefix prepended to route path |

At least one of `role` or `accesses` is required.

### Errors

| Error | When |
|---|---|
| `ConfigError` | Invalid configuration (empty name, bad route format, no extractor) |
| `DuplicateError` | Access or role name already registered |
| `CircularHierarchyError` | Role inheritance creates a cycle |
| `LockedError` | Mutation attempted on a locked instance |

## License

MIT
