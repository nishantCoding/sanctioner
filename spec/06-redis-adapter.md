# Spec 06: Redis Adapter

Persistent storage backend with multi-instance sync via Redis pub/sub. Config survives restarts. Multiple Node.js instances stay in sync — when one instance changes config, all others reload.

**Dependency:** `ioredis` as a peer dependency (user provides their own Redis client).

---

## File: `src/adapters/redis.adapter.ts`

### Purpose

Implements `ACLAdapter` using Redis hashes for storage and pub/sub for cross-instance notifications.

### Class: `RedisAdapter`

```typescript
class RedisAdapter implements ACLAdapter {
  constructor(options: RedisAdapterOptions);

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

### `RedisAdapterOptions`

```typescript
interface RedisAdapterOptions {
  client: Redis;           // ioredis client instance (for read/write commands)
  subscriber?: Redis;      // separate ioredis client for pub/sub (required for subscribe)
  prefix?: string;         // key prefix, default: 'aclite:'
}
```

**Why two clients?** ioredis (and Redis itself) requires a dedicated connection for subscriptions. A client in subscribe mode cannot execute regular commands. The user provides both — one for data operations, one for listening.

If `subscriber` is not provided, `subscribe()` is a no-op (single-instance mode with persistence only).

---

## Redis Key Layout

All keys are prefixed with `options.prefix` (default `aclite:`).

| Key | Type | Contents |
|---|---|---|
| `aclite:accesses` | Hash | field = access name, value = JSON array of routes |
| `aclite:roles` | Hash | field = role name, value = JSON serialized RoleConfig |
| `aclite:channel` | Pub/Sub channel | Notification channel for config changes |

### Example Redis state

```
HGETALL aclite:accesses
  "viewEmployees"    → '["GET /enterprises/emps","GET /enterprises/emps/:id"]'
  "manageEmployees"  → '["POST /clinics/emps/register-and-employ"]'

HGETALL aclite:roles
  "staff"      → '{"accesses":["viewEmployees","viewPatients"]}'
  "admin"      → '{"accesses":["manageEmployees"],"inherits":"staff"}'
  "superAdmin" → '{"accesses":[],"wildcard":true}'
```

---

## Method Behavior

### `saveAccess(name, routes)`
```
HSET aclite:accesses <name> <JSON.stringify(routes)>
await this.publish()
```

### `removeAccess(name, routes?)`
- If `routes` not provided:
  ```
  HDEL aclite:accesses <name>
  ```
- If `routes` provided:
  ```
  existing = JSON.parse(HGET aclite:accesses <name>)
  filtered = existing minus routes
  if filtered is empty → HDEL
  else → HSET with filtered
  ```
- `await this.publish()` after either path.

### `saveRole(name, config)`
```
HSET aclite:roles <name> <JSON.stringify(config)>
await this.publish()
```

### `removeRole(name)`
```
HDEL aclite:roles <name>
await this.publish()
```

### `loadAll()`
```
accesses = HGETALL aclite:accesses → parse each value from JSON
roles = HGETALL aclite:roles → parse each value from JSON
return { accesses, roles }
```

Returns empty objects if keys don't exist (fresh Redis).

### `subscribe(onChanged)`
- If no `subscriber` client provided: no-op, return immediately.
- Subscribes to `aclite:channel` on the subscriber client.
- On message received: calls `onChanged()` to trigger a full reload.

### `publish()`
```
PUBLISH aclite:channel 'changed'
```

Notifies other instances to reload. The message payload is irrelevant — any message on the channel triggers a full `loadAll()` + rebuild.

---

## Publish After Every Write

Every mutation method (`saveAccess`, `removeAccess`, `saveRole`, `removeRole`) calls `this.publish()` at the end. This ensures other instances are notified of the change.

The publishing instance does NOT reload itself — it already applied the change locally before persisting to Redis. Only other instances (listening via `subscribe`) reload.

---

## Flow: Multi-Instance Sync

```
Instance A                          Redis                         Instance B
    │                                 │                                │
    │  acl.access('viewEmp', [...])   │                                │
    │  ├─ registry.register(...)      │                                │
    │  ├─ adapter.saveAccess(...)  ──►│ HSET aclite:accesses ...       │
    │  ├─ rebuild()                   │                                │
    │  └─ adapter.publish()        ──►│ PUBLISH aclite:channel         │
    │                                 │ ──────────────────────────►    │
    │                                 │          onChanged()           │
    │                                 │          ├─ adapter.loadAll() ◄┤
    │                                 │          ├─ registry.loadFrom()│
    │                                 │          └─ rebuild()          │
    │                                 │                                │
```

---

## Error Handling

- Redis connection errors are NOT caught by the adapter — they propagate to the caller. The consumer should handle Redis errors at the application level (e.g., ioredis retry config).
- `loadAll()` on empty Redis returns `{ accesses: {}, roles: {} }` — not an error.
- JSON parse errors from corrupted Redis data propagate as-is.

---

## Package Changes

Add `ioredis` as an optional peer dependency:

```json
{
  "peerDependencies": {
    "express": ">=4.0.0",
    "ioredis": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "ioredis": {
      "optional": true
    }
  }
}
```

The RedisAdapter is exported from the package but only usable if `ioredis` is installed. No runtime import guard needed — if the consumer imports `RedisAdapter` without ioredis, the import of ioredis types will guide them.

Export from `src/index.ts`:
```typescript
export { RedisAdapter } from './adapters/redis.adapter';
export type { RedisAdapterOptions } from './adapters/redis.adapter';
```

---

## Checklist

- [ ] Implements `ACLAdapter` interface fully
- [ ] Uses Redis hashes (`HSET`, `HGET`, `HGETALL`, `HDEL`) for storage
- [ ] JSON serialization for routes (arrays) and role configs (objects)
- [ ] `publish()` sends notification on pub/sub channel after every write
- [ ] `subscribe()` listens on pub/sub channel, calls `onChanged` on message
- [ ] `subscribe()` is no-op if no subscriber client provided
- [ ] `loadAll()` returns empty objects on fresh Redis
- [ ] Configurable key prefix (default `aclite:`)
- [ ] Requires two ioredis client instances (data + subscriber)
- [ ] ioredis is an optional peer dependency
- [ ] RedisAdapter and RedisAdapterOptions exported from index
