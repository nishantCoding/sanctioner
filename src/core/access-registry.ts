import { DuplicateError, ConfigError } from '../errors';
import type { AccessMap } from '../types';

const ROUTE_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*$/;

export class AccessRegistry {
  private accesses: Map<string, string[]> = new Map();

  register(name: string, routes: string[]): void {
    if (!name) throw new ConfigError('Access name must be a non-empty string');
    if (this.accesses.has(name)) throw new DuplicateError('access', name);
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new ConfigError('Routes must be a non-empty array of strings');
    }
    for (const route of routes) {
      if (!ROUTE_PATTERN.test(route)) {
        throw new ConfigError(`Invalid route format: '${route}'. Expected 'METHOD /path'`);
      }
    }
    this.accesses.set(name, [...routes]);
  }

  remove(name: string): void {
    this.accesses.delete(name);
  }

  removeRoutes(name: string, routes: string[]): void {
    const existing = this.accesses.get(name);
    if (!existing) return;
    const filtered = existing.filter(r => !routes.includes(r));
    if (filtered.length === 0) {
      this.accesses.delete(name);
    } else {
      this.accesses.set(name, filtered);
    }
  }

  get(name: string): string[] | undefined {
    const routes = this.accesses.get(name);
    return routes ? [...routes] : undefined;
  }

  has(name: string): boolean {
    return this.accesses.has(name);
  }

  getAll(): Map<string, string[]> {
    return this.accesses;
  }

  clear(): void {
    this.accesses.clear();
  }

  loadFrom(data: AccessMap): void {
    this.clear();
    for (const [name, routes] of Object.entries(data)) {
      this.accesses.set(name, [...routes]);
    }
  }

  toJSON(): AccessMap {
    const result: AccessMap = {};
    for (const [name, routes] of this.accesses) {
      result[name] = [...routes];
    }
    return result;
  }
}
