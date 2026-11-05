import { AccessRegistry } from '../src/core/access-registry';
import { RoleRegistry } from '../src/core/role-registry';
import { LookupTable } from '../src/core/lookup';

describe('LookupTable', () => {
  let accessRegistry: AccessRegistry;
  let roleRegistry: RoleRegistry;
  let lookup: LookupTable;

  beforeEach(() => {
    accessRegistry = new AccessRegistry();
    roleRegistry = new RoleRegistry();
    lookup = new LookupTable();
  });

  describe('build', () => {
    it('creates access-level entries', () => {
      accessRegistry.register('viewEmployees', ['GET /emps', 'GET /emps/:id']);
      lookup.build(accessRegistry, roleRegistry);

      expect(lookup.check('GET /emps', 'viewEmployees')).toBe(true);
      expect(lookup.check('GET /emps/:id', 'viewEmployees')).toBe(true);
      expect(lookup.check('POST /emps', 'viewEmployees')).toBe(false);
    });

    it('creates role-level entries', () => {
      accessRegistry.register('viewEmployees', ['GET /emps']);
      roleRegistry.register('staff', ['viewEmployees']);
      lookup.build(accessRegistry, roleRegistry);

      expect(lookup.check('GET /emps', 'staff')).toBe(true);
    });

    it('includes inherited accesses in role entries', () => {
      accessRegistry.register('viewEmployees', ['GET /emps']);
      accessRegistry.register('manageEmployees', ['POST /emps']);
      roleRegistry.register('staff', ['viewEmployees']);
      roleRegistry.register('admin', { inherits: 'staff', accesses: ['manageEmployees'] });
      lookup.build(accessRegistry, roleRegistry);

      // admin has own access
      expect(lookup.check('POST /emps', 'admin')).toBe(true);
      // admin inherits staff's access
      expect(lookup.check('GET /emps', 'admin')).toBe(true);
      // staff doesn't have admin's access
      expect(lookup.check('POST /emps', 'staff')).toBe(false);
    });

    it('tracks wildcard roles separately', () => {
      accessRegistry.register('viewEmployees', ['GET /emps']);
      roleRegistry.register('superAdmin', '*');
      lookup.build(accessRegistry, roleRegistry);

      expect(lookup.isWildcard('superAdmin')).toBe(true);
      expect(lookup.isWildcard('staff')).toBe(false);
    });

    it('clears previous state on rebuild', () => {
      accessRegistry.register('viewEmployees', ['GET /emps']);
      roleRegistry.register('staff', ['viewEmployees']);
      lookup.build(accessRegistry, roleRegistry);
      expect(lookup.check('GET /emps', 'staff')).toBe(true);

      // Clear registries and rebuild
      accessRegistry.clear();
      roleRegistry.clear();
      lookup.build(accessRegistry, roleRegistry);
      expect(lookup.check('GET /emps', 'staff')).toBe(false);
    });
  });

  describe('check', () => {
    it('returns true for matching composite key', () => {
      accessRegistry.register('viewEmployees', ['GET /emps']);
      lookup.build(accessRegistry, roleRegistry);
      expect(lookup.check('GET /emps', 'viewEmployees')).toBe(true);
    });

    it('returns false for non-matching composite key', () => {
      accessRegistry.register('viewEmployees', ['GET /emps']);
      lookup.build(accessRegistry, roleRegistry);
      expect(lookup.check('POST /emps', 'viewEmployees')).toBe(false);
      expect(lookup.check('GET /emps', 'nonexistent')).toBe(false);
    });
  });

  describe('isWildcard', () => {
    it('returns true for wildcard role', () => {
      roleRegistry.register('superAdmin', '*');
      lookup.build(accessRegistry, roleRegistry);
      expect(lookup.isWildcard('superAdmin')).toBe(true);
    });

    it('returns false for non-wildcard role', () => {
      roleRegistry.register('staff', ['viewEmployees']);
      lookup.build(accessRegistry, roleRegistry);
      expect(lookup.isWildcard('staff')).toBe(false);
    });
  });
});
