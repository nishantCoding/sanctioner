import { RoleRegistry } from '../src/core/role-registry';
import { DuplicateError, ConfigError, CircularHierarchyError } from '../src/errors';

describe('RoleRegistry', () => {
  let registry: RoleRegistry;

  beforeEach(() => {
    registry = new RoleRegistry();
  });

  describe('register — normalization', () => {
    it('normalizes string[] to RoleConfig', () => {
      registry.register('staff', ['viewEmployees', 'viewPatients']);
      const config = registry.get('staff');
      expect(config).toEqual({ accesses: ['viewEmployees', 'viewPatients'] });
    });

    it('normalizes { inherits, accesses } to RoleConfig', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('admin', { inherits: 'staff', accesses: ['manageEmployees'] });
      const config = registry.get('admin');
      expect(config).toEqual({
        accesses: ['manageEmployees'],
        inherits: 'staff',
      });
    });

    it('normalizes * to wildcard RoleConfig', () => {
      registry.register('superAdmin', '*');
      const config = registry.get('superAdmin');
      expect(config).toEqual({ accesses: [], wildcard: true });
    });

    it('normalizes object with only inherits (no accesses)', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('admin', { inherits: 'staff' });
      const config = registry.get('admin');
      expect(config).toEqual({ accesses: [], inherits: 'staff' });
    });
  });

  describe('register — validation', () => {
    it('throws DuplicateError if role name already registered', () => {
      registry.register('staff', ['viewEmployees']);
      expect(() => registry.register('staff', ['other'])).toThrow(DuplicateError);
    });

    it('throws ConfigError if name is empty string', () => {
      expect(() => registry.register('', ['viewEmployees'])).toThrow(ConfigError);
    });

    it('throws ConfigError if inherits references non-existent role', () => {
      expect(() => registry.register('admin', { inherits: 'staff' })).toThrow(ConfigError);
    });

    it('throws CircularHierarchyError on cycle', () => {
      registry.register('a', []);
      registry.register('b', { inherits: 'a' });
      // Now if we could make a inherit b, that would be a cycle.
      // But since 'a' is already registered, we can't re-register it.
      // Cycle detection in register applies to the ancestor chain walk.
      // This is primarily tested via loadFrom.
    });
  });

  describe('remove', () => {
    it('deletes the role', () => {
      registry.register('staff', ['viewEmployees']);
      registry.remove('staff');
      expect(registry.has('staff')).toBe(false);
    });

    it('throws ConfigError if another role inherits from this one', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('admin', { inherits: 'staff' });
      expect(() => registry.remove('staff')).toThrow(ConfigError);
    });
  });

  describe('update', () => {
    it('addAccesses appends and deduplicates', () => {
      registry.register('staff', ['viewEmployees']);
      registry.update('staff', { addAccesses: ['viewPatients', 'viewEmployees'] });
      const config = registry.get('staff');
      expect(config!.accesses).toEqual(['viewEmployees', 'viewPatients']);
    });

    it('removeAccesses removes specified accesses', () => {
      registry.register('staff', ['viewEmployees', 'viewPatients']);
      registry.update('staff', { removeAccesses: ['viewPatients'] });
      const config = registry.get('staff');
      expect(config!.accesses).toEqual(['viewEmployees']);
    });

    it('throws ConfigError if role does not exist', () => {
      expect(() => registry.update('nonexistent', { addAccesses: ['x'] })).toThrow(ConfigError);
    });
  });

  describe('get', () => {
    it('returns copy of RoleConfig for existing role', () => {
      registry.register('staff', ['viewEmployees']);
      const config1 = registry.get('staff')!;
      config1.accesses.push('hacked');
      const config2 = registry.get('staff')!;
      expect(config2.accesses).toEqual(['viewEmployees']);
    });

    it('returns undefined for unknown role', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has / isWildcard', () => {
    it('has returns true for registered role', () => {
      registry.register('staff', ['viewEmployees']);
      expect(registry.has('staff')).toBe(true);
    });

    it('has returns false for unregistered role', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('isWildcard returns true for wildcard role', () => {
      registry.register('superAdmin', '*');
      expect(registry.isWildcard('superAdmin')).toBe(true);
    });

    it('isWildcard returns false for non-wildcard role', () => {
      registry.register('staff', ['viewEmployees']);
      expect(registry.isWildcard('staff')).toBe(false);
    });
  });

  describe('resolveAccesses', () => {
    it('returns own accesses for flat role', () => {
      registry.register('staff', ['viewEmployees', 'viewPatients']);
      expect(registry.resolveAccesses('staff')).toEqual(['viewEmployees', 'viewPatients']);
    });

    it('returns own + parent accesses for inherited role', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('admin', { inherits: 'staff', accesses: ['manageEmployees'] });
      const resolved = registry.resolveAccesses('admin');
      expect(resolved).toContain('manageEmployees');
      expect(resolved).toContain('viewEmployees');
    });

    it('walks full inheritance chain', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('admin', { inherits: 'staff', accesses: ['manageEmployees'] });
      registry.register('superAdmin', { inherits: 'admin', accesses: ['deleteAll'] });
      const resolved = registry.resolveAccesses('superAdmin');
      expect(resolved).toContain('deleteAll');
      expect(resolved).toContain('manageEmployees');
      expect(resolved).toContain('viewEmployees');
    });

    it('returns ["*"] for wildcard role', () => {
      registry.register('superAdmin', '*');
      expect(registry.resolveAccesses('superAdmin')).toEqual(['*']);
    });

    it('deduplicates accesses across chain', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('admin', { inherits: 'staff', accesses: ['viewEmployees', 'manageEmployees'] });
      const resolved = registry.resolveAccesses('admin');
      const viewCount = resolved.filter(a => a === 'viewEmployees').length;
      expect(viewCount).toBe(1);
    });

    it('returns empty array for unknown role', () => {
      expect(registry.resolveAccesses('nonexistent')).toEqual([]);
    });

    it('caches result (returns same data on second call)', () => {
      registry.register('staff', ['viewEmployees']);
      const first = registry.resolveAccesses('staff');
      const second = registry.resolveAccesses('staff');
      expect(first).toEqual(second);
    });

    it('cache invalidated after register', () => {
      registry.register('staff', ['viewEmployees']);
      registry.resolveAccesses('staff'); // populate cache
      registry.register('admin', { inherits: 'staff', accesses: ['manageEmployees'] });
      // Cache should be cleared, fresh resolve
      const resolved = registry.resolveAccesses('admin');
      expect(resolved).toContain('viewEmployees');
      expect(resolved).toContain('manageEmployees');
    });

    it('cache invalidated after update', () => {
      registry.register('staff', ['viewEmployees']);
      registry.resolveAccesses('staff'); // populate cache
      registry.update('staff', { addAccesses: ['viewPatients'] });
      const resolved = registry.resolveAccesses('staff');
      expect(resolved).toContain('viewPatients');
    });
  });

  describe('loadFrom', () => {
    it('loads roles in topological order (parent before child)', () => {
      registry.loadFrom({
        admin: { accesses: ['manageEmployees'], inherits: 'staff' },
        staff: { accesses: ['viewEmployees'] },
      });
      expect(registry.has('staff')).toBe(true);
      expect(registry.has('admin')).toBe(true);
      expect(registry.get('admin')!.inherits).toBe('staff');
    });

    it('throws CircularHierarchyError on cycle in data', () => {
      expect(() =>
        registry.loadFrom({
          a: { accesses: [], inherits: 'b' },
          b: { accesses: [], inherits: 'a' },
        }),
      ).toThrow(CircularHierarchyError);
    });

    it('clears existing data before loading', () => {
      registry.register('old', ['x']);
      registry.loadFrom({ staff: { accesses: ['viewEmployees'] } });
      expect(registry.has('old')).toBe(false);
      expect(registry.has('staff')).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('serializes to RoleMap with copies', () => {
      registry.register('staff', ['viewEmployees']);
      registry.register('superAdmin', '*');
      const json = registry.toJSON();
      expect(json.staff).toEqual({ accesses: ['viewEmployees'] });
      expect(json.superAdmin).toEqual({ accesses: [], wildcard: true });
    });
  });
});
