import type { RoleConfig, AccessMap, RoleMap } from '../types';

export interface ACLAdapter {
  saveAccess(name: string, routes: string[]): Promise<void>;
  removeAccess(name: string, routes?: string[]): Promise<void>;

  saveRole(name: string, config: RoleConfig): Promise<void>;
  removeRole(name: string): Promise<void>;

  loadAll(): Promise<{ accesses: AccessMap; roles: RoleMap }>;

  subscribe(onChanged: () => void): Promise<void>;
  publish(): Promise<void>;
}
