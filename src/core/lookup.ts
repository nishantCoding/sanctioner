import type { AccessRegistry } from './access-registry';
import type { RoleRegistry } from './role-registry';

export class LookupTable {
  private allowed: Set<string> = new Set();
  private wildcardRoles: Set<string> = new Set();

  build(accessRegistry: AccessRegistry, roleRegistry: RoleRegistry): void {
    this.allowed.clear();
    this.wildcardRoles.clear();

    const allAccesses = accessRegistry.getAll();

    // Access-level entries: "route accessName"
    for (const [accessName, routes] of allAccesses) {
      for (const route of routes) {
        this.allowed.add(route + ' ' + accessName);
      }
    }

    // Role-level entries: "route roleName"
    for (const [roleName, config] of roleRegistry.getAll()) {
      if (config.wildcard) {
        this.wildcardRoles.add(roleName);
        continue;
      }

      const resolvedAccesses = roleRegistry.resolveAccesses(roleName);
      for (const accessName of resolvedAccesses) {
        const routes = allAccesses.get(accessName);
        if (routes) {
          for (const route of routes) {
            this.allowed.add(route + ' ' + roleName);
          }
        }
      }
    }
  }

  check(routeKey: string, roleOrAccess: string): boolean {
    return this.allowed.has(routeKey + ' ' + roleOrAccess);
  }

  isWildcard(role: string): boolean {
    return this.wildcardRoles.has(role);
  }
}
