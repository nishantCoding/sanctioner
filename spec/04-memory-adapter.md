# Spec 04: Memory Adapter

The default storage backend. Holds all config in plain objects within the process. No external dependencies. Used when no adapter is explicitly provided to the `ACLite` constructor.

---

## File: `src/adapters/memory.adapter.ts`

### Purpose

In-memory implementation of `ACLAdapter`. Stores accesses and roles in plain objects (`AccessMap`, `RoleMap`). No persistence across restarts. Multi-instance sync methods (`subscribe`, `publish`) are no-ops.

### Class: `MemoryAdapter`

```typescript
class MemoryAdapter implements ACLAdapter {
  private accesses: AccessMap;
  private roles: RoleMap;

  saveAccess(name: string, routes: string[]): Promise<void>;
  removeAccess(name: string, routes?: string[]): Promise<void>;

  saveRole(name: string, config: RoleConfig): Promise<void>;
  removeRole(name: string): Promise<void>;

  loadAll(): Promise<{ accesses: AccessMap; roles: RoleMap }>;

  subscribe(onChanged: () => void): Promise<void>;
  publish(): Promise<void>;
}
```

---

### `saveAccess(name, routes)`
- Stores a copy of the routes array under the access name.
- Upsert — if access already exists, replaces the route list.

### `removeAccess(name, routes?)`
- If `routes` not provided: deletes the entire access entry.
- If `routes` provided: removes only those routes from the existing entry. If no routes remain, deletes the entry.
- No-op if access not found.

### `saveRole(name, config)`
- Stores a copy of the role config under the role name.
- Upsert — replaces entirely if already exists.

### `removeRole(name)`
- Deletes the role entry. No-op if not found.

### `loadAll()`
- Returns shallow copies of both `accesses` and `roles` objects.
- Called by `ACLite.load()` on startup.

### `subscribe(onChanged)`
- No-op. Single-process adapter has no external change source.

### `publish()`
- No-op. Nothing to notify.

---

## Storage Format

Internal state is plain objects matching the adapter data shapes:

```typescript
accesses: {
  "viewEmployees": ["GET /enterprises/emps", "GET /enterprises/emps/:id"],
  "manageEmployees": ["POST /clinics/emps/register-and-employ"]
}

roles: {
  "staff": { accesses: ["viewEmployees", "viewPatients"] },
  "admin": { accesses: ["manageEmployees"], inherits: "staff" },
  "superAdmin": { accesses: [], wildcard: true }
}
```

---

## Copy Semantics

All data stored and returned is copied (spread). The adapter never holds references to objects passed in by the caller, and never returns references to its internal objects. This prevents external mutation of adapter state.

---

## Why async

All methods return `Promise<void>` (or `Promise<{...}>` for `loadAll`) even though the memory adapter is synchronous. This satisfies the `ACLAdapter` interface contract, which is designed for async backends (Redis). The memory adapter simply resolves immediately.

---

## Checklist

- [ ] Implements `ACLAdapter` interface fully
- [ ] `saveAccess` is upsert (replaces if exists)
- [ ] `removeAccess` handles both full removal and partial route removal
- [ ] `saveRole` stores a copy of the config
- [ ] `loadAll` returns copies, not internal references
- [ ] `subscribe` and `publish` are no-ops
- [ ] All methods are async (return Promises)
- [ ] No external dependencies
