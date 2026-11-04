# Plan: O(1) ACL Package (Framework-Agnostic Core + Express Middleware)

## Context

Custom ACL middleware achieves O(1) route lookups via `Map` + object property access. The npm `acl` package (OptimalBits) is dynamic but involves O(n) iteration and backend I/O per request. This package combines both: O(1) runtime checks, central config, access-as-primitive design, with pluggable storage (memory / Redis).

**Framework strategy:** The core (registries, lookup, adapters) is framework-agnostic. Express middleware ships in the same package as a thin wrapper. Other frameworks (Fastify, Hono) get separate packages later — no forced installs.

```
acl-o1              — core: ACL class, check(), registries, adapters + Express middleware
acl-o1-fastify      — Fastify plugin (future, peerDep on acl-o1)
acl-o1-hono         — Hono middleware (future, peerDep on acl-o1)
```

## Core Principle

**Access + Route → Allowed or 403.**

```
Layer 0: Route       — the atom. "GET /enterprises/emps/:id"
Layer 1: Access      — the primitive. Smallest independently toggleable unit.
                       Bundles related routes: 'viewEmployees' → [GET /emps, GET /emps/:id]
Layer 2: Role        — convenience. Bundles accesses: 'admin' → [viewEmployees, manageEmployees, ...]
Layer 3: Hierarchy   — optional. 'admin' inherits all of 'staff's accesses.
```

Access is the primitive — it matches what an admin toggles on/off per user.
Role is sugar — a named bundle of accesses.
Everything resolves to: does the user hold an access that covers this route?

**O(1) guarantee:** Regardless of adapter (memory or Redis), the check always runs against an in-memory precomputed Set of composite keys. Redis is never hit at request time.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Config Layer                    │
│  acl.access(), acl.role(), acl.revokeAccess()   │
│  Admin dashboard API calls                       │
└────────────────────┬────────────────────────────┘
                     │ writes to
                     ▼
┌─────────────────────────────────────────────────┐
│               Adapter (storage)                  │
│  ┌──────────────┐    ┌────────────────────┐     │
│  │ MemoryAdapter │    │   RedisAdapter     │     │
│  │ (default)     │    │ (persist + sync)   │     │
│  └──────────────┘    └────────────────────┘     │
└────────────────────┬────────────────────────────┘
                     │ builds / rebuilds
                     ▼
┌─────────────────────────────────────────────────┐
│       In-Memory Composite Key Set (O(1))         │
│  allowed: Set<string>                            │
│    "GET /enterprises/emps admin"                 │
│    "GET /enterprises/emps staff"                 │
│    "GET /enterprises/emps viewEmployees"         │
│  wildcardRoles: Set<string>                      │
│  knownRoutes: Set<string>                        │
└────────────────────┬────────────────────────────┘
                     │ used by
                     ▼
┌─────────────────────────────────────────────────┐
│          Framework-Agnostic check()              │
│  acl.check({ method, path, role/accesses })     │
│  O(1): Set.has("METHOD /path role") → boolean   │
└────────────────────┬────────────────────────────┘
                     │ wrapped by
                     ▼
┌─────────────────────────────────────────────────┐
│          Framework Middleware (thin)              │
│  Express: acl.authorize({ role: (req) => ... }) │
│  Fastify/Hono/custom: use check() directly      │
└─────────────────────────────────────────────────┘
```

**Key invariants:**
- `check()` ONLY reads the in-memory Set. Never touches the adapter at request time.
- `check()` takes plain strings, returns boolean. Zero framework dependency.
- Framework middleware is a thin wrapper: extract from request → call `check()` → respond.

---

## Adapters

### MemoryAdapter (default)

Everything in-process. Source of truth = the in-memory maps themselves.

```typescript
const acl = new ACL();
// or explicitly:
const acl = new ACL({ adapter: new MemoryAdapter() });
```

### RedisAdapter

Redis is the source of truth. In-memory maps are a cache.

```typescript
import { RedisAdapter } from 'acl-o1/redis';

const acl = new ACL({
  adapter: new RedisAdapter(redisClient, { prefix: 'acl:' }),
});
```

**Lifecycle:**
1. On startup: load config from Redis → build in-memory maps
2. On `acl.access()` / `acl.role()` / `acl.revokeAccess()`: write to Redis → rebuild local maps → publish change event
3. Other app instances: subscribe to change events via Redis pub/sub → rebuild their local maps
4. On request: check in-memory maps only — O(1), no Redis call

**Redis keys:**
```
acl:accesses          — Hash: accessName → JSON array of routes
acl:roles             — Hash: roleName → JSON { accesses: [...], inherits?: "..." }
acl:channel           — Pub/Sub channel for cross-instance sync
```

**Multi-instance sync:**
```
Instance A calls acl.access('viewEmployees', [...])
  → writes to Redis
  → rebuilds own in-memory maps
  → publishes to acl:channel

Instance B receives pub/sub message
  → reloads from Redis
  → rebuilds in-memory maps
  → next request uses updated config — O(1)
```

### Adapter Interface

```typescript
interface ACLAdapter {
  // Persist config
  saveAccess(name: string, routes: string[]): Promise<void>;
  saveRole(name: string, config: RoleConfig): Promise<void>;
  removeAccess(name: string, routes?: string[]): Promise<void>;
  removeRole(name: string): Promise<void>;

  // Persist user assignments (managed mode)
  saveUserAssignment(userId: string, assignment: { roles?: string[]; accesses?: string[] }): Promise<void>;
  removeUserAssignment(userId: string): Promise<void>;

  // Load (startup)
  loadAll(): Promise<{ accesses: AccessMap, roles: RoleMap, users: UserAssignments }>;

  // Sync (multi-instance)
  subscribe(onChanged: () => void): Promise<void>;
  publish(): Promise<void>;
}
```

Anyone can write a custom adapter (MongoDB, PostgreSQL, etc.) by implementing this interface.

---

## Public API

### Constructor

```typescript
import { ACL } from 'acl-o1';

const acl = new ACL({
  defaultPolicy: 'deny',   // 'deny' (default) | 'allow'
  mutable: true,            // true (default) | false
  adapter: new MemoryAdapter(),  // default
});

// With Redis
const acl = new ACL({
  adapter: new RedisAdapter(redisClient, { prefix: 'acl:' }),
});

// On startup with Redis — load existing config
await acl.load();
```

### Layer 1: Define Accesses (the primitive)

```typescript
await acl.access('viewEmployees', [
  'GET /enterprises/emps',
  'GET /enterprises/emps/:id',
  'GET /enterprises/emps/search',
]);

await acl.access('manageEmployees', [
  'POST /clinics/emps/register-and-employ',
  'PATCH /clinics/emps/:id',
]);

await acl.access('viewPatients', [
  'GET /enterprises/clients',
  'GET /enterprises/clients/:id',
]);

await acl.access('managePatients', [
  'POST /pet-enterprise-details/register',
  'PATCH /pet-enterprise-details/clients/:clientId',
]);

await acl.access('deletePatients', [
  'DELETE /pet-enterprise-details/clients/:clientId',
]);
```

With MemoryAdapter these are synchronous internally but return promises for API consistency with Redis.

**Naming:** Use whatever strings your DB already uses. The library is string-agnostic. `'viewEmployees'`, `'VIEW_EMPLOYEES'`, `'user:view'` — doesn't matter. The same string must match between config, role definitions, and JWT payload.

### Layer 2: Define Roles (bundles of accesses)

```typescript
// Flat
await acl.role('staff', ['viewEmployees', 'viewPatients']);
await acl.role('admin', ['viewEmployees', 'manageEmployees', 'viewPatients', 'managePatients', 'deletePatients']);
await acl.role('superAdmin', '*');  // wildcard — all accesses

// With hierarchy
await acl.role('staff', ['viewEmployees', 'viewPatients']);
await acl.role('admin', {
  inherits: 'staff',
  accesses: ['manageEmployees', 'managePatients', 'deletePatients'],
});
await acl.role('superAdmin', { inherits: 'admin' });
```

### Runtime Modification (with Redis)

```typescript
// Admin dashboard adds a new access
await acl.access('viewVaccines', ['GET /vaccination-programs', 'GET /vaccination-programs/:id']);

// Admin dashboard adds it to a role
await acl.updateRole('staff', { addAccesses: ['viewVaccines'] });

// Admin dashboard removes an access from a role
await acl.updateRole('staff', { removeAccesses: ['viewVaccines'] });

// Revoke a route from an access
await acl.revokeAccess('managePatients', 'POST /pet-enterprise-details/register');
```

All changes: persist to adapter → rebuild in-memory maps → publish sync event.

### Lock (optional — for MemoryAdapter startup-only pattern)

```typescript
acl.lock();
// After this, all mutation methods throw
```

### check() — Framework-Agnostic Authorization

The core authorization method. Takes plain strings, returns a boolean. No framework dependency.

```typescript
interface CheckOptions {
  method: string;           // 'GET', 'POST', etc.
  path: string;             // Express route pattern: '/enterprises/emps/:id'
  role?: string;            // single role name
  accesses?: string[];      // access names (for custom users)
  userId?: string;          // for managed mode
}

acl.check({ method: 'GET', path: '/enterprises/emps', role: 'admin' });
// → true

acl.check({ method: 'GET', path: '/enterprises/emps', accesses: ['viewEmployees'] });
// → true

acl.check({ method: 'DELETE', path: '/enterprises/emps/:id', role: 'staff' });
// → false
```

**Logic:**
1. Build route key: `method + " " + path`
2. If route key not in `knownRoutes` → return based on `defaultPolicy` (`deny` → false, `allow` → true)
3. If `userId` provided → look up managed assignments → check each assigned role/access via `allowed.has(routeKey + " " + role/access)`
4. Else if `role` provided → `wildcardRoles.has(role) || allowed.has(routeKey + " " + role)` → O(1)
5. Else if `accesses` provided → `accesses.some(a => allowed.has(routeKey + " " + a))` → O(A), each O(1)
6. Else → false (no identity)

**Single role = single `Set.has()` = O(1). Multiple accesses = A × `Set.has()` = O(A) where A is the user's access count (typically 1-5).**

**Any framework can use this directly:**
```typescript
// Fastify
fastify.addHook('onRequest', (req, reply, done) => {
  const allowed = acl.check({ method: req.method, path: req.routeOptions.url, role: req.decoded.role });
  allowed ? done() : reply.status(403).send({ error: 'Forbidden' });
});

// Hono
app.use('*', async (c, next) => {
  const allowed = acl.check({ method: c.req.method, path: c.req.routePath, role: c.get('role') });
  if (!allowed) return c.json({ error: 'Forbidden' }, 403);
  await next();
});
```

### Express Middleware (built-in convenience wrapper)

Thin wrapper around `check()` for Express. Ships in the same package.

```typescript
// Global middleware
app.use(acl.authorize({
  role: (req) => req.decoded.role,               // for role-based users
  accesses: (req) => req.decoded.accesses,       // for custom users (string[])
  denied: (req, res) => {                        // optional custom 403
    res.status(403).json({ message: 'Forbidden' });
  },
}));
```

`authorize()` internally:
```typescript
(req, res, next) => {
  const routePath = (basePath ?? '') + req.route.path;
  const role = opts.role?.(req);
  const accesses = opts.accesses?.(req);
  const userId = opts.userId?.(req);

  const allowed = acl.check({ method: req.method, path: routePath, role, accesses, userId });
  allowed ? next() : denied(req, res);
}
```

Per-route usage:
```typescript
app.get('/enterprises/dashboard-stats',
  acl.authorize({ role: (req) => req.decoded.role }),
  handler
);
```

Sub-router support:
```typescript
apiRouter.use(acl.authorize({
  role: (req) => req.decoded.role,
  basePath: '/api/v1',
}));
```

### Pass-through vs Managed Mode

The library supports two modes for resolving who the user is and what they can do.

#### Pass-through Mode (stateless)

The library stores **no user state**. The caller extracts role/accesses from the request (typically JWT) and hands them to the middleware via extractor callbacks.

```typescript
app.use(acl.authorize({
  role: (req) => req.decoded.role,               // role-based user
  accesses: (req) => req.decoded.accesses,       // custom user (string[])
}));
```

**How role changes take effect:** The library is stateless — it reads whatever the extractor returns from the current request. If the user's role changes in your DB, issue a new JWT with the updated role. As soon as the client sends the new JWT, the next request uses the new role immediately. No cache, no lag. The only delay is how fast your system delivers the new JWT to the client.

**JWT carries:** `{ role: "admin" }` or `{ accesses: ["viewEmployees", "viewPatients"] }`

#### Managed Mode (stateful)

The library **itself** stores user → role/accesses assignments. The JWT only needs to carry a userId.

```typescript
// Store assignments (e.g., from admin dashboard API)
await acl.assignRole('user123', 'admin');
await acl.assignAccesses('user123', ['viewEmployees']);  // additional standalone accesses
await acl.removeRole('user123', 'admin');

// Middleware only needs userId
app.use(acl.authorize({
  userId: (req) => req.decoded.userId,
}));
```

**How role changes take effect:** Immediately. Admin calls `acl.assignRole('user123', 'staff')` → next request from user123 uses the new role. No JWT reissuance needed. With RedisAdapter, all app instances see the change instantly via pub/sub.

**A user can have both roles AND standalone accesses:**
```typescript
await acl.assignRole('user123', 'staff');
await acl.assignAccesses('user123', ['deletePatients']);
// user123 now has: all of staff's routes + deletePatients routes
```

This is stored as `{ roles: ["staff"], accesses: ["deletePatients"] }` per user.

**JWT carries:** `{ userId: "user123" }` — no role/accesses in token.

#### Priority rule

If `userId` extractor is provided and returns a value → managed mode (library lookup).
Otherwise → falls back to `role` / `accesses` extractors (pass-through).

They don't mix within a single `authorize()` call. If you want different route groups to use different modes, use separate middleware:

```typescript
app.use('/internal', acl.authorize({ userId: (req) => req.decoded.userId }));
app.use('/api', acl.authorize({ role: (req) => req.decoded.role }));
```

#### Comparison

| | Pass-through | Managed |
|---|---|---|
| Who stores user→role? | Your system (JWT/DB) | The library |
| JWT contains | role + accesses | just userId |
| Role change takes effect | On next request with new JWT | Immediately |
| Library state | Stateless | Stateful |
| Redis benefit | Config sync only | Config sync + user assignment sync |

With RedisAdapter, managed mode user assignments are persisted and synced across instances.

### Introspection Helpers

```typescript
acl.resolve('admin');           // → ['viewEmployees', 'manageEmployees', ...] (resolved accesses)
acl.getAccessRoutes('viewEmployees');  // → ['GET /enterprises/emps', ...]
acl.getRoleAccesses('admin');          // → ['viewEmployees', 'manageEmployees', ...]
acl.getRouteAccesses('GET /enterprises/emps');  // → ['viewEmployees']
```

Useful for admin dashboards and JWT issuing.

---

## Precomputation

### Internal structures (rebuilt on every config change):

**`allowed`: `Set<string>`** — single flat Set of composite keys.

```
Format: "METHOD /path role-or-access"

"GET /enterprises/emps viewEmployees"
"GET /enterprises/emps/:id viewEmployees"
"GET /enterprises/emps staff"
"GET /enterprises/emps/:id staff"
"GET /enterprises/emps admin"
"GET /enterprises/emps/:id admin"
"POST /clinics/emps/register-and-employ manageEmployees"
"POST /clinics/emps/register-and-employ admin"
```

Both roles and accesses live in the same Set. A single `Set.has()` answers the question.

**`wildcardRoles`: `Set<string>`** — roles with `'*'` (all routes). Checked before `allowed`.

**`knownRoutes`: `Set<string>`** — all registered route keys (e.g., `"GET /enterprises/emps"`). Used to distinguish "route not registered" (→ `defaultPolicy`) from "route registered but user not allowed" (→ deny).

### Build process:

1. Clear `allowed`, `wildcardRoles`, `knownRoutes`
2. For each access → for each route in access:
   - Add `"METHOD /path accessName"` to `allowed`
   - Add `"METHOD /path"` to `knownRoutes`
3. For each role:
   - If wildcard → add to `wildcardRoles`, skip
   - Resolve full access set (own + inherited via hierarchy)
   - For each resolved access → for each route in access:
     - Add `"METHOD /path roleName"` to `allowed`
4. Hierarchy flattening: walk ancestor chain, collect all accesses, detect circular refs

### Example build:

```
acl.access('viewEmployees', ['GET /enterprises/emps', 'GET /enterprises/emps/:id'])
acl.access('manageEmployees', ['POST /clinics/emps/register-and-employ'])
acl.role('staff', ['viewEmployees'])
acl.role('admin', { inherits: 'staff', accesses: ['manageEmployees'] })
acl.role('superAdmin', '*')

→ allowed Set:
  "GET /enterprises/emps viewEmployees"
  "GET /enterprises/emps/:id viewEmployees"
  "POST /clinics/emps/register-and-employ manageEmployees"
  "GET /enterprises/emps staff"
  "GET /enterprises/emps/:id staff"
  "GET /enterprises/emps admin"                              ← inherited from staff
  "GET /enterprises/emps/:id admin"                          ← inherited from staff
  "POST /clinics/emps/register-and-employ admin"

→ wildcardRoles: Set { "superAdmin" }

→ knownRoutes: Set { "GET /enterprises/emps", "GET /enterprises/emps/:id", "POST /clinics/emps/register-and-employ" }
```

### Check examples:

```
acl.check({ method: 'GET', path: '/enterprises/emps', role: 'admin' })
  → wildcardRoles.has('admin')? No
  → allowed.has('GET /enterprises/emps admin')? Yes → true

acl.check({ method: 'GET', path: '/enterprises/emps', role: 'superAdmin' })
  → wildcardRoles.has('superAdmin')? Yes → true (skip Set lookup)

acl.check({ method: 'GET', path: '/enterprises/emps', accesses: ['deletePatients', 'viewEmployees'] })
  → allowed.has('GET /enterprises/emps deletePatients')? No
  → allowed.has('GET /enterprises/emps viewEmployees')? Yes → true

acl.check({ method: 'POST', path: '/clinics/emps/register-and-employ', role: 'staff' })
  → allowed.has('POST /clinics/emps/register-and-employ staff')? No → false
```

### Rebuild trigger:

- MemoryAdapter: immediate, synchronous
- RedisAdapter: after Redis write + on pub/sub receive from other instances

---

## JWT Payload Examples

### Role-based user
```json
{ "role": "admin", "userId": "user123" }
```

### Custom user (hand-picked accesses)
```json
{ "accesses": ["viewEmployees", "viewPatients"], "userId": "user456" }
```

### Migration from current system
```
Before: { role: "custom", accesses: { user: { viewEmployees: 1 }, patient: { viewPatients: 1 } } }
After:  { accesses: ["viewEmployees", "viewPatients"] }
```

---

## Edge Cases

### Route not in the map
`defaultPolicy: 'deny'` (default) → 403. `'allow'` → `next()`.

### `req.route.path` vs `req.originalUrl`
Uses Express pattern (`/emps/:id`), not actual URL (`/emps/42`). `basePath` option for sub-routers.

### Extractor returns null/undefined
403 immediately.

### Name collisions (access name = role name)
Throws: `'admin' is already defined as a role.`

### Circular hierarchy
Throws: `Circular hierarchy detected: b → a → b`

### Duplicate definitions
`access()` with same name throws. `role()` with same name throws.

### Wildcard role + revoke
Disallowed: `"Cannot revoke from a wildcard role."`

### Redis connection lost
In-memory maps remain intact. Reads (request checks) continue working. Writes (config changes) fail with error until Redis reconnects. On reconnect, sync automatically.

---

## README Framing: ACL vs RBAC

**Route-level ACL for Express with O(1) lookups.**

Traditional ACL is resource-centric: each resource holds a list of subjects and the operations they may perform ([NIST](https://csrc.nist.gov/glossary/term/role_based_access_control), [WorkOS](https://workos.com/blog/rbac-vs-acl)). In REST APIs, HTTP method + route pattern fully identifies both resource and operation — no verb layer needed.

| | This package (ACL) | node_acl (RBAC) |
|---|---|---|
| Primitive | Access (maps to routes) | Permission (verb on resource) |
| Model | Resource-centric: route → [accesses] | Role-centric: role → [resource + permissions] |
| Roles | Optional sugar (bundles accesses) | Required |
| Custom users | Direct accesses, no role needed | Must create per-user roles |
| Lookup | O(1) — single Set.has() on composite key | O(n) — iterate roles, backend I/O per request |
| Storage | Memory (default) or Redis (persistent) | Redis / MongoDB / Memory |
| Multi-instance sync | Redis pub/sub | Not built-in |

---

## File Structure

```
src/
  index.ts              — public exports
  acl.ts                — ACL class: access(), role(), check(), lock(), resolve(),
                          updateRole(), revokeAccess(), precomputation engine
  core/
    access-registry.ts  — access definitions + route mapping
    role-registry.ts    — role definitions + hierarchy + precomputation
    lookup.ts           — builds and holds the composite key Set (allowed, wildcardRoles, knownRoutes)
  middleware/
    authorize.ts        — Express authorize() middleware (thin wrapper around check())
  adapters/
    adapter.interface.ts — ACLAdapter interface
    memory.adapter.ts    — MemoryAdapter (default)
    redis.adapter.ts     — RedisAdapter (persistence + pub/sub sync)
  types.ts              — CheckOptions, RoleConfig, AuthorizeOptions, ACLOptions
  errors.ts             — CircularHierarchyError, LockedError, DuplicateError
tests/
  access.test.ts        — access definition, route mapping, revoke
  role.test.ts          — role definition, access bundling, hierarchy
  middleware.test.ts     — Express + supertest: role users, access users, 403
  memory-adapter.test.ts — MemoryAdapter specific
  redis-adapter.test.ts  — RedisAdapter: persist, load, pub/sub sync
  precomputation.test.ts — order independence, hierarchy flattening, rebuild
  edge-cases.test.ts    — unknown routes, null extractors, name collisions, wildcard
package.json
tsconfig.json
```

## Verification

1. **Access tests**: define accesses, verify routeAccesses maps
2. **Role tests**: define roles with accesses + hierarchy, verify routeRoles precomputed
3. **Middleware tests**: Express + supertest — role users 200, access users 200, unauthorized 403
4. **MemoryAdapter**: config, lock, introspection
5. **RedisAdapter**: persist to Redis, load on startup, pub/sub sync across instances, reconnect resilience
6. **Runtime mutation**: add/remove accesses and roles, verify maps rebuild correctly
7. **Edge cases**: unknown routes, null extractors, name collisions, circular hierarchy, wildcard
8. **Performance**: 1000 routes, 50 accesses, 10 roles — verify check is sub-millisecond
