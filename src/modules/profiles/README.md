# Profiles Module

## Purpose

Persist validated profile aggregates and bounded revision history in trusted
local extension storage.

## Responsibilities

- Enforce profile, health, operation, and revision schemas at every read/write
- Create, update, disable, delete, and restore profile aggregates
- Retain at most 20 immutable revisions per profile
- Isolate reads by exact profile ID or canonical origin
- Migrate copied state and commit only after complete validation
- Preserve previous state when migration, quota, or storage writes fail
- Compile editable segment wildcards and resolve one profile by specificity
- Reject enabled equal-specificity patterns that can match the same path
- Compile accepted ephemeral drafts into inspectable durable profile reviews
- Require explicit overlap resolution before create or replacement
- Resolve and apply one enabled profile deterministically without an AI request
- Retry bounded settling, distinguish navigation interruption, and disable
  genuine drift with bounded diagnostics
- Offer explicit user-initiated repair through the normal durable review and
  revision path
- List inspectable profile summaries and coordinate disable, delete, and origin
  revocation with reachable rollback

## Public API

`ProfileRepository` exposes aggregate operations over a `ProfileStorageAdapter`.
`ChromeProfileStorage` owns the single trusted `chrome.storage.local` key.
`MemoryProfileStorage` provides deterministic failure and quota behavior for
tests.

`ProfileDraftService` separates prepare/review from save. Its advanced view
contains durable locators and declarations but no credentials or hidden
provider payloads.

`ProfileApplicationService` resolves the current URL, preflights every durable
target, applies style profiles idempotently, and clears active styles on no
match or permission loss.

`ProfileHealthService` retries only missing dynamic targets within a bounded
settling window. Navigation interrupts without health changes; settled failure
creates one disabled `needs-repair` revision.

`ProfileRepairService` discloses the selected provider destination, proposes only
after an explicit user call, preserves rejected disabled revisions, and accepts
repairs as healthy new revisions.

`ProfileManagementService` exposes origin/path/effect summaries and ensures
disable, delete, or revocation clears reachable styles before durable state or
permission changes.

## Invariants

- New profiles start at revision one.
- Updates increment revision exactly once and preserve ID, origin, conversation,
  and creation time.
- Current state is archived before update, disable, or restore.
- Restore creates a new revision rather than rewriting history.
- Storage keys match embedded profile identifiers.
- Unknown fields, credentials, and unrelated data fail schema validation.
- No repository mutation is visible until the adapter write succeeds.

## Dependencies

The module depends on profile contracts and an injected trusted storage adapter.
Permission reconciliation, UI, automatic application, and repair orchestration
are separate modules or later profile capabilities. Pattern resolution is owned
here because it selects the profile aggregate.

## Path Patterns

Patterns use URL path segments. A literal matches itself, `*` matches one
segment, and `**` matches the remaining suffix only when it is the final
segment. Trailing slashes normalize away except for root. Query strings and
fragments are ignored because matching uses `URL.pathname`.

Specificity prefers more literal segments, no rest wildcard, greater depth, and
fewer one-segment wildcards in that order. Enabled overlapping patterns with an
equal specificity tuple are a conflict and must be replaced or edited.

## Failure Behavior

Domain failures throw `ProfileRepositoryError` with a fixed code. Invalid or
cyclic migrations never write. Quota and adapter failures surface as
`storage_write_failed` while the previous stored value remains intact.

## Tests

Tests cover create, isolation, update, disable, delete, restore, revision bounds,
schema rejection, successful and failed migrations, interrupted writes, and
storage pressure. Matching tests cover wildcard behavior, URL canonicalization,
specificity, overlap symmetry, disabled profiles, and equal-rank conflicts.
