# Spec 08: Unit Tests

Unit tests for all implemented modules. Jest + ts-jest, tests in `tests/` directory.

---

## File: `tests/access-registry.test.ts`

### `AccessRegistry`

**register**
- Stores access name → routes
- Stores a copy of routes (mutating original array doesn't affect registry)
- Throws `DuplicateError` if access name already registered
- Throws `ConfigError` if name is empty string
- Throws `ConfigError` if routes is empty array
- Throws `ConfigError` if route format is invalid (e.g., `'INVALID'`, `'GET'`, `'get /foo'`)
- Accepts all valid HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS

**remove**
- Deletes the access
- No-op if access not found (no error)

**removeRoutes**
- Removes specific routes from an existing access
- Deletes the access entirely if all routes are removed
- No-op if access not found

**get**
- Returns routes array for existing access
- Returns `undefined` for unknown access
- Returns a copy (mutating returned array doesn't affect registry)

**has**
- Returns `true` for registered access, `false` otherwise

**getAll**
- Returns the internal Map

**clear**
- Removes all accesses

**loadFrom**
- Clears existing data and loads from AccessMap
- Does not throw on data (assumes adapter data is valid)

**toJSON**
- Serializes all accesses to plain AccessMap object
- Returns copies of route arrays

---

## File: `tests/role-registry.test.ts`

### `RoleRegistry`

**register — normalization**
- `string[]` → `{ accesses: [...] }`
- `{ accesses?, inherits? }` → `{ accesses: [...], inherits: '...' }`
- `'*'` → `{ accesses: [], wildcard: true }`

**register — validation**
- Throws `DuplicateError` if role name already registered
- Throws `ConfigError` if name is empty string
- Throws `ConfigError` if `inherits` references a non-existent role
- Throws `CircularHierarchyError` if inheritance creates a cycle

**remove**
- Deletes the role
- Throws `ConfigError` if another role inherits from this one

**update**
- `addAccesses`: appends new accesses, deduplicates
- `removeAccesses`: removes specified accesses
- Throws `ConfigError` if role doesn't exist

**get**
- Returns copy of RoleConfig for existing role
- Returns `undefined` for unknown role

**has / isWildcard**
- `has` returns `true` for registered role
- `isWildcard` returns `true` for wildcard role, `false` for others

**resolveAccesses**
- Returns own accesses for flat role
- Returns own + parent accesses for inherited role
- Walks full chain: grandchild → child → parent
- Returns `['*']` for wildcard role
- Deduplicates accesses across chain
- Caches result (second call same result)
- Cache invalidated after register/remove/update

**loadFrom**
- Loads roles in topological order (parent before child)
- Throws `CircularHierarchyError` if cycle in data

**toJSON**
- Serializes to RoleMap with copies

---

## File: `tests/lookup.test.ts`

### `LookupTable`

**build**
- Creates access-level entries: `"GET /emps viewEmployees"` in allowed Set
- Creates role-level entries: `"GET /emps staff"` in allowed Set
- Includes inherited accesses in role entries
- Tracks wildcard roles in separate Set
- Clears previous state on rebuild

**check**
- Returns `true` for composite key in allowed Set
- Returns `false` for composite key not in Set

**isWildcard**
- Returns `true` for wildcard role
- Returns `false` for non-wildcard role

---

## File: `tests/aclite.test.ts`

### `ACLite`

**access()**
- Registers access and check() works for it
- Throws `DuplicateError` on duplicate

**revokeAccess()**
- Full revocation: removes all routes, check() returns false
- Partial revocation: removes specific routes only

**role()**
- Registers role, check() works for role-based check
- Hierarchy: child role inherits parent's access routes

**updateRole()**
- Adds accesses to existing role, check() reflects change

**removeRole()**
- Removes role, check() returns false for removed role

**check()**
- Role-based: returns true if role has access to route
- Role-based: returns false if role doesn't have access
- Wildcard role: returns true for any route
- Accesses-based: returns true if any access matches route
- Accesses-based: returns false if no access matches
- Empty accesses array: returns false
- No role or accesses: returns false
- Role takes precedence: if role provided, accesses ignored

**lock() / mutable**
- `lock()` prevents all mutations (access, revokeAccess, role, updateRole, removeRole)
- `mutable: false` starts locked from construction
- `check()` still works when locked
- `isLocked()` returns correct state

**load()**
- Hydrates from adapter data, check() works after load

**Introspection**
- `resolve()`: returns flattened accesses for role
- `getAccessRoutes()`: returns routes for access
- `getRoleAccesses()`: returns direct accesses for role
- `getRouteAccesses()`: returns accesses that cover a route

---

## File: `tests/memory-adapter.test.ts`

### `MemoryAdapter`

**saveAccess / removeAccess**
- Stores access, loadAll returns it
- Upsert: second save replaces routes
- Full removal: deletes the access
- Partial removal: removes specific routes
- Partial removal: deletes access if no routes remain

**saveRole / removeRole**
- Stores role config, loadAll returns it
- Upsert: second save replaces config
- Removal: deletes the role

**loadAll**
- Returns copies (mutating returned data doesn't affect adapter)
- Returns empty objects when nothing stored

**subscribe / publish**
- Both resolve without error (no-op)

---

## Checklist

- [ ] All 5 test files created
- [ ] `npm test` passes with all tests green
- [ ] AccessRegistry: register, remove, removeRoutes, validation, loadFrom, toJSON
- [ ] RoleRegistry: normalization, hierarchy, circular detection, resolveAccesses, topological sort
- [ ] LookupTable: build, check, isWildcard
- [ ] ACLite: access, role, check, lock, load, introspection
- [ ] MemoryAdapter: CRUD operations, copies, no-op sync
