import { Hono } from 'hono';
import { ACLite } from '../src/acl';
import { createAuthZMiddleware } from '../src/middleware/hono';

describe('Hono middleware', () => {
  let acl: ACLite;

  beforeAll(async () => {
    acl = new ACLite();
    await acl.access('viewUsers', ['GET /users']);
    await acl.access('manageUsers', ['POST /users']);
    await acl.role('staff', ['viewUsers']);
    await acl.role('admin', { inherits: 'staff', accesses: ['manageUsers'] });
    await acl.role('superAdmin', '*');
  });

  describe('role-based', () => {
    let app: Hono;

    beforeAll(() => {
      app = new Hono();
      const middleware = createAuthZMiddleware(acl, {
        role: (c) => c.req.header('x-role') ?? null,
      });
      app.use('/users', middleware);
      app.get('/users', (c) => c.json({ ok: true }));
      app.post('/users', (c) => c.json({ ok: true }));
    });

    it('allowed role returns 200', async () => {
      const res = await app.request('/users', {
        headers: { 'x-role': 'staff' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('denied role returns 403', async () => {
      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'x-role': 'staff' },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden' });
    });

    it('wildcard role returns 200', async () => {
      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'x-role': 'superAdmin' },
      });
      expect(res.status).toBe(200);
    });

    it('no role header returns 403', async () => {
      const res = await app.request('/users');
      expect(res.status).toBe(403);
    });
  });

  describe('accesses-based', () => {
    let app: Hono;

    beforeAll(() => {
      app = new Hono();
      const middleware = createAuthZMiddleware(acl, {
        accesses: (c) => {
          const header = c.req.header('x-accesses');
          return header ? header.split(',') : null;
        },
      });
      app.use('/users', middleware);
      app.get('/users', (c) => c.json({ ok: true }));
    });

    it('matching access returns 200', async () => {
      const res = await app.request('/users', {
        headers: { 'x-accesses': 'viewUsers' },
      });
      expect(res.status).toBe(200);
    });

    it('non-matching access returns 403', async () => {
      const res = await app.request('/users', {
        headers: { 'x-accesses': 'manageUsers' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('custom denied handler', () => {
    it('returns custom response', async () => {
      const app = new Hono();
      const middleware = createAuthZMiddleware(acl, {
        role: (c) => c.req.header('x-role') ?? null,
        denied: (c) => c.json({ message: 'Not allowed' }, 401),
      });
      app.use('/users', middleware);
      app.get('/users', (c) => c.json({ ok: true }));

      const res = await app.request('/users');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ message: 'Not allowed' });
    });
  });

  describe('basePath', () => {
    it('prepends basePath to route path', async () => {
      await acl.access('viewApiUsers', ['GET /api/users']);
      await acl.role('apiStaff', ['viewApiUsers']);

      const app = new Hono();
      const middleware = createAuthZMiddleware(acl, {
        role: (c) => c.req.header('x-role') ?? null,
        basePath: '/api',
      });
      app.use('/users', middleware);
      app.get('/users', (c) => c.json({ ok: true }));

      const res = await app.request('/users', {
        headers: { 'x-role': 'apiStaff' },
      });
      expect(res.status).toBe(200);
    });
  });
});
