# AGENTS.md

TypeScript CLI and library for merging, validating, and converting [ORD Overlay](https://open-resource-discovery.github.io/specification/spec-v1/interfaces/overlay) documents — a format for patching OpenAPI, AsyncAPI, OData, and other resource definitions without modifying the originals.

## Verify Loop

After every non-trivial change, run:

```bash
npm run check
```

This runs three steps in order and fails fast:

1. `npm run lint` — Biome linter
2. `npm run format:check` — Biome formatter (read-only, no auto-fix)
3. `npm test` — TypeScript build + all tests via `node --test`

**Subsets** (faster feedback during development):

```bash
npm run test:merge     # merge module only
npm run test:validate  # validate module only
npm run test:convert   # convert module only
```

**Auto-fix formatting:**

```bash
npm run format         # rewrites files in place
```

## Key Conventions

- **Node >= 22** required (see `.nvmrc`)
- **No `dist/` edits** — compiled output only, never edit by hand
- Tests live in `tests/`, fixtures in `tests/fixtures/`
- Selectors and patch logic: `src/merge/`; public API: `src/index.ts`
- Add tests for new selector types or patch behaviors before marking done
