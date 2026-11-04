import type { Request, Response } from 'express';
import type { ACLAdapter } from './adapters/adapter.interface';

// --- Constructor options ---

export interface ACLOptions {
  defaultPolicy?: 'deny' | 'allow';
  mutable?: boolean;
  adapter?: ACLAdapter;
}

// --- Role definitions ---

export type RoleDefinition =
  | string[]
  | { inherits?: string; accesses?: string[] }
  | '*';

export interface RoleConfig {
  accesses: string[];
  inherits?: string;
  wildcard?: boolean;
}

export interface UpdateRoleOptions {
  addAccesses?: string[];
  removeAccesses?: string[];
}

// --- Middleware options ---

export interface AuthorizeOptions {
  role?: (req: Request) => string | null | undefined;
  accesses?: (req: Request) => string[] | null | undefined;
  userId?: (req: Request) => string | null | undefined;
  denied?: (req: Request, res: Response) => void;
  basePath?: string;
}

// --- Adapter data shapes (plain objects, serializable) ---

export type AccessMap = Record<string, string[]>;

export type RoleMap = Record<string, RoleConfig>;

export type UserAssignments = Record<string, { roles?: string[]; accesses?: string[] }>;
