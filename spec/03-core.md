# Spec 03: Core

The core layer — access registration, role registration, hierarchy flattening, precomputation of in-memory lookup maps, and the `ExpressACL` orchestrator class.

---

## File: `src/core/access-registry.ts`

### Purpose

Stores access definitions: access name → route list. Pure data, no precomputation.

### Class: `AccessRegistry`

```typescript
class AccessRegistry {
  private accesses: Map<string, string[]>;

  register(name: string, routes: string[]): void;
  remove(name: string): void;
  removeRoutes(name: string, routes: string[]): void;
  get(name: string): string[] | undefined;
  has(name: string): boolean;
  getAll(): Map<string, string[]>;
  clear(): void;
  loadFrom(data: AccessMap): void;
  toJSON(): AccessMap;
}
```

#### `register(name, routes)`
- Throws `DuplicateError` if name already exists.
- Validates: `routes` must be non-empty array of strings matching `METHOD /path` pattern.
- Stores a copy of the routes array (no external mutation).

#### `remove(name)`
- Deletes the access entirely. No-op if not found.

#### `removeRoutes(name, routes)`
- Removes specific routes from an existing access.
- If all routes removed, deletes the access.
- No-op if access not found.

#### `get(name)`
- Returns the route list for an access, or `undefined`.

#### `has(name)`
- Returns `true` if access is registered.

#### `getAll()`
- Returns the internal Map (read-only usage by lookup builder).

#### `clear()`
- Removes all accesses. Used during full reload.

#### `loadFrom(data: AccessMap)`
- Clears and bulk-loads from a plain object (from adapter's `loadAll()`).
- Does NOT throw on duplicates — assumes adapter data is valid.

#### `toJSON()`
- Serializes to `AccessMap` (plain object) for adapter persistence.

---

## File: `src/core/role-registry.ts`

### Purpose

Stores role definitions, handles hierarchy, flattens inheritance. Pure data + hierarchy logic, no route-level precomputation.

### Class: `RoleRegistry`

```typescript
class RoleRegistry {
  private roles: Map<string, RoleConfig>;

  register(name: string, definition: RoleDefinition): void;
  remove(name: string): void;
  update(name: string, options: UpdateRoleOptions): void;
  get(name: string): RoleConfig | undefined;
  has(name: string): boolean;
  isWildcard(name: string): boolean;
  getAll(): Map<string, RoleConfig>;
  resolveAccesses(name: string): string[];
  clear(): void;
  loadFrom(data: RoleMap): void;
  toJSON(): RoleMap;
}
```

#### `register(name, definition)`
- Throws `DuplicateError` if name already exists.
- Normalizes `RoleDefinition` → `RoleConfig`:
  - `string[]` → `{ accesses: [...] }`
  - `{ inherits?, accesses? }` → `{ accesses: [...], inherits: "..." }`
  - `'*'` → `{ accesses: [], wildcard: true }`
- If `inherits` is specified:
  - Throws `ConfigError` if parent doesn't exist.
  - Throws `CircularHierarchyError` if adding this inheritance creates a cycle.
  - Cycle detection: walk ancestor chain from parent upward, check if `name` appears.

#### `remove(name)`
- Throws `ConfigError` if other roles inherit from this role.
- Deletes the role.

#### `update(name, options)`
- Throws `ConfigError` if role not found.
- `addAccesses`: appends to the role's accesses (deduplicates).
- `removeAccesses`: removes from the role's accesses.

#### `get(name)`
- Returns the `RoleConfig` for a role, or `undefined`.

#### `has(name)`
- Returns `true` if role is registered.

#### `isWildcard(name)`
- Returns `true` if role was defined with `'*'`.

#### `getAll()`
- Returns the internal Map.

#### `resolveAccesses(name)`
- Walks the inheritance chain and collects all accesses (own + ancestors').
- Example: `resolveAccesses('admin')` where admin inherits staff:
  - admin's own accesses: `['manageEmployees']`
  - staff's accesses: `['viewEmployees', 'viewPatients']`
  - result: `['manageEmployees', 'viewEmployees', 'viewPatients']`
- For wildcard roles, returns `['*']` (special marker handled by lookup).
- Caches resolved accesses. Cache invalidated on any `register()`, `remove()`, or `update()`.

#### `clear()`
- Removes all roles. Used during full reload.

#### `loadFrom(data: RoleMap)`
- Clears and bulk-loads from plain object.
- Must load in dependency order: if `admin` inherits `staff`, load `staff` first.
  - Implementation: topological sort of the role graph before inserting.
  - If cycle detected during sort, throws `CircularHierarchyError`.

#### `toJSON()`
- Serializes to `RoleMap` (plain object) for adapter persistence.

---

## File: `src/core/lookup.ts`

### Purpose

Builds and holds the composite key Set that the `check()` method queries. This is where O(1) comes from. One flat Set replaces the previous two-Map approach.

### Class: `LookupTable`

```typescript
class LookupTable {
  private allowed: Set<string>;
  private wildcardRoles: Set<string>;

  build(accessRegistry: AccessRegistry, roleRegistry: RoleRegistry): void;
  check(routeKey: string, roleOrAccess: string): boolean;
  isWildcard(role: string): boolean;
}
```

#### `build(accessRegistry, roleRegistry)`

Called on every config change. Rebuilds the Set from scratch.

```
1. Clear allowed, wildcardRoles

2. For each access in accessRegistry:
     For each route in access.routes:
       allowed.add(route + " " + accessName)     // "GET /enterprises/emps viewEmployees"

3. For each role in roleRegistry:
     If role.isWildcard:
       wildcardRoles.add(roleName)
       continue
     resolvedAccesses = roleRegistry.resolveAccesses(roleName)
     For each accessName in resolvedAccesses:
       routes = accessRegistry.get(accessName)
       For each route in routes:
         allowed.add(route + " " + roleName)      // "GET /enterprises/emps admin"
```

**Cost:** O(R * A * T) where R=roles, A=accesses per role, T=routes per access. Paid once per config change. Typically small numbers.

**Example result:**
```
allowed: Set {
  "GET /enterprises/emps viewEmployees",
  "GET /enterprises/emps/:id viewEmployees",
  "GET /enterprises/emps staff",
  "GET /enterprises/emps/:id staff",
  "GET /enterprises/emps admin",
  "GET /enterprises/emps/:id admin",
  "POST /clinics/emps/register-and-employ manageEmployees",
  "POST /clinics/emps/register-and-employ admin",
}

wildcardRoles: Set { "superAdmin" }
```

#### `check(routeKey, roleOrAccess)`
```typescript
return this.allowed.has(routeKey + ' ' + roleOrAccess);
```
Single `Set.has()` — O(1). Works for both roles and accesses since both live in the same Set.

#### `isWildcard(role)`
```typescript
return this.wildcardRoles.has(role);
```
O(1).


---

## File: `src/acl.ts`

### Purpose

The main `ACL` class. Orchestrates registries, adapter, lookup table, and exposes the public API. Framework-agnostic — `check()` is the core method.

### Class: `ACL`

```typescript
class ACL {
  private options: Required<ACLOptions>;
  private accessRegistry: AccessRegistry;
  private roleRegistry: RoleRegistry;
  private lookup: LookupTable;
  private adapter: ACLAdapter;
  private locked: boolean;

  constructor(options?: ACLOptions);

  // Layer 1: Accesses
  async access(name: string, routes: string[]): Promise<void>;
  async revokeAccess(name: string, routes?: string[]): Promise<void>;

  // Layer 2: Roles
  async role(name: string, definition: RoleDefinition): Promise<void>;
  async updateRole(name: string, options: UpdateRoleOptions): Promise<void>;
  async removeRole(name: string): Promise<void>;

  // Framework-agnostic authorization check
  check(options: CheckOptions): boolean;

  // Lifecycle
  async load(): Promise<void>;
  lock(): void;
  isLocked(): boolean;

  // Express middleware (thin wrapper around check() — delegates to middleware module, spec 05)
  authorize(options: AuthorizeOptions): RequestHandler;

  // Introspection
  resolve(roleName: string): string[];
  getAccessRoutes(accessName: string): string[];
  getRoleAccesses(roleName: string): string[];
  getRouteAccesses(routeKey: string): string[];

  // Internal
  private guardMutable(method: string): void;
  private rebuild(): void;
}
```

#### Constructor

```typescript
constructor(options?: ACLOptions) {
  this.options = {
    mutable: options?.mutable ?? true,
    adapter: options?.adapter ?? new MemoryAdapter(),
  };
  this.accessRegistry = new AccessRegistry();
  this.roleRegistry = new RoleRegistry();
  this.lookup = new LookupTable();
  this.adapter = this.options.adapter;
  this.locked = !this.options.mutable;
}
```

If `mutable: false`, the instance starts locked. Mutation methods throw immediately.

#### `guardMutable(method)`
- If `this.locked` is `true`, throws `LockedError(method)`.
- Called at the top of every mutation method.

#### `access(name, routes)`
1. `guardMutable('access')`
2. `accessRegistry.register(name, routes)`
3. `await adapter.saveAccess(name, routes)`
4. `rebuild()`

#### `revokeAccess(name, routes?)`
1. `guardMutable('revokeAccess')`
2. If `routes` provided: `accessRegistry.removeRoutes(name, routes)`, else `accessRegistry.remove(name)`
3. `await adapter.removeAccess(name, routes)`
4. `rebuild()`

#### `role(name, definition)`
1. `guardMutable('role')`
2. `roleRegistry.register(name, definition)`
3. `await adapter.saveRole(name, roleRegistry.get(name)!)`
4. `rebuild()`

#### `updateRole(name, options)`
1. `guardMutable('updateRole')`
2. `roleRegistry.update(name, options)`
3. `await adapter.saveRole(name, roleRegistry.get(name)!)`
4. `rebuild()`

#### `removeRole(name)` (the role definition removal)
1. `guardMutable('removeRole')`
2. `roleRegistry.remove(name)`
3. `await adapter.removeRole(name)`
4. `rebuild()`

#### `check(options: CheckOptions)` — framework-agnostic authorization

The core authorization method. Takes plain strings, returns a boolean. No framework dependency.

```typescript
interface CheckOptions {
  method: string;           // 'GET', 'POST', etc.
  path: string;             // route pattern: '/enterprises/emps/:id'
  role?: string;            // single role name
  accesses?: string[];      // access names (for custom users)
  userId?: string;          // for managed mode
}
```

Logic:
1. Build route key: `method + " " + path`
2. If `role` provided → `lookup.isWildcard(role) || lookup.check(routeKey, role)` → O(1)
3. Else if `accesses` provided → `accesses.some(a => lookup.check(routeKey, a))` → O(A), each O(1)
4. Else → `false` (no identity)

Not in the Set = denied. No `defaultPolicy` — deny is the only policy.

`lookup.check(routeKey, x)` is a single `allowed.has(routeKey + " " + x)` — O(1).

Does NOT throw — returns `false` for any invalid/missing input. This is a hot path.

#### `load()`
- Called once on startup (mainly for RedisAdapter).
- `const data = await adapter.loadAll()`
- `accessRegistry.loadFrom(data.accesses)`
- `roleRegistry.loadFrom(data.roles)`
- `rebuild()`
- `await adapter.subscribe(() => this.load())` — re-load on cross-instance changes.

#### `lock()`
- `this.locked = true`. No-op if already locked.

#### `isLocked()`
- Returns `this.locked`.

#### `rebuild()`
- `lookup.build(accessRegistry, roleRegistry)`
- Synchronous. Called after every config mutation.

#### Introspection methods

All introspection reads from the registries (source of truth), NOT the composite key Set.

- `resolve(roleName)`: delegates to `roleRegistry.resolveAccesses(roleName)`
- `getAccessRoutes(accessName)`: delegates to `accessRegistry.get(accessName)` → returns copy
- `getRoleAccesses(roleName)`: delegates to `roleRegistry.get(roleName)?.accesses` → returns copy
- `getRouteAccesses(routeKey)`: iterates `accessRegistry.getAll()`, collects accesses whose routes include `routeKey`

All return copies (arrays), not internal references.

---

## Validation Rules

| Method | Validation |
|---|---|
| `access(name, routes)` | Name is non-empty string. Routes is non-empty string array. Each route matches `METHOD /path`. Name not already registered. |
| `role(name, definition)` | Name is non-empty string. Name not already registered. If inherits, parent must exist. No circular inheritance. |
| `updateRole(name, options)` | Role must exist. Accesses being added must exist in accessRegistry (optional — configurable strictness). |
| `assignRole(userId, role)` | Role(s) must exist in roleRegistry. |
| `assignAccesses(userId, accesses)` | Access(es) must exist in accessRegistry. |

Route format validation regex: `/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*$/`

---

## Rebuild Flow (visual)

```
acl.access('viewEmployees', ['GET /emps', 'GET /emps/:id'])
  │
  ├─ accessRegistry.register('viewEmployees', [...])
  ├─ adapter.saveAccess('viewEmployees', [...])
  └─ rebuild()
       │
       └─ lookup.build(accessRegistry, roleRegistry)
            │
            └─ allowed: Set {
                 "GET /emps viewEmployees",
                 "GET /emps/:id viewEmployees",
               }
               knownRoutes: Set { "GET /emps", "GET /emps/:id" }

acl.role('staff', ['viewEmployees'])
  │
  ├─ roleRegistry.register('staff', { accesses: ['viewEmployees'] })
  ├─ adapter.saveRole('staff', { accesses: ['viewEmployees'] })
  └─ rebuild()
       │
       └─ allowed: Set {
            "GET /emps viewEmployees",
            "GET /emps/:id viewEmployees",
            "GET /emps staff",                ← new
            "GET /emps/:id staff",            ← new
          }

acl.role('admin', { inherits: 'staff', accesses: ['manageEmployees'] })
  │
  └─ rebuild()
       │
       └─ allowed: Set {
            "GET /emps viewEmployees",
            "GET /emps/:id viewEmployees",
            "GET /emps staff",
            "GET /emps/:id staff",
            "GET /emps admin",                ← inherited from staff
            "GET /emps/:id admin",            ← inherited from staff
            "POST /emps manageEmployees",     ← admin's own
            "POST /emps admin",               ← admin's own
          }
```

---

## Checklist

- [ ] `AccessRegistry` stores access→routes, throws on duplicate, supports remove/removeRoutes
- [ ] `RoleRegistry` stores role→config, normalizes `RoleDefinition`, detects circular hierarchy
- [ ] `RoleRegistry.resolveAccesses` walks inheritance chain, caches result, invalidates on mutation
- [ ] `RoleRegistry.loadFrom` topologically sorts roles before inserting
- [ ] `LookupTable.build` constructs composite key Set + wildcardRoles + knownRoutes
- [ ] `LookupTable.check` is O(1) via single `Set.has()` on composite key
- [ ] `ACL` orchestrates: registry → adapter → rebuild, in that order
- [ ] `ACL.check()` is framework-agnostic: plain strings in, boolean out
- [ ] `check()` handles role and accesses (always pass-through, no managed mode)
- [ ] `check()` denies everything not in the allowed Set (deny-only policy)
- [ ] `guardMutable` blocks all mutations when locked
- [ ] `load()` hydrates from adapter, subscribes to changes
- [ ] `removeRole` removes a role definition
- [ ] All public methods returning data return copies, not internal references
- [ ] Route format validated on `access()` calls
