# Engineering Guide

## Product

Match My Exp is a local-first Chrome extension that lets individuals adapt
website experiences through chat. Saved profiles are deterministic and do not
require an AI request when reapplied.

## Principles

- Keep implementations simple and responsibilities narrow.
- Apply SOLID principles at real module and platform boundaries.
- Do not add inline comments to source code or tests.
- Use descriptive names and module documentation instead of inline comments.
- Never execute model-generated JavaScript, HTML, or remote code.
- Treat model output, page content, and extension messages as untrusted input.
- Keep provider credentials out of content scripts, messages, logs, and history.
- Prefer the smallest correct change and avoid speculative abstractions.

## Modules

Each responsibility-owning module lives under `src/modules/<name>/` and has a
colocated `README.md`. The document defines:

- Purpose and responsibilities
- Public API
- Owned contracts and data
- Invariants and security boundaries
- Dependencies
- Failure behavior
- Test strategy

Cross-module imports use the public `index.ts` entrypoint. Update module
documentation in the same change as public behavior or contract changes.

## Commands

```bash
npm run dev
npm run lint
npm run test
npm run test:coverage
npm run typecheck
npm run build
npm run check
```

## Git

Commit verified units of work directly to `main`. Use concise imperative commit
messages and push each coherent milestone so the history remains useful.
