import express from 'express';
import request from 'supertest';
import { Sanctioner } from '../src/acl';
import { createAuthZMiddleware } from '../src/middleware/authorize';

describe('Express middleware', () => {
  let acl: Sanctioner;

  beforeAll(async () => {
    acl = new Sanctioner();
    await acl.access('viewUsers', ['GET /users']);
    await acl.access('manageUsers', ['POST /users']);
    await acl.role('staff', ['viewUsers']);
    await acl.role('admin', { inherits: 'staff', accesses: ['manageUsers'] });
    await acl.role('superAdmin', '*');
  });

  describe('role-based', () => {
    let app: express.Express;

    beforeAll(() => {
      app = express();
      const middleware = createAuthZMiddleware(acl, {
        role: (req) => req.headers['x-role'] as string,
      });
      app.get('/users', middleware, (_req, res) => res.json({ ok: true }));
      app.post('/users', middleware, (_req, res) => res.json({ ok: true }));
    });

    it('allowed role returns 200', async () => {
      const res = await request(app).get('/users').set('x-role', 'staff');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('denied role returns 403', async () => {
      const res = await request(app).post('/users').set('x-role', 'staff');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('wildcard role returns 200 for any route', async () => {
      const res = await request(app).post('/users').set('x-role', 'superAdmin');
      expect(res.status).toBe(200);
    });

    it('no role header returns 403', async () => {
      const res = await request(app).get('/users');
      expect(res.status).toBe(403);
    });
  });

  describe('accesses-based', () => {
    let app: express.Express;

    beforeAll(() => {
      app = express();
      const middleware = createAuthZMiddleware(acl, {
        accesses: (req) => {
          const header = req.headers['x-accesses'] as string;
          return header ? header.split(',') : null;
        },
      });
      app.get('/users', middleware, (_req, res) => res.json({ ok: true }));
    });

    it('matching access returns 200', async () => {
      const res = await request(app).get('/users').set('x-accesses', 'viewUsers');
      expect(res.status).toBe(200);
    });

    it('non-matching access returns 403', async () => {
      const res = await request(app).get('/users').set('x-accesses', 'manageUsers');
      expect(res.status).toBe(403);
    });
  });

  describe('custom denied handler', () => {
    it('returns custom response', async () => {
      const app = express();
      const middleware = createAuthZMiddleware(acl, {
        role: (req) => req.headers['x-role'] as string,
        denied: (_req, res) => res.status(401).json({ message: 'Not allowed' }),
      });
      app.get('/users', middleware, (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/users');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Not allowed' });
    });
  });

  describe('basePath', () => {
    it('prepends basePath to route path', async () => {
      await acl.access('viewApiUsers', ['GET /api/users']);
      await acl.role('apiStaff', ['viewApiUsers']);

      const app = express();
      const router = express.Router();
      const middleware = createAuthZMiddleware(acl, {
        role: (req) => req.headers['x-role'] as string,
        basePath: '/api',
      });
      router.get('/users', middleware, (_req, res) => res.json({ ok: true }));
      app.use('/api', router);

      const res = await request(app).get('/api/users').set('x-role', 'apiStaff');
      expect(res.status).toBe(200);
    });
  });
});
