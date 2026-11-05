# Future: Managed Mode

Deferred from v1. To be considered for a future major version.

---

## Concept

Library stores user → role/accesses assignments internally. JWT only needs to carry a userId. The library looks up what roles/accesses the user has and checks against the precomputed Set.

**Pass-through (current v1):** identity comes from JWT via extractor.
**Managed (future):** identity stored in library, looked up by userId.

---

## API

```typescript
// Store assignments (e.g., from admin dashboard API)
await acl.assignRole('user123', 'admin');
await acl.assignAccesses('user123', ['viewEmployees']);
await acl.removeRole('user123', 'admin');
await acl.removeUserAssignment('user123');

// Middleware uses userId extractor
app.use(acl.authorize({
  userId: (req) => req.decoded.userId,
}));

// check() with userId
acl.check({ method: 'GET', path: '/enterprises/emps', userId: 'user123' });
```

---

## How it works

- `assignRole('user123', 'admin')` → stores `{ roles: ['admin'] }` for user123
- `assignAccesses('user123', ['viewEmployees'])` → stores `{ accesses: ['viewEmployees'] }` for user123
- A user can have both roles AND standalone accesses
- On check: look up user → iterate their roles + accesses → check each against `allowed` Set
- Complexity: O(R + A) where R = user's roles, A = user's accesses

---

## Additional types needed

```typescript
interface CheckOptions {
  // ... existing fields
  userId?: string;
}

interface AuthorizeOptions {
  // ... existing fields
  userId?: (req: Request) => string | null | undefined;
}

type UserAssignments = Record<string, { roles?: string[]; accesses?: string[] }>;
```

---

## Adapter changes

```typescript
interface ACLAdapter {
  // ... existing methods
  saveUserAssignment(userId: string, assignment: { roles?: string[]; accesses?: string[] }): Promise<void>;
  removeUserAssignment(userId: string): Promise<void>;

  // loadAll returns users too
  loadAll(): Promise<{ accesses: AccessMap; roles: RoleMap; users: UserAssignments }>;
}
```

---

## ACL class changes

```typescript
class ACL {
  private userAssignments: Map<string, { roles?: string[]; accesses?: string[] }>;

  async assignRole(userId: string, role: string | string[]): Promise<void>;
  async assignAccesses(userId: string, accesses: string[]): Promise<void>;
  async removeUserAssignment(userId: string): Promise<void>;
  getUserAssignment(userId: string): { roles?: string[]; accesses?: string[] } | undefined;
}
```

---

## Priority rule

If `userId` extractor is provided and returns a value → managed mode (library lookup).
Otherwise → falls back to `role` / `accesses` extractors (pass-through).

---

## Motivation for deferral

- Most apps already store user → role in their own DB
- Duplicates application-layer responsibility
- Adds complexity: adapter methods, user assignment storage, removeRole overload ambiguity
- Can be added as a non-breaking feature in a future version (new methods, extended CheckOptions/AuthorizeOptions)

---

## When to consider adding

- Users request it
- Use cases emerge where immediate revocation without JWT reissuance is critical and the app has no other mechanism
- Redis adapter is stable and user assignment sync is straightforward to add on top
