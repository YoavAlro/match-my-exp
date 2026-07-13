# Module Convention

Each responsibility-owning module has its own directory and a `README.md` that
documents purpose, responsibilities, public API, data ownership, invariants,
dependencies, failure behavior, and test strategy.

Public values and types are exported through `index.ts`. Cross-module imports
use that public entrypoint instead of internal files.

Modules are introduced only when their responsibility exists in working code.
The planned module map is documented in
[`docs/architecture/overview.md`](../../docs/architecture/overview.md).
