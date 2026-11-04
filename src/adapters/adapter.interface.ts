import type { RoleConfig, AccessMap, RoleMap, UserAssignments } from '../types';

export interface ACLAdapter {
  saveAccess(name: string, routes: string[]): Promise<void>;
  removeAccess(name: string, routes?: string[]): Promise<void>;

  saveRole(name: string, config: RoleConfig): Promise<void>;
  removeRole(name: string): Promise<void>;

  saveUserAssignment(userId: string, assignment: { roles?: string[]; accesses?: string[] }): Promise<void>;
  removeUserAssignment(userId: string): Promise<void>;

  loadAll(): Promise<{ accesses: AccessMap; roles: RoleMap; users: UserAssignments }>;

  subscribe(onChanged: () => void): Promise<void>;
  publish(): Promise<void>;
}
