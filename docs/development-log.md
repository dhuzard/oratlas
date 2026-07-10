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

## PR-01 — Shared contracts and schemas

**Objective:** dependency-free `@oratlas/contracts` package every other package builds on.

- Zod schemas + types: enums (statuses, roles, compatibility levels, relation types,
  TRUST ordinals/criteria, identifier schemes), identifier syntax (DOI, ORCID, commit SHA,
  GitHub owner/name), safe repo-relative path validation, review manifest v1.0.0,
  extracted-metadata document with field-level provenance and separate manual edits,
  inspection + compatibility reports, structured DOI validation report, knowledge
  artifact records (claims/citations/relations/TRUST JSONL) with bounded JSONL parser,
  evidence packet + grounded answer schema + grounding validator, search queries,
  API error envelope.
- Matching JSON Schema: `packages/contracts/schemas/review-manifest.schema.json`.
- Added `@oratlas/config` (validated server env; refuses mock auth in production,
  requires SESSION_SECRET in production).
- Verified: `pnpm install` ok; vitest 19/19 pass; typecheck clean for both packages.
