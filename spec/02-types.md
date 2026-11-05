# Spec 02: Types & Errors

All TypeScript interfaces, type aliases, and custom error classes used across the package.

---

## File: `src/types.ts`

### `ACLOptions`

Constructor options for `ACL`.

```typescript
interface ACLOptions {
  mutable?: boolean;                    // default: true
  adapter?: ACLAdapter;                 // default: MemoryAdapter instance
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `mutable` | `boolean` | `true` | If `false`, mutations (`access()`, `role()`, `revokeAccess()`, etc.) throw `LockedError` after construction. |
| `adapter` | `ACLAdapter` | `new MemoryAdapter()` | Storage backend. |

**Deny-only policy:** Routes not in the allowed Set are always denied (403). No configurable default policy — secure by default.

---

### `RoleDefinition`

The second argument to `acl.role(name, definition)`. Supports three forms:

```typescript
type RoleDefinition =
  | string[]                              // flat list of access names
  | { inherits?: string; accesses?: string[] }  // config object with optional hierarchy
  | '*';                                  // wildcard — all accesses
```

**Examples:**
```typescript
acl.role('staff', ['viewEmployees', 'viewPatients']);
acl.role('admin', { inherits: 'staff', accesses: ['manageEmployees'] });
acl.role('superAdmin', { inherits: 'admin' });
acl.role('superAdmin', '*');
```

---

### `RoleConfig`

Normalized internal representation of a role. This is what gets stored/loaded by adapters.

```typescript
interface RoleConfig {
  accesses: string[];      // direct access names
  inherits?: string;       // parent role name (single inheritance)
  wildcard?: boolean;      // true if role was defined with '*'
}
```

When a user calls `acl.role('staff', ['viewEmployees'])`, it normalizes to `{ accesses: ['viewEmployees'] }`.
When a user calls `acl.role('superAdmin', '*')`, it normalizes to `{ accesses: [], wildcard: true }`.

---

### `UpdateRoleOptions`

Options for `acl.updateRole(name, options)`.

```typescript
interface UpdateRoleOptions {
  addAccesses?: string[];
  removeAccesses?: string[];
}
```

---

### `AuthorizeOptions`

Options for `acl.authorize(options)` middleware factory.

```typescript
interface AuthorizeOptions {
  role?: (req: Request) => string | null | undefined;
  accesses?: (req: Request) => string[] | null | undefined;
  denied?: (req: Request, res: Response) => void;
  basePath?: string;
}
```

| Field | Type | Description |
|---|---|---|
| `role` | `(req) => string \| null \| undefined` | Extracts a single role name from request (e.g., from JWT). |
| `accesses` | `(req) => string[] \| null \| undefined` | Extracts access names from request (for custom users). |
| `denied` | `(req, res) => void` | Custom 403 handler. Default: `res.status(403).json({ error: 'Forbidden' })`. |
| `basePath` | `string` | Prepended to `req.route.path` for sub-router support. E.g., `'/api/v1'`. |

**At least one** of `role` or `accesses` must be provided, or `authorize()` throws at setup time.

---

### `AccessMap`

Type alias used by adapters for serialized access data.

```typescript
type AccessMap = Record<string, string[]>;
// { "viewEmployees": ["GET /enterprises/emps", "GET /enterprises/emps/:id"], ... }
```

---

### `RoleMap`

Type alias used by adapters for serialized role data.

```typescript
type RoleMap = Record<string, RoleConfig>;
// { "staff": { accesses: ["viewEmployees", "viewPatients"] }, "admin": { accesses: ["manageEmployees"], inherits: "staff" } }
```

---

## File: `src/adapters/adapter.interface.ts`

### `ACLAdapter`

Interface that all storage adapters implement.

```typescript
interface ACLAdapter {
  // Persist access definitions
  saveAccess(name: string, routes: string[]): Promise<void>;
  removeAccess(name: string, routes?: string[]): Promise<void>;

  // Persist role definitions
  saveRole(name: string, config: RoleConfig): Promise<void>;
  removeRole(name: string): Promise<void>;

  // Load everything on startup
  loadAll(): Promise<{
    accesses: AccessMap;
    roles: RoleMap;
  }>;

  // Multi-instance sync (no-op for MemoryAdapter)
  subscribe(onChanged: () => void): Promise<void>;
  publish(): Promise<void>;
}
```

**Contract:**
- `saveAccess` — Upsert. If access already exists, replaces the route list.
- `removeAccess(name)` — Remove the entire access. `removeAccess(name, routes)` — Remove specific routes from the access.
- `saveRole` — Upsert. Replaces the role config entirely.
- `removeRole` — Remove role and its config.
- `loadAll` — Called once on startup (or on sync). Returns full config.
- `subscribe` — Register callback for cross-instance config changes. MemoryAdapter: no-op.
- `publish` — Notify other instances of a config change. MemoryAdapter: no-op.

---

## File: `src/errors.ts`

### `CircularHierarchyError`

Thrown when defining a role creates a circular inheritance chain.

```typescript
class CircularHierarchyError extends Error {
  constructor(chain: string[]) {
    // chain example: ['b', 'a', 'b']
    super(`Circular hierarchy detected: ${chain.join(' → ')}`);
    this.name = 'CircularHierarchyError';
  }
}
```

### `LockedError`

Thrown when a mutation method is called after `lock()` or when `mutable: false`.

```typescript
class LockedError extends Error {
  constructor(method: string) {
    super(`Cannot call ${method}() on a locked ACL instance`);
    this.name = 'LockedError';
  }
}
```

### `DuplicateError`

Thrown when re-defining an access or role that already exists.

```typescript
class DuplicateError extends Error {
  constructor(type: 'access' | 'role', name: string) {
    super(`${type === 'access' ? 'Access' : 'Role'} '${name}' is already defined`);
    this.name = 'DuplicateError';
  }
}
```

### `ConfigError`

Thrown for invalid configuration (e.g., `authorize()` called without any extractor, unknown access name in role definition).

```typescript
class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
```

---

## Exports from `src/index.ts`

```typescript
// Classes
export { ACL } from './acl';
export { MemoryAdapter } from './adapters/memory.adapter';

// Adapter interface (type-only)
export type { ACLAdapter } from './adapters/adapter.interface';

// Types (type-only)
export type {
  ACLOptions,
  CheckOptions,
  RoleDefinition,
  RoleConfig,
  UpdateRoleOptions,
  AuthorizeOptions,
  AccessMap,
  RoleMap,
} from './types';

// Errors
export {
  CircularHierarchyError,
  LockedError,
  DuplicateError,
  ConfigError,
} from './errors';
```

---

## Checklist

- [ ] All public-facing types are exported from `src/index.ts`
- [ ] `ACLAdapter` is a standalone interface file (not coupled to any implementation)
- [ ] Error classes extend `Error` and set `this.name`
- [ ] `RoleDefinition` covers all three call forms (array, object, wildcard)
- [ ] `AuthorizeOptions` requires at least one extractor (validated at runtime, not type-level)
- [ ] `AccessMap` / `RoleMap` use plain objects (serializable) not `Map`
