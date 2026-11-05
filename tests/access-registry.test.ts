import { AccessRegistry } from '../src/core/access-registry';
import { DuplicateError, ConfigError } from '../src/errors';

describe('AccessRegistry', () => {
  let registry: AccessRegistry;

  beforeEach(() => {
    registry = new AccessRegistry();
  });

  describe('register', () => {
    it('stores access name with routes', () => {
      registry.register('viewEmployees', ['GET /emps', 'GET /emps/:id']);
      expect(registry.get('viewEmployees')).toEqual(['GET /emps', 'GET /emps/:id']);
    });

    it('stores a copy of routes (no external mutation)', () => {
      const routes = ['GET /emps'];
      registry.register('viewEmployees', routes);
      routes.push('POST /emps');
      expect(registry.get('viewEmployees')).toEqual(['GET /emps']);
    });

    it('throws DuplicateError if access name already registered', () => {
      registry.register('viewEmployees', ['GET /emps']);
      expect(() => registry.register('viewEmployees', ['GET /emps/:id'])).toThrow(DuplicateError);
    });

    it('throws ConfigError if name is empty string', () => {
      expect(() => registry.register('', ['GET /emps'])).toThrow(ConfigError);
    });

    it('throws ConfigError if routes is empty array', () => {
      expect(() => registry.register('viewEmployees', [])).toThrow(ConfigError);
    });

    it('throws ConfigError if route format is invalid', () => {
      expect(() => registry.register('bad', ['INVALID'])).toThrow(ConfigError);
      expect(() => registry.register('bad2', ['GET'])).toThrow(ConfigError);
      expect(() => registry.register('bad3', ['get /foo'])).toThrow(ConfigError);
      expect(() => registry.register('bad4', ['/foo'])).toThrow(ConfigError);
    });

    it('accepts all valid HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      methods.forEach((method, i) => {
        registry.register(`access${i}`, [`${method} /test`]);
        expect(registry.has(`access${i}`)).toBe(true);
      });
    });
  });

  describe('remove', () => {
    it('deletes the access', () => {
      registry.register('viewEmployees', ['GET /emps']);
      registry.remove('viewEmployees');
      expect(registry.has('viewEmployees')).toBe(false);
    });

    it('is no-op if access not found', () => {
      expect(() => registry.remove('nonexistent')).not.toThrow();
    });
  });

  describe('removeRoutes', () => {
    it('removes specific routes from an existing access', () => {
      registry.register('viewEmployees', ['GET /emps', 'GET /emps/:id']);
      registry.removeRoutes('viewEmployees', ['GET /emps/:id']);
      expect(registry.get('viewEmployees')).toEqual(['GET /emps']);
    });

    it('deletes the access if all routes are removed', () => {
      registry.register('viewEmployees', ['GET /emps']);
      registry.removeRoutes('viewEmployees', ['GET /emps']);
      expect(registry.has('viewEmployees')).toBe(false);
    });

    it('is no-op if access not found', () => {
      expect(() => registry.removeRoutes('nonexistent', ['GET /emps'])).not.toThrow();
    });
  });

  describe('get', () => {
    it('returns routes for existing access', () => {
      registry.register('viewEmployees', ['GET /emps']);
      expect(registry.get('viewEmployees')).toEqual(['GET /emps']);
    });

    it('returns undefined for unknown access', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('returns a copy (mutating returned array does not affect registry)', () => {
      registry.register('viewEmployees', ['GET /emps']);
      const routes = registry.get('viewEmployees')!;
      routes.push('POST /emps');
      expect(registry.get('viewEmployees')).toEqual(['GET /emps']);
    });
  });

  describe('has', () => {
    it('returns true for registered access', () => {
      registry.register('viewEmployees', ['GET /emps']);
      expect(registry.has('viewEmployees')).toBe(true);
    });

    it('returns false for unregistered access', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns the internal Map', () => {
      registry.register('viewEmployees', ['GET /emps']);
      const all = registry.getAll();
      expect(all).toBeInstanceOf(Map);
      expect(all.get('viewEmployees')).toEqual(['GET /emps']);
    });
  });

  describe('clear', () => {
    it('removes all accesses', () => {
      registry.register('a', ['GET /a']);
      registry.register('b', ['GET /b']);
      registry.clear();
      expect(registry.has('a')).toBe(false);
      expect(registry.has('b')).toBe(false);
    });
  });

  describe('loadFrom', () => {
    it('clears existing data and loads from AccessMap', () => {
      registry.register('old', ['GET /old']);
      registry.loadFrom({
        viewEmployees: ['GET /emps', 'GET /emps/:id'],
        manageEmployees: ['POST /emps'],
      });
      expect(registry.has('old')).toBe(false);
      expect(registry.get('viewEmployees')).toEqual(['GET /emps', 'GET /emps/:id']);
      expect(registry.get('manageEmployees')).toEqual(['POST /emps']);
    });
  });

  describe('toJSON', () => {
    it('serializes to plain AccessMap object', () => {
      registry.register('viewEmployees', ['GET /emps']);
      registry.register('manageEmployees', ['POST /emps']);
      const json = registry.toJSON();
      expect(json).toEqual({
        viewEmployees: ['GET /emps'],
        manageEmployees: ['POST /emps'],
      });
    });

    it('returns copies of route arrays', () => {
      registry.register('viewEmployees', ['GET /emps']);
      const json = registry.toJSON();
      json.viewEmployees.push('POST /emps');
      expect(registry.get('viewEmployees')).toEqual(['GET /emps']);
    });
  });
});
