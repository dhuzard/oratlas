# Development log

Chronological record of implementation slices, decisions, and verification outcomes.

## PR-00 — Repository initialization

**Objective:** initialize the pnpm TypeScript monorepo with shared tooling so every later
slice can lint, typecheck, and test.

- Created workspace (`apps/*`, `packages/*`), root `package.json` with pinned toolchain,
  strict base `tsconfig`, flat ESLint config (typescript-eslint + react-hooks + prettier),
  Prettier, Vitest root config, `.env.example`, `.gitignore`.
- Wrote `PLAN.md` (backlog + reference-template findings) and `docs/architecture.md`.
- Decision: internal packages export TypeScript source directly (`"main": "src/index.ts"`)
  and are consumed via `transpilePackages` in Next.js — avoids per-package build steps in a
  POC while keeping clean package boundaries.
- Decision: pnpm 10 `onlyBuiltDependencies` allowlist for prisma/esbuild/sharp/tailwind
  oxide so postinstall scripts run.
