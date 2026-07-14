# Chat Module

## Purpose

Persist visible user and assistant conversation messages locally without
retaining extracted page context or hidden provider payloads.

## Responsibilities

- Validate visible conversation aggregates at every storage boundary
- Store only user and assistant text with identifiers and timestamps
- Preserve conversations across panel and browser restarts through IndexedDB
- Delete one conversation or all conversation history
- Migrate copied state only after complete validation
- Preserve previous state after quota, interruption, or migration failure

## Public API

`ConversationRepository` owns create, append, read, list, delete, and delete-all
behavior over a `ConversationStorageAdapter`. `IndexedDbConversationStorage`
stores one atomic state record. `MemoryConversationStorage` provides deterministic
quota and failure behavior for tests.

## Invariants

- Conversations start empty and contain at most 1,000 visible messages.
- Message roles are only `user` and `assistant`.
- Message IDs are unique and timestamps never move backward.
- Strict schemas reject credentials, minimized DOM, hidden prompts, provider
  envelopes, unknown fields, and unrelated records.
- Storage replacement occurs only after complete aggregate validation.

## Dependencies

The module depends only on Zod and an injected storage adapter. Provider calls,
page inspection, prompt construction, and panel orchestration remain outside
the persistence boundary.

## Failure Behavior

Domain failures use fixed `ConversationRepositoryError` codes. Invalid migration
or adapter failure leaves the previous state unchanged. Raw storage and provider
errors are never retained as visible messages.

## Tests

Tests cover browser restart persistence, strict field rejection, append order,
delete one, delete all, migration, quota, and interrupted writes.
