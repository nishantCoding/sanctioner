import { RedisAdapter, type RedisClient } from '../src/adapters/redis.adapter';

type Listener = (...args: any[]) => void;

interface MockRedisClient extends RedisClient {
  trigger(event: string, ...args: any[]): void;
}

function createMockRedisClient(): MockRedisClient {
  const store = new Map<string, Map<string, string>>();
  const listeners = new Map<string, Listener[]>();

  const getHash = (key: string): Map<string, string> => {
    if (!store.has(key)) store.set(key, new Map());
    return store.get(key)!;
  };

  const mock: MockRedisClient = {
    async hset(key: string, field: string, value: string) {
      getHash(key).set(field, value);
      return 1;
    },
    async hget(key: string, field: string) {
      return getHash(key).get(field) ?? null;
    },
    async hgetall(key: string) {
      const hash = store.get(key);
      if (!hash || hash.size === 0) return {};
      const result: Record<string, string> = {};
      for (const [f, v] of hash) result[f] = v;
      return result;
    },
    async hdel(key: string, ...fields: string[]) {
      const hash = store.get(key);
      if (!hash) return 0;
      let count = 0;
      for (const f of fields) {
        if (hash.delete(f)) count++;
      }
      return count;
    },
    async publish() {
      return 0;
    },
    async subscribe() {
      return 0;
    },
    on(event: string, callback: Listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(callback);
      return mock;
    },
    trigger(event: string, ...args: any[]) {
      const cbs = listeners.get(event);
      if (cbs) cbs.forEach(cb => cb(...args));
    },
  };

  return mock;
}

describe('RedisAdapter', () => {
  let adapter: RedisAdapter;
  let client: MockRedisClient;
  let subscriber: MockRedisClient;

  beforeEach(() => {
    client = createMockRedisClient();
    subscriber = createMockRedisClient();
    adapter = new RedisAdapter({ client, subscriber });
  });

  describe('saveAccess', () => {
    it('stores routes as JSON in accesses hash', async () => {
      await adapter.saveAccess('viewUsers', ['GET /users']);
      const raw = await client.hget('aclite:accesses', 'viewUsers');
      expect(JSON.parse(raw!)).toEqual(['GET /users']);
    });

    it('publishes change notification', async () => {
      const spy = jest.spyOn(client, 'publish');
      await adapter.saveAccess('viewUsers', ['GET /users']);
      expect(spy).toHaveBeenCalledWith('aclite:channel', 'changed');
    });
  });

  describe('removeAccess', () => {
    it('full removal: deletes field from hash', async () => {
      await adapter.saveAccess('viewUsers', ['GET /users']);
      await adapter.removeAccess('viewUsers');
      const raw = await client.hget('aclite:accesses', 'viewUsers');
      expect(raw).toBeNull();
    });

    it('partial removal: removes specific routes', async () => {
      await adapter.saveAccess('viewUsers', ['GET /users', 'GET /users/:id']);
      await adapter.removeAccess('viewUsers', ['GET /users/:id']);
      const raw = await client.hget('aclite:accesses', 'viewUsers');
      expect(JSON.parse(raw!)).toEqual(['GET /users']);
    });

    it('partial removal: deletes field if no routes remain', async () => {
      await adapter.saveAccess('viewUsers', ['GET /users']);
      await adapter.removeAccess('viewUsers', ['GET /users']);
      const raw = await client.hget('aclite:accesses', 'viewUsers');
      expect(raw).toBeNull();
    });

    it('no-op if access does not exist', async () => {
      await expect(adapter.removeAccess('nonExistent', ['GET /x'])).resolves.toBeUndefined();
    });

    it('publishes change notification', async () => {
      const spy = jest.spyOn(client, 'publish');
      await adapter.removeAccess('viewUsers');
      expect(spy).toHaveBeenCalledWith('aclite:channel', 'changed');
    });
  });

  describe('saveRole', () => {
    it('stores role config as JSON in roles hash', async () => {
      await adapter.saveRole('staff', { accesses: ['viewUsers'] });
      const raw = await client.hget('aclite:roles', 'staff');
      expect(JSON.parse(raw!)).toEqual({ accesses: ['viewUsers'] });
    });

    it('publishes change notification', async () => {
      const spy = jest.spyOn(client, 'publish');
      await adapter.saveRole('staff', { accesses: ['viewUsers'] });
      expect(spy).toHaveBeenCalledWith('aclite:channel', 'changed');
    });
  });

  describe('removeRole', () => {
    it('deletes role from hash', async () => {
      await adapter.saveRole('staff', { accesses: ['viewUsers'] });
      await adapter.removeRole('staff');
      const raw = await client.hget('aclite:roles', 'staff');
      expect(raw).toBeNull();
    });

    it('publishes change notification', async () => {
      const spy = jest.spyOn(client, 'publish');
      await adapter.removeRole('staff');
      expect(spy).toHaveBeenCalledWith('aclite:channel', 'changed');
    });
  });

  describe('loadAll', () => {
    it('returns deserialized accesses and roles', async () => {
      await adapter.saveAccess('viewUsers', ['GET /users']);
      await adapter.saveRole('staff', { accesses: ['viewUsers'] });

      const { accesses, roles } = await adapter.loadAll();
      expect(accesses).toEqual({ viewUsers: ['GET /users'] });
      expect(roles).toEqual({ staff: { accesses: ['viewUsers'] } });
    });

    it('returns empty objects when nothing stored', async () => {
      const { accesses, roles } = await adapter.loadAll();
      expect(accesses).toEqual({});
      expect(roles).toEqual({});
    });
  });

  describe('subscribe', () => {
    it('subscribes to channel on subscriber client', async () => {
      const spy = jest.spyOn(subscriber, 'subscribe');
      await adapter.subscribe(() => {});
      expect(spy).toHaveBeenCalledWith('aclite:channel');
    });

    it('fires callback on message for correct channel', async () => {
      const cb = jest.fn();
      await adapter.subscribe(cb);
      subscriber.trigger('message', 'aclite:channel', 'changed');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('ignores messages on other channels', async () => {
      const cb = jest.fn();
      await adapter.subscribe(cb);
      subscriber.trigger('message', 'other:channel', 'changed');
      expect(cb).not.toHaveBeenCalled();
    });

    it('idempotent: second call is a no-op', async () => {
      const spy = jest.spyOn(subscriber, 'subscribe');
      await adapter.subscribe(() => {});
      await adapter.subscribe(() => {});
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('no-op when no subscriber client provided', async () => {
      const adapterNoSub = new RedisAdapter({ client });
      await expect(adapterNoSub.subscribe(() => {})).resolves.toBeUndefined();
    });
  });

  describe('publish', () => {
    it('publishes changed to channel', async () => {
      const spy = jest.spyOn(client, 'publish');
      await adapter.publish();
      expect(spy).toHaveBeenCalledWith('aclite:channel', 'changed');
    });
  });

  describe('custom prefix', () => {
    it('uses custom prefix for all keys', async () => {
      const customAdapter = new RedisAdapter({ client, subscriber, prefix: 'myapp:' });
      await customAdapter.saveAccess('viewUsers', ['GET /users']);
      await customAdapter.saveRole('staff', { accesses: ['viewUsers'] });

      expect(await client.hget('myapp:accesses', 'viewUsers')).not.toBeNull();
      expect(await client.hget('myapp:roles', 'staff')).not.toBeNull();

      const publishSpy = jest.spyOn(client, 'publish');
      await customAdapter.publish();
      expect(publishSpy).toHaveBeenCalledWith('myapp:channel', 'changed');

      const subscribeSpy = jest.spyOn(subscriber, 'subscribe');
      await customAdapter.subscribe(() => {});
      expect(subscribeSpy).toHaveBeenCalledWith('myapp:channel');
    });
  });
});
