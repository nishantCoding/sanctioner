# Spec 10: Framework Middleware Tests

Integration tests for Express, Fastify, and Hono middleware adapters. Each test file spins up a real framework instance, registers routes with the ACLite middleware, and makes HTTP requests to verify 200/403 behavior.

---

## File: `tests/express-middleware.test.ts`

Uses `supertest` + `express`.

### Setup

```typescript
const acl = new ACLite();
await acl.access('viewUsers', ['GET /users']);
await acl.access('manageUsers', ['POST /users']);
await acl.role('staff', ['viewUsers']);
await acl.role('admin', { inherits: 'staff', accesses: ['manageUsers'] });
await acl.role('superAdmin', '*');
```

Express app with a route-level middleware pattern (since `req.route.path` requires matched routes):

```typescript
app.get('/users', createAuthZMiddleware(acl, opts), handler);
app.post('/users', createAuthZMiddleware(acl, opts), handler);
```

### Tests

**Role-based**
- Allowed role → 200
- Denied role → 403
- Wildcard role → 200 for any route
- No role header → 403

**Accesses-based**
- Matching access → 200
- Non-matching access → 403

**Custom denied handler**
- Returns custom response body and status

**basePath**
- Prepends basePath to route path for sub-router support

---

## File: `tests/fastify-middleware.test.ts`

Uses `fastify` (built-in inject for testing, no supertest needed).

### Setup

Same ACLite config as Express. Fastify app with `preHandler` hook:

```typescript
fastify.get('/users', { preHandler: createAuthZHook(acl, opts) }, handler);
```

### Tests

**Role-based**
- Allowed role → 200
- Denied role → 403
- Wildcard role → 200
- No role header → 403

**Accesses-based**
- Matching access → 200
- Non-matching access → 403

**Custom denied handler**
- Returns custom response

**basePath**
- Prepends basePath to route path

---

## File: `tests/hono-middleware.test.ts`

Uses `hono` (built-in `app.request()` for testing, no supertest needed).

### Setup

Same ACLite config. Hono app with per-route middleware:

```typescript
app.use('/users', createAuthZMiddleware(acl, opts));
app.get('/users', handler);
```

### Tests

**Role-based**
- Allowed role → 200
- Denied role → 403
- Wildcard role → 200
- No role header → 403

**Accesses-based**
- Matching access → 200
- Non-matching access → 403

**Custom denied handler**
- Returns custom response

**basePath**
- Prepends basePath to route path

---

## Identity Extraction Pattern

All tests pass identity via a request header (e.g., `x-role`, `x-accesses`) for simplicity. The middleware extractor reads from the header:

```typescript
role: (req) => req.headers['x-role'] as string
accesses: (req) => {
  const header = req.headers['x-accesses'] as string;
  return header ? header.split(',') : null;
}
```

This avoids JWT setup while testing the middleware plumbing.

---

## Checklist

- [ ] Express: role allowed/denied, wildcard, accesses, custom denied, basePath
- [ ] Fastify: role allowed/denied, wildcard, accesses, custom denied, basePath
- [ ] Hono: role allowed/denied, wildcard, accesses, custom denied, basePath
- [ ] No role/accesses → 403 for all frameworks
- [ ] All tests use real HTTP requests (supertest/inject/app.request)
