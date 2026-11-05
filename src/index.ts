export { ACLite } from './acl';
export { MemoryAdapter } from './adapters/memory.adapter';
export { RedisAdapter } from './adapters/redis.adapter';
export type { RedisAdapterOptions, RedisClient } from './adapters/redis.adapter';
export type { ACLAdapter } from './adapters/adapter.interface';
export type {
  ACLOptions,
  CheckOptions,
  RoleDefinition,
  RoleConfig,
  UpdateRoleOptions,
  AccessMap,
  RoleMap,
} from './types';
export {
  CircularHierarchyError,
  LockedError,
  DuplicateError,
  ConfigError,
} from './errors';
