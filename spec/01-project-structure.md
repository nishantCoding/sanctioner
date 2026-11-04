# Spec 01: Project Structure

## Directory Layout

```
express-acl-o1/
├── src/
│   ├── index.ts                 — public exports
│   ├── acl.ts                   — ExpressACL class (core orchestrator)
│   ├── core/
│   │   ├── access-registry.ts   — access definitions + route mapping
│   │   ├── role-registry.ts     — role definitions + hierarchy + precomputation
│   │   └── lookup.ts            — builds and holds the two runtime maps (routeAccesses, routeRoles)
│   ├── adapters/
│   │   ├── adapter.interface.ts — ACLAdapter interface
│   │   ├── memory.adapter.ts    — MemoryAdapter (default)
│   │   └── redis.adapter.ts     — RedisAdapter (persistence + pub/sub)
│   ├── middleware/
│   │   └── authorize.ts         — authorize() middleware factory
│   ├── types.ts                 — all interfaces and type definitions
│   └── errors.ts                — custom error classes
├── tests/
│   ├── access.test.ts
│   ├── role.test.ts
│   ├── middleware.test.ts
│   ├── memory-adapter.test.ts
│   ├── redis-adapter.test.ts
│   └── edge-cases.test.ts
├── spec/                        — feature specs (this folder)
├── package.json
├── tsconfig.json
└── .gitignore
```

## Dependencies

### peerDependencies
- `express` >= 4.0.0 (user provides their own)

### optionalDependencies
- `ioredis` (only needed if using RedisAdapter)

### devDependencies
- `typescript`
- `@types/express`
- `@types/node`
- `jest`
- `ts-jest`
- `@types/jest`
- `supertest`
- `@types/supertest`

## package.json

- `name`: express-acl-o1
- `version`: 0.1.0
- `main`: dist/index.js
- `types`: dist/index.d.ts
- `files`: ["dist"]
- `scripts.build`: tsc
- `scripts.test`: jest
- `engines.node`: >= 16.0.0

## tsconfig.json

- `target`: ES2020
- `module`: commonjs
- `outDir`: dist
- `rootDir`: src
- `declaration`: true
- `strict`: true
- `esModuleInterop`: true
- `skipLibCheck`: true

## .gitignore

- node_modules/
- dist/
- coverage/
- .env
