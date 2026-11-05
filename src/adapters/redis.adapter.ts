import type { ACLAdapter } from './adapter.interface';
import type { RoleConfig, AccessMap, RoleMap } from '../types';

export interface RedisClient {
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<number>;
  on(event: string, callback: (...args: any[]) => void): this;
}

export interface RedisAdapterOptions {
  client: RedisClient;
  subscriber?: RedisClient;
  prefix?: string;
}

export class RedisAdapter implements ACLAdapter {
  private client: RedisClient;
  private subscriber?: RedisClient;
  private prefix: string;
  private subscribed = false;

  constructor(options: RedisAdapterOptions) {
    this.client = options.client;
    this.subscriber = options.subscriber;
    this.prefix = options.prefix ?? 'acl.lite:';
  }

  async saveAccess(name: string, routes: string[]): Promise<void> {
    await this.client.hset(this.accessesKey(), name, JSON.stringify(routes));
    await this.publish();
  }

  async removeAccess(name: string, routes?: string[]): Promise<void> {
    if (routes) {
      const raw = await this.client.hget(this.accessesKey(), name);
      if (raw) {
        const existing: string[] = JSON.parse(raw);
        const filtered = existing.filter(r => !routes.includes(r));
        if (filtered.length === 0) {
          await this.client.hdel(this.accessesKey(), name);
        } else {
          await this.client.hset(this.accessesKey(), name, JSON.stringify(filtered));
        }
      }
    } else {
      await this.client.hdel(this.accessesKey(), name);
    }
    await this.publish();
  }

  async saveRole(name: string, config: RoleConfig): Promise<void> {
    await this.client.hset(this.rolesKey(), name, JSON.stringify(config));
    await this.publish();
  }

  async removeRole(name: string): Promise<void> {
    await this.client.hdel(this.rolesKey(), name);
    await this.publish();
  }

  async loadAll(): Promise<{ accesses: AccessMap; roles: RoleMap }> {
    const [rawAccesses, rawRoles] = await Promise.all([
      this.client.hgetall(this.accessesKey()),
      this.client.hgetall(this.rolesKey()),
    ]);

    const accesses: AccessMap = {};
    for (const [name, value] of Object.entries(rawAccesses)) {
      accesses[name] = JSON.parse(value);
    }

    const roles: RoleMap = {};
    for (const [name, value] of Object.entries(rawRoles)) {
      roles[name] = JSON.parse(value);
    }

    return { accesses, roles };
  }

  async subscribe(onChanged: () => void): Promise<void> {
    if (!this.subscriber || this.subscribed) return;
    this.subscribed = true;

    const channel = this.channelKey();
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch: string) => {
      if (ch === channel) {
        onChanged();
      }
    });
  }

  async publish(): Promise<void> {
    await this.client.publish(this.channelKey(), 'changed');
  }

  private accessesKey(): string {
    return this.prefix + 'accesses';
  }

  private rolesKey(): string {
    return this.prefix + 'roles';
  }

  private channelKey(): string {
    return this.prefix + 'channel';
  }
}
