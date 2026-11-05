import type { Request, Response } from 'express';
import type { ACLAdapter } from './adapters/adapter.interface';

// --- Constructor options ---

export interface SanctionerOptions {
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

// --- Framework-agnostic check ---

export interface CheckOptions {
  method: string;
  path: string;
  role?: string;
  accesses?: string[];
}

// --- Express middleware options ---

export interface AuthorizeOptions {
  role?: (req: Request) => string | null | undefined;
  accesses?: (req: Request) => string[] | null | undefined;
  denied?: (req: Request, res: Response) => void;
  basePath?: string;
}

// --- Adapter data shapes (plain objects, serializable) ---

export type AccessMap = Record<string, string[]>;

export type RoleMap = Record<string, RoleConfig>;
