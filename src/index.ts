export { ExpressACL } from './acl';
export { MemoryAdapter } from './adapters/memory.adapter';
export type { ACLAdapter } from './adapters/adapter.interface';
export type {
  ACLOptions,
  RoleDefinition,
  RoleConfig,
  UpdateRoleOptions,
  AuthorizeOptions,
  AccessMap,
  RoleMap,
  UserAssignments,
} from './types';
export {
  CircularHierarchyError,
  LockedError,
  DuplicateError,
  ConfigError,
} from './errors';
