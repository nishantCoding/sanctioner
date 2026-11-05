export { ACLite } from './acl';
export { MemoryAdapter } from './adapters/memory.adapter';
export type { ACLAdapter } from './adapters/adapter.interface';
export type {
  ACLOptions,
  CheckOptions,
  RoleDefinition,
  RoleConfig,
  UpdateRoleOptions,
  AuthorizeOptions,
  AccessMap,
  RoleMap,
} from './types';
export {
  CircularHierarchyError,
  LockedError,
  DuplicateError,
  ConfigError,
} from './errors';
