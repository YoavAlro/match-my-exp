# Contracts Module

## Purpose

Define the versioned data accepted at every untrusted boundary and shared
between extension runtime components.

## Responsibilities

- Validate model proposals before any page execution
- Validate saved profiles and their durable operations
- Validate minimized page context and runtime messages
- Bound collection sizes and user-controlled strings
- Produce provider-facing JSON Schema from the runtime proposal schema

## Public API

`index.ts` exports Zod schemas and their inferred TypeScript types for page
context, targets, operations, proposals, profiles, coordination, and runtime
messages. It also exports profile health and revision schemas.
`ProposalJsonSchema` is the full
Draft 2020-12 representation. `ProposalProviderJsonSchema` is a portable subset
for OpenAI, Anthropic, Gemini, and compatible provider adapters.

## Owned Contracts

Every top-level persisted, provider, and message envelope has `schemaVersion:
1`; nested contracts inherit the envelope version. Proposal operations use
ephemeral element references produced by one inspection. Profile operations use
durable targets compiled locally after an accepted preview.

A profile revision is a timestamped, immutable profile snapshot. Its envelope
must repeat the snapshot's profile identifier and revision number so storage
repositories can reject incorrectly keyed history.

Operation kinds are limited to style, same-root movement, ARIA attributes, and
predefined keyboard actions. Their presence in the contract does not bypass the
stricter policy and semantic checks owned by the transform module.

## Invariants

- Every object rejects unknown keys.
- Collections and strings have explicit upper bounds.
- Proposal and profile operation identifiers are unique.
- A proposal contains either operations with a null clarification or one
  clarification without operations.
- CSS values cannot load resources or contain executable syntax.
- Canonical origins use HTTPS and contain no path, query, or fragment.
- Durable target anchors contain at least one locating strategy.
- Profiles needing repair are disabled.
- Profile revision envelopes match their snapshots.
- Runtime messages contain no provider credentials.
- Mutation commands are bound to an expected origin and concrete path.
- Content-script commands contain only page identity, identifiers, and
  executable operations.
- Provider schemas constrain generation; every provider response is still
  parsed with `ProposalSchema` before use.

## Dependencies

The module depends only on Zod and browser-standard URL parsing. It does not
depend on browser APIs, React, providers, persistence, or page execution.

## Failure Behavior

Parsing returns structured Zod issues or throws at an explicitly chosen caller
boundary. Invalid data is never repaired or partially accepted by this module.

## Tests

Tests cover representative valid contracts, version mismatches, unknown and
executable fields, unsafe CSS values, oversized collections, ambiguous
proposal shape, duplicate operations, target strategy requirements, profile
timestamps, canonical origins, and generated JSON Schema.
