# Plan: O(1) Express ACL npm Package

## Context

Custom ACL middleware achieves O(1) route lookups via `Map` + object property access. The npm `acl` package (OptimalBits) is dynamic but involves O(n) iteration and backend I/O per request. This package combines both: O(1) runtime checks, central config, access-as-primitive design, with pluggable storage (memory / Redis).

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

**O(1) guarantee:** Regardless of adapter (memory or Redis), the check always runs against in-memory precomputed maps. Redis is never hit at request time.

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
│          In-Memory Lookup Maps (O(1))            │
│  routeAccesses: route → Set<access>              │
│  routeRoles:    route → Set<role>                │
└────────────────────┬────────────────────────────┘
                     │ used by
                     ▼
┌─────────────────────────────────────────────────┐
│              Express Middleware                   │
│  acl.authorize({ role, accesses })               │
│  O(1) check: Map.get() + Set.has()              │
└─────────────────────────────────────────────────┘
```

**Key invariant:** Middleware ONLY reads the in-memory maps. Never touches the adapter at request time.

---

## Adapters

### MemoryAdapter (default)

Everything in-process. Source of truth = the in-memory maps themselves.

```typescript
const acl = new ExpressACL();
// or explicitly:
const acl = new ExpressACL({ adapter: new MemoryAdapter() });
```

### RedisAdapter

Redis is the source of truth. In-memory maps are a cache.

```typescript
import { RedisAdapter } from 'express-acl-o1/redis';

const acl = new ExpressACL({
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
  // Persist
  saveAccess(name: string, routes: string[]): Promise<void>;
  saveRole(name: string, config: RoleConfig): Promise<void>;
  removeAccess(name: string, routes?: string[]): Promise<void>;
  removeRole(name: string): Promise<void>;

  // Load (startup)
  loadAll(): Promise<{ accesses: AccessMap, roles: RoleMap }>;

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
import { ExpressACL } from 'express-acl-o1';

const acl = new ExpressACL({
  defaultPolicy: 'deny',   // 'deny' (default) | 'allow'
  mutable: true,            // true (default) | false
  adapter: new MemoryAdapter(),  // default
});

// With Redis
const acl = new ExpressACL({
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

### Middleware

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

Middleware logic:
1. Build route key: `req.method + " " + req.route.path`
2. If `role` extractor returns a value → `routeRoles.get(routeKey)?.has(role)` → O(1)
3. Else if `accesses` extractor returns a value → convert to Set once per request, then `accesses.some(a => routeAccesses.get(routeKey)?.has(a))` → O(A), each O(1)
4. Else → 403 (no identity)

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

### In-memory maps (rebuilt on every config change):

```
routeAccesses: Map<string, Set<string>>
  "GET /enterprises/emps" → Set { "viewEmployees" }
  "POST /clinics/emps/register-and-employ" → Set { "manageEmployees" }

routeRoles: Map<string, Set<string>>
  "GET /enterprises/emps" → Set { "staff", "admin", "superAdmin" }
  "POST /clinics/emps/register-and-employ" → Set { "admin", "superAdmin" }
```

### Build process:

1. For each access, add it to `routeAccesses` for each of its routes
2. For each role, resolve its full access set (own + inherited via hierarchy)
3. For each role's resolved accesses, find all routes → add role to `routeRoles` for those routes
4. Hierarchy flattening: walk ancestor chain, collect all accesses, detect circular refs

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
| Lookup | O(1) — Map + Set, always in-memory | O(n) — iterate roles, backend I/O per request |
| Storage | Memory (default) or Redis (persistent) | Redis / MongoDB / Memory |
| Multi-instance sync | Redis pub/sub | Not built-in |

---

## File Structure

```
src/
  index.ts              — public exports
  acl.ts                — ExpressACL class: access(), role(), lock(), resolve(),
                          updateRole(), revokeAccess(), precomputation engine
  middleware.ts          — authorize() middleware factory
  adapters/
    interface.ts        — ACLAdapter interface
    memory.ts           — MemoryAdapter (default)
    redis.ts            — RedisAdapter (persistence + pub/sub sync)
  types.ts              — AccessConfig, RoleConfig, AuthorizeOptions, ACLOptions
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
