# Spec 11: Redis Adapter Tests

Unit tests for `src/adapters/redis.adapter.ts` using a mock `RedisClient`. No real Redis instance needed — all Redis methods are mocked to simulate hash storage in-memory.

---

## Mock Strategy

A `createMockRedisClient()` factory returns a mock implementing `RedisClient`. Internally it uses a `Map<string, Map<string, string>>` to simulate Redis hashes:

- `hset(key, field, value)` → stores field/value under key, returns 1
- `hget(key, field)` → returns stored value or null
- `hgetall(key)` → returns all field/value pairs as `Record<string, string>`, or `{}`
- `hdel(key, ...fields)` → deletes fields, returns count of deleted
- `publish(channel, message)` → records call, returns 0
- `subscribe(...channels)` → records call, returns 0
- `on(event, callback)` → stores callback for later manual triggering, returns `this`

The mock exposes a `trigger(event, ...args)` method to manually fire `on` callbacks (used to simulate pub/sub messages).

---

## File: `tests/redis-adapter.test.ts`

### Setup

```typescript
let adapter: RedisAdapter;
let client: MockRedisClient;
let subscriber: MockRedisClient;

beforeEach(() => {
  client = createMockRedisClient();
  subscriber = createMockRedisClient();
  adapter = new RedisAdapter({ client, subscriber });
});
```

### Tests

**saveAccess**
- Stores routes as JSON in `aclite:accesses` hash
- Publishes change notification after save

**removeAccess (full)**
- Deletes access field from hash
- Publishes change notification

**removeAccess (partial)**
- Removes specific routes, updates remaining as JSON
- Deletes field entirely if no routes remain after filtering
- No-op if access doesn't exist (no error)

**saveRole**
- Stores role config as JSON in `aclite:roles` hash
- Publishes change notification

**removeRole**
- Deletes role field from hash
- Publishes change notification

**loadAll**
- Returns deserialized accesses and roles from both hashes
- Returns empty objects when hashes are empty

**subscribe**
- Subscribes to `aclite:channel` on subscriber client
- Fires callback when message received on correct channel
- Ignores messages on other channels
- Idempotent: second call is a no-op
- No-op when no subscriber client provided

**publish**
- Publishes 'changed' to `aclite:channel`

**custom prefix**
- Uses custom prefix for all keys when configured

---

## Checklist

- [ ] Mock RedisClient with in-memory hash storage
- [ ] saveAccess: stores JSON, publishes
- [ ] removeAccess: full removal, partial removal, empty-after-filter removal, no-op on missing
- [ ] saveRole: stores JSON, publishes
- [ ] removeRole: deletes, publishes
- [ ] loadAll: deserializes both hashes, empty state
- [ ] subscribe: subscribes, fires callback, ignores wrong channel, idempotent, no subscriber
- [ ] publish: publishes to channel
- [ ] custom prefix: all keys use prefix
