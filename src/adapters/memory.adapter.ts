import type { ACLAdapter } from './adapter.interface';
import type { RoleConfig, AccessMap, RoleMap } from '../types';

export class MemoryAdapter implements ACLAdapter {
  private accesses: AccessMap = {};
  private roles: RoleMap = {};

  async saveAccess(name: string, routes: string[]): Promise<void> {
    this.accesses[name] = [...routes];
  }

  async removeAccess(name: string, routes?: string[]): Promise<void> {
    if (routes) {
      const existing = this.accesses[name];
      if (existing) {
        this.accesses[name] = existing.filter(r => !routes.includes(r));
        if (this.accesses[name].length === 0) {
          delete this.accesses[name];
        }
      }
    } else {
      delete this.accesses[name];
    }
  }

  async saveRole(name: string, config: RoleConfig): Promise<void> {
    this.roles[name] = { ...config, accesses: [...config.accesses] };
  }

  async removeRole(name: string): Promise<void> {
    delete this.roles[name];
  }

  async loadAll(): Promise<{ accesses: AccessMap; roles: RoleMap }> {
    return {
      accesses: { ...this.accesses },
      roles: { ...this.roles },
    };
  }

  async subscribe(_onChanged: () => void): Promise<void> {
    // No-op for memory adapter
  }

  async publish(): Promise<void> {
    // No-op for memory adapter
  }
}
