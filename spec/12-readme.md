# Spec 12: README

The README for the `aclite` npm package. Concise, example-driven, no fluff.

---

## Structure

### Badge row
- npm version
- license (MIT)
- test status (optional, if CI added later)

### One-liner
What it is in one sentence.

### Install
```
npm install aclite
```

### Quick Start
Minimal working example — define accesses, define a role, check authorization. ~10 lines.

### How It Works

A short section that builds the mental model bottom-up. Should read naturally, not like a spec. The reader should walk away understanding the layering without needing to read source code.

**Access is the atomic unit.** An access is a named permission that maps to one or more routes. It's the smallest thing you can grant. Example: `viewUsers` → `['GET /users', 'GET /users/:id']`. The access name is what you reason about; the routes are what it protects.

**Roles are bundles of accesses.** A role groups accesses under a name for convenience. `staff` might have `['viewUsers', 'viewReports']`. Roles can inherit from one parent — `admin` inherits `staff` and adds `manageUsers`. This is sugar, not a requirement. You can skip roles entirely and check accesses directly.

**Wildcard roles bypass everything.** A role defined with `'*'` passes all checks regardless of route. Useful for superadmin-type roles.

**Authorization is O(1).** Internally, all access→route and role→access mappings are flattened into a single `Set` of composite keys (`"METHOD /path identity"`). Every `check()` call is a single `Set.has()` — no tree walking, no iteration.

Include a small diagram or flow showing the layers:

```
Role (optional sugar)
  └── inherits accesses from parent
  └── has its own accesses
        └── Access (atomic unit)
              └── maps to routes: "GET /users", "POST /users"

check({ method: 'GET', path: '/users', role: 'staff' })
  → Set.has("GET /users staff") → true/false
```

### Framework Middleware

Three subsections, one per framework. Each shows:
1. Install the framework (peer dep)
2. Import from `aclite/<framework>`
3. Wire up middleware with role/accesses extractor
4. Custom denied handler (brief)

#### Express
```typescript
import { ACLite } from 'aclite';
import { createAuthZMiddleware } from 'aclite/express';
```
Uses `req.route.path`, route-level middleware pattern.

#### Fastify
```typescript
import { ACLite } from 'aclite';
import { createAuthZHook } from 'aclite/fastify';
```
Uses `req.routeOptions.url`, preHandler hook pattern.

#### Hono
```typescript
import { ACLite } from 'aclite';
import { createAuthZMiddleware } from 'aclite/hono';
```
Uses `c.req.routePath`, Hono middleware pattern.

### Direct `check()` (framework-agnostic)
Show `acl.check({ method, path, role, accesses })` for custom integrations.

### Redis Adapter
```typescript
import Redis from 'ioredis';
import { ACLite, RedisAdapter } from 'aclite';
```
Shows:
- Creating adapter with client + subscriber
- Passing to ACLite constructor
- Calling `acl.load()` to hydrate from Redis
- Multi-instance sync via pub/sub (brief explanation)

### API Reference

Table-style or heading-style reference. Methods only — no internal classes.

**ACLite**
| Method | Description |
|---|---|
| `access(name, routes)` | Register an access |
| `revokeAccess(name, routes?)` | Remove access or specific routes |
| `role(name, definition)` | Register a role (`string[]`, `{ inherits, accesses }`, or `'*'`) |
| `updateRole(name, { addAccesses?, removeAccesses? })` | Modify a role's accesses |
| `removeRole(name)` | Remove a role |
| `check({ method, path, role?, accesses? })` | O(1) authorization check |
| `load()` | Hydrate from adapter + subscribe to changes |
| `lock()` / `isLocked()` | Prevent mutations |
| `resolve(roleName)` | Get flattened accesses for a role |
| `getAccessRoutes(accessName)` | Get routes for an access |
| `getRoleAccesses(roleName)` | Get direct accesses for a role |
| `getRouteAccesses(routeKey)` | Get accesses that cover a route |

**Middleware options** (all frameworks)
| Option | Description |
|---|---|
| `role` | Extractor: `(req/c) => string \| null` |
| `accesses` | Extractor: `(req/c) => string[] \| null` |
| `denied` | Custom denied handler |
| `basePath` | Prefix prepended to route path |

**Errors**
| Error | When |
|---|---|
| `ConfigError` | Invalid config (empty name, bad route format, no extractor) |
| `DuplicateError` | Access or role name already exists |
| `CircularHierarchyError` | Role inheritance cycle detected |
| `LockedError` | Mutation attempted on locked instance |

### License
MIT

---

## Tone

- Technical, direct, no marketing language
- Code examples over prose
- Assume reader is a Node.js developer who knows Express/Fastify/Hono

---

## Checklist

- [ ] Badge row
- [ ] One-liner + install
- [ ] Quick start example
- [ ] Concepts section (access, role, wildcard, O(1) check)
- [ ] Express middleware example
- [ ] Fastify middleware example
- [ ] Hono middleware example
- [ ] Direct check() usage
- [ ] Redis adapter example
- [ ] API reference table (ACLite methods, middleware options, errors)
- [ ] License
