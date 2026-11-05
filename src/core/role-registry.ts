import { DuplicateError, ConfigError, CircularHierarchyError } from '../errors';
import type { RoleDefinition, RoleConfig, RoleMap, UpdateRoleOptions } from '../types';

export class RoleRegistry {
  private roles: Map<string, RoleConfig> = new Map();
  private resolvedCache: Map<string, string[]> = new Map();

  register(name: string, definition: RoleDefinition): void {
    if (!name) throw new ConfigError('Role name must be a non-empty string');
    if (this.roles.has(name)) throw new DuplicateError('role', name);

    const config = this.normalize(definition);

    if (config.inherits) {
      if (!this.roles.has(config.inherits)) {
        throw new ConfigError(`Parent role '${config.inherits}' does not exist`);
      }
      this.detectCycle(name, config.inherits);
    }

    this.roles.set(name, config);
    this.invalidateCache();
  }

  remove(name: string): void {
    for (const [roleName, config] of this.roles) {
      if (config.inherits === name) {
        throw new ConfigError(`Cannot remove role '${name}': role '${roleName}' inherits from it`);
      }
    }
    this.roles.delete(name);
    this.invalidateCache();
  }

  update(name: string, options: UpdateRoleOptions): void {
    const config = this.roles.get(name);
    if (!config) throw new ConfigError(`Role '${name}' does not exist`);

    if (options.addAccesses) {
      const existing = new Set(config.accesses);
      for (const a of options.addAccesses) {
        existing.add(a);
      }
      config.accesses = [...existing];
    }

    if (options.removeAccesses) {
      const toRemove = new Set(options.removeAccesses);
      config.accesses = config.accesses.filter(a => !toRemove.has(a));
    }

    this.invalidateCache();
  }

  get(name: string): RoleConfig | undefined {
    const config = this.roles.get(name);
    if (!config) return undefined;
    return { ...config, accesses: [...config.accesses] };
  }

  has(name: string): boolean {
    return this.roles.has(name);
  }

  isWildcard(name: string): boolean {
    return this.roles.get(name)?.wildcard === true;
  }

  getAll(): Map<string, RoleConfig> {
    return this.roles;
  }

  resolveAccesses(name: string): string[] {
    const cached = this.resolvedCache.get(name);
    if (cached) return [...cached];

    const role = this.roles.get(name);
    if (!role) return [];

    if (role.wildcard) {
      this.resolvedCache.set(name, ['*']);
      return ['*'];
    }

    const accesses = [...role.accesses];
    if (role.inherits) {
      const parentAccesses = this.resolveAccesses(role.inherits);
      for (const a of parentAccesses) {
        if (!accesses.includes(a)) accesses.push(a);
      }
    }

    this.resolvedCache.set(name, accesses);
    return [...accesses];
  }

  clear(): void {
    this.roles.clear();
    this.invalidateCache();
  }

  loadFrom(data: RoleMap): void {
    this.clear();

    const names = Object.keys(data);
    if (names.length === 0) return;

    const sorted = this.topologicalSort(names, data);

    for (const name of sorted) {
      const config = data[name];
      this.roles.set(name, { ...config, accesses: [...config.accesses] });
    }
  }

  toJSON(): RoleMap {
    const result: RoleMap = {};
    for (const [name, config] of this.roles) {
      result[name] = { ...config, accesses: [...config.accesses] };
    }
    return result;
  }

  private normalize(definition: RoleDefinition): RoleConfig {
    if (definition === '*') {
      return { accesses: [], wildcard: true };
    }
    if (Array.isArray(definition)) {
      return { accesses: [...definition] };
    }
    const config: RoleConfig = {
      accesses: definition.accesses ? [...definition.accesses] : [],
    };
    if (definition.inherits) {
      config.inherits = definition.inherits;
    }
    return config;
  }

  private detectCycle(name: string, parentName: string): void {
    const chain = [name, parentName];
    let current = parentName;
    while (current) {
      const parent = this.roles.get(current);
      if (!parent?.inherits) break;
      if (parent.inherits === name) {
        chain.push(parent.inherits);
        throw new CircularHierarchyError(chain);
      }
      chain.push(parent.inherits);
      current = parent.inherits;
    }
  }

  private topologicalSort(names: string[], data: RoleMap): string[] {
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();

    for (const name of names) {
      inDegree.set(name, 0);
      children.set(name, []);
    }

    for (const name of names) {
      const config = data[name];
      if (config.inherits) {
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
        const parentChildren = children.get(config.inherits);
        if (parentChildren) parentChildren.push(name);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(name);
      for (const child of children.get(name) ?? []) {
        const newDegree = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, newDegree);
        if (newDegree === 0) queue.push(child);
      }
    }

    if (sorted.length !== names.length) {
      const inSorted = new Set(sorted);
      const remaining = names.filter(n => !inSorted.has(n));
      const start = remaining[0];
      const chain = [start];
      let current = data[start].inherits!;
      while (current !== start) {
        chain.push(current);
        current = data[current].inherits!;
      }
      chain.push(start);
      throw new CircularHierarchyError(chain);
    }

    return sorted;
  }

  private invalidateCache(): void {
    this.resolvedCache.clear();
  }
}
