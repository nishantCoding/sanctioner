export class CircularHierarchyError extends Error {
  constructor(chain: string[]) {
    super(`Circular hierarchy detected: ${chain.join(' \u2192 ')}`);
    this.name = 'CircularHierarchyError';
  }
}

export class LockedError extends Error {
  constructor(method: string) {
    super(`Cannot call ${method}() on a locked ACL instance`);
    this.name = 'LockedError';
  }
}

export class DuplicateError extends Error {
  constructor(type: 'access' | 'role', name: string) {
    super(`${type === 'access' ? 'Access' : 'Role'} '${name}' is already defined`);
    this.name = 'DuplicateError';
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
