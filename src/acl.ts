import { AccessRegistry } from './core/access-registry';
import { RoleRegistry } from './core/role-registry';
import { LookupTable } from './core/lookup';
import { MemoryAdapter } from './adapters/memory.adapter';
import { LockedError } from './errors';
import type { ACLAdapter } from './adapters/adapter.interface';
import type {
  ACLOptions,
  RoleDefinition,
  UpdateRoleOptions,
  CheckOptions,
} from './types';

export class ACLite {
  private accessRegistry: AccessRegistry;
  private roleRegistry: RoleRegistry;
  private lookup: LookupTable;
  private adapter: ACLAdapter;
  private locked: boolean;

  constructor(options?: ACLOptions) {
    this.adapter = options?.adapter ?? new MemoryAdapter();
    this.locked = !(options?.mutable ?? true);
    this.accessRegistry = new AccessRegistry();
    this.roleRegistry = new RoleRegistry();
    this.lookup = new LookupTable();
  }

  // --- Layer 1: Accesses ---

  async access(name: string, routes: string[]): Promise<void> {
    this.guardMutable('access');
    this.accessRegistry.register(name, routes);
    await this.adapter.saveAccess(name, routes);
    this.rebuild();
  }

  async revokeAccess(name: string, routes?: string[]): Promise<void> {
    this.guardMutable('revokeAccess');
    if (routes) {
      this.accessRegistry.removeRoutes(name, routes);
    } else {
      this.accessRegistry.remove(name);
    }
    await this.adapter.removeAccess(name, routes);
    this.rebuild();
  }

  // --- Layer 2: Roles ---

  async role(name: string, definition: RoleDefinition): Promise<void> {
    this.guardMutable('role');
    this.roleRegistry.register(name, definition);
    await this.adapter.saveRole(name, this.roleRegistry.get(name)!);
    this.rebuild();
  }

  async updateRole(name: string, options: UpdateRoleOptions): Promise<void> {
    this.guardMutable('updateRole');
    this.roleRegistry.update(name, options);
    await this.adapter.saveRole(name, this.roleRegistry.get(name)!);
    this.rebuild();
  }

  async removeRole(name: string): Promise<void> {
    this.guardMutable('removeRole');
    this.roleRegistry.remove(name);
    await this.adapter.removeRole(name);
    this.rebuild();
  }

  // --- Framework-agnostic authorization check ---

  check(options: CheckOptions): boolean {
    const routeKey = options.method + ' ' + options.path;

    if (options.role) {
      return this.lookup.isWildcard(options.role) || this.lookup.check(routeKey, options.role);
    }

    if (options.accesses) {
      return options.accesses.some(a => this.lookup.check(routeKey, a));
    }

    return false;
  }

  // --- Lifecycle ---

  async load(): Promise<void> {
    const data = await this.adapter.loadAll();
    this.accessRegistry.loadFrom(data.accesses);
    this.roleRegistry.loadFrom(data.roles);
    this.rebuild();
    await this.adapter.subscribe(() => this.load());
  }

  lock(): void {
    this.locked = true;
  }

  isLocked(): boolean {
    return this.locked;
  }

  // --- Introspection ---

  resolve(roleName: string): string[] {
    return this.roleRegistry.resolveAccesses(roleName);
  }

  getAccessRoutes(accessName: string): string[] {
    return this.accessRegistry.get(accessName) ?? [];
  }

  getRoleAccesses(roleName: string): string[] {
    const config = this.roleRegistry.get(roleName);
    return config ? config.accesses : [];
  }

  getRouteAccesses(routeKey: string): string[] {
    const result: string[] = [];
    for (const [name, routes] of this.accessRegistry.getAll()) {
      if (routes.includes(routeKey)) {
        result.push(name);
      }
    }
    return result;
  }

  // --- Internal ---

  private guardMutable(method: string): void {
    if (this.locked) throw new LockedError(method);
  }

  private rebuild(): void {
    this.lookup.build(this.accessRegistry, this.roleRegistry);
  }
}
