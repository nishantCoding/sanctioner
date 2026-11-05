# Spec 05: Express Middleware

The Express-specific layer. A thin wrapper around the framework-agnostic `check()` method.

---

## File: `src/middleware/authorize.ts`

### Purpose

Exports a factory function that creates an Express middleware. The ACLite class delegates its `authorize()` method here. This keeps all Express-specific code isolated in one file.

### Function: `createAuthorizeMiddleware`

```typescript
function createAuthorizeMiddleware(
  acl: { check: (options: CheckOptions) => boolean },
  options: AuthorizeOptions,
): RequestHandler;
```

Takes a reference to the ACLite instance (only needs `check()`) and the user-provided options. Returns a standard Express `(req, res, next)` middleware.

#### Validation (at setup time, not per-request)

- Throws `ConfigError` if neither `role` nor `accesses` extractor is provided.

#### Returned middleware logic

```
1. Build route path:
     routePath = (basePath ?? '') + req.route.path

2. Extract identity from request:
     role = options.role?.(req) ?? undefined
     accesses = options.accesses?.(req) ?? undefined

3. Call check:
     allowed = acl.check({ method: req.method, path: routePath, role, accesses })

4. Result:
     allowed → next()
     denied  → options.denied(req, res) or default 403 response
```

#### Default denied handler

```typescript
(req, res) => res.status(403).json({ error: 'Forbidden' })
```

Overridden by providing `denied` in `AuthorizeOptions`.

---

## ACLite class delegation

### `acl.ts` — `authorize()` method

```typescript
authorize(options: AuthorizeOptions): RequestHandler {
  return createAuthorizeMiddleware(this, options);
}
```

One-liner. All logic lives in the middleware module.

---

## `req.route.path`

The middleware uses `req.route.path` — the Express route pattern (e.g., `/users/:id`), not the actual URL (e.g., `/users/42`). This matches the patterns registered via `acl.access()`.

**Limitation:** `req.route` is only available inside matched route handlers, not in application-level middleware registered with `app.use()` before routes are matched.

Valid usage:
```typescript
// Per-route — req.route.path is available
app.get('/users/:id', acl.authorize({ role: extractRole }), handler);

// Router-level — req.route.path is available
router.use(acl.authorize({ role: extractRole }));
```

Invalid usage:
```typescript
// Application-level before routes — req.route is undefined
app.use(acl.authorize({ role: extractRole }));
// This will throw: Cannot read property 'path' of undefined
```

---

## `basePath` for sub-routers

Express `req.route.path` gives the path relative to the router, not the full path. If accesses are registered with full paths, `basePath` bridges the gap.

```typescript
// Access registered with full path
await acl.access('viewUsers', ['GET /api/v1/users']);

// Sub-router mounted at /api/v1
const apiRouter = express.Router();
app.use('/api/v1', apiRouter);

// req.route.path inside apiRouter is '/users', not '/api/v1/users'
// basePath prepends the missing prefix
apiRouter.use(acl.authorize({
  role: (req) => req.decoded.role,
  basePath: '/api/v1',
}));
```

---

## Extractor edge cases

| Extractor returns | Behavior |
|---|---|
| `'admin'` (string) | Passed to `check()` as `role` |
| `['viewEmployees']` (array) | Passed to `check()` as `accesses` |
| `null` | Converted to `undefined` — treated as not provided |
| `undefined` | Treated as not provided |
| `''` (empty string) | Falsy — treated as not provided by `check()` |
| `[]` (empty array) | Truthy but `[].some()` returns false — denied |

If both `role` and `accesses` extractors are provided and both return values, `check()` uses `role` first (as per spec 03 check logic). `accesses` is only checked if `role` is not provided.

---

## Checklist

- [ ] `createAuthorizeMiddleware` exported from `src/middleware/authorize.ts`
- [ ] Throws `ConfigError` at setup time if no extractor provided
- [ ] Uses `req.route.path` (not `req.path` or `req.originalUrl`)
- [ ] `basePath` prepended to route path
- [ ] Null/undefined from extractors converted to `undefined`
- [ ] Default denied handler returns 403 JSON
- [ ] Custom denied handler supported via `options.denied`
- [ ] ACLite.authorize() delegates to middleware module
