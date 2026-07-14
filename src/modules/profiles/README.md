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

## Public API

`ProfileRepository` exposes aggregate operations over a `ProfileStorageAdapter`.
`ChromeProfileStorage` owns the single trusted `chrome.storage.local` key.
`MemoryProfileStorage` provides deterministic failure and quota behavior for
tests.

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
Path matching, permission reconciliation, UI, automatic application, and repair
orchestration are separate modules or later profile capabilities.

## Failure Behavior

Domain failures throw `ProfileRepositoryError` with a fixed code. Invalid or
cyclic migrations never write. Quota and adapter failures surface as
`storage_write_failed` while the previous stored value remains intact.

## Tests

Tests cover create, isolation, update, disable, delete, restore, revision bounds,
schema rejection, successful and failed migrations, interrupted writes, and
storage pressure.
