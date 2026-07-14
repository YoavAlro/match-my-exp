# Targeting Module

## Purpose

Compile exact ephemeral preview references into bounded durable semantic targets
and resolve them exactly on later visits.

## Responsibilities

- Compile stable attributes, role, accessible name, tag, structural path, and a
  safe ID selector fallback
- Represent every open-shadow boundary as an explicit host anchor
- Resolve selector, semantic, and structural strategies in priority order
- Require every host and final target to resolve exactly once
- Fail without mutation on missing, ambiguous, stale, closed-root, or malformed
  targets

## Public API

`compileDurableTarget` accepts a private `PageInspection` registry and an
ephemeral reference. `resolveDurableTarget` accepts a document and untrusted
durable target data, reparses the shared contract, and returns resolved, missing,
or ambiguous.

## Invariants

- Model-generated ephemeral IDs never become selectors.
- Only locally observed stable attributes are compiled.
- Selector fallback is limited to a simple safe ID.
- Open-shadow host chains are explicit and ordered outermost to innermost.
- Closed roots and frames are unsupported.
- Resolution never mutates the page.
- Structural paths are fallback evidence; stable semantic strategies can survive
  reordering.

## Dependencies

The module depends on shared target contracts, the private inspection registry,
and `dom-accessibility-api`. Profile matching, transforms, persistence, and
repair remain separate responsibilities.

## Failure Behavior

Compilation throws fixed `DurableTargetError` codes for stale or unsupported
ephemeral references. Resolution returns `missing` or `ambiguous` and never
chooses an arbitrary candidate.

## Tests

Tests cover stable compilation, semantic reordering, repeated ambiguity,
missing targets, nested open-shadow chains, cross-root isolation, closed-root
rejection, and structural fallback.
