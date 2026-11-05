import { MemoryAdapter } from '../src/adapters/memory.adapter';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  describe('saveAccess / removeAccess', () => {
    it('stores access and loadAll returns it', async () => {
      await adapter.saveAccess('viewEmployees', ['GET /emps', 'GET /emps/:id']);
      const { accesses } = await adapter.loadAll();
      expect(accesses.viewEmployees).toEqual(['GET /emps', 'GET /emps/:id']);
    });

    it('upsert: second save replaces routes', async () => {
      await adapter.saveAccess('viewEmployees', ['GET /emps']);
      await adapter.saveAccess('viewEmployees', ['GET /emps/:id']);
      const { accesses } = await adapter.loadAll();
      expect(accesses.viewEmployees).toEqual(['GET /emps/:id']);
    });

    it('full removal: deletes the access', async () => {
      await adapter.saveAccess('viewEmployees', ['GET /emps']);
      await adapter.removeAccess('viewEmployees');
      const { accesses } = await adapter.loadAll();
      expect(accesses.viewEmployees).toBeUndefined();
    });

    it('partial removal: removes specific routes', async () => {
      await adapter.saveAccess('viewEmployees', ['GET /emps', 'GET /emps/:id']);
      await adapter.removeAccess('viewEmployees', ['GET /emps/:id']);
      const { accesses } = await adapter.loadAll();
      expect(accesses.viewEmployees).toEqual(['GET /emps']);
    });

    it('partial removal: deletes access if no routes remain', async () => {
      await adapter.saveAccess('viewEmployees', ['GET /emps']);
      await adapter.removeAccess('viewEmployees', ['GET /emps']);
      const { accesses } = await adapter.loadAll();
      expect(accesses.viewEmployees).toBeUndefined();
    });
  });

  describe('saveRole / removeRole', () => {
    it('stores role config and loadAll returns it', async () => {
      await adapter.saveRole('staff', { accesses: ['viewEmployees'] });
      const { roles } = await adapter.loadAll();
      expect(roles.staff).toEqual({ accesses: ['viewEmployees'] });
    });

    it('upsert: second save replaces config', async () => {
      await adapter.saveRole('staff', { accesses: ['viewEmployees'] });
      await adapter.saveRole('staff', { accesses: ['viewPatients'] });
      const { roles } = await adapter.loadAll();
      expect(roles.staff).toEqual({ accesses: ['viewPatients'] });
    });

    it('removal: deletes the role', async () => {
      await adapter.saveRole('staff', { accesses: ['viewEmployees'] });
      await adapter.removeRole('staff');
      const { roles } = await adapter.loadAll();
      expect(roles.staff).toBeUndefined();
    });
  });

  describe('loadAll', () => {
    it('returns copies (mutating returned data does not affect adapter)', async () => {
      await adapter.saveAccess('viewEmployees', ['GET /emps']);
      await adapter.saveRole('staff', { accesses: ['viewEmployees'] });

      const data = await adapter.loadAll();
      data.accesses.viewEmployees.push('HACKED');
      data.roles.staff.accesses.push('HACKED');

      const fresh = await adapter.loadAll();
      expect(fresh.accesses.viewEmployees).toEqual(['GET /emps']);
      expect(fresh.roles.staff.accesses).toEqual(['viewEmployees']);
    });

    it('returns empty objects when nothing stored', async () => {
      const { accesses, roles } = await adapter.loadAll();
      expect(accesses).toEqual({});
      expect(roles).toEqual({});
    });
  });

  describe('subscribe / publish', () => {
    it('both resolve without error', async () => {
      await expect(adapter.subscribe(() => {})).resolves.toBeUndefined();
      await expect(adapter.publish()).resolves.toBeUndefined();
    });
  });
});
