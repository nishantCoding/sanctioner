import Fastify, { type FastifyInstance } from 'fastify';
import { Sanctioner } from '../src/acl';
import { createAuthZHook } from '../src/middleware/fastify';

describe('Fastify middleware', () => {
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
    let fastify: FastifyInstance;

    beforeAll(() => {
      fastify = Fastify();
      const hook = createAuthZHook(acl, {
        role: (req) => req.headers['x-role'] as string,
      });
      fastify.get('/users', { preHandler: hook }, () => ({ ok: true }));
      fastify.post('/users', { preHandler: hook }, () => ({ ok: true }));
    });

    it('allowed role returns 200', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/users',
        headers: { 'x-role': 'staff' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('denied role returns 403', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/users',
        headers: { 'x-role': 'staff' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden' });
    });

    it('wildcard role returns 200', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/users',
        headers: { 'x-role': 'superAdmin' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('no role header returns 403', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/users',
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('accesses-based', () => {
    let fastify: FastifyInstance;

    beforeAll(() => {
      fastify = Fastify();
      const hook = createAuthZHook(acl, {
        accesses: (req) => {
          const header = req.headers['x-accesses'] as string;
          return header ? header.split(',') : null;
        },
      });
      fastify.get('/users', { preHandler: hook }, () => ({ ok: true }));
    });

    it('matching access returns 200', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/users',
        headers: { 'x-accesses': 'viewUsers' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('non-matching access returns 403', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/users',
        headers: { 'x-accesses': 'manageUsers' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('custom denied handler', () => {
    it('returns custom response', async () => {
      const fastify = Fastify();
      const hook = createAuthZHook(acl, {
        role: (req) => req.headers['x-role'] as string,
        denied: (_req, reply) => reply.code(401).send({ message: 'Not allowed' }),
      });
      fastify.get('/users', { preHandler: hook }, () => ({ ok: true }));

      const res = await fastify.inject({
        method: 'GET',
        url: '/users',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ message: 'Not allowed' });
    });
  });

  describe('basePath', () => {
    it('prepends basePath to route path', async () => {
      await acl.access('viewApiUsers', ['GET /api/users']);
      await acl.role('apiStaff', ['viewApiUsers']);

      const fastify = Fastify();
      const hook = createAuthZHook(acl, {
        role: (req) => req.headers['x-role'] as string,
        basePath: '/api',
      });
      fastify.get('/users', { preHandler: hook }, () => ({ ok: true }));

      const res = await fastify.inject({
        method: 'GET',
        url: '/users',
        headers: { 'x-role': 'apiStaff' },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
