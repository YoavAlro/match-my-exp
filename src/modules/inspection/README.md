# Inspection Module

## Purpose

Extract bounded, privacy-filtered semantic page context with request-scoped
ephemeral element references.

## Responsibilities

- Traverse the top document and nested open shadow roots
- Exclude hidden trees, scripts, styles, templates, raw HTML, and form values
- Compute accessible names, roles, bounded direct text, selected attributes,
  geometry, and style samples
- Assign opaque request-scoped IDs and retain a private element registry
- Enforce visited-node, captured-element, text, shadow-depth, and serialized-byte
  budgets
- Emit context without query strings or fragments
- Batch route and added-subtree work while observing discovered open shadow roots
- Ignore extension-owned style and marker subtrees

## Public API

`inspectDocument` returns a `PageInspection` containing provider-safe
`PageContext` and a private `resolve` method for local ephemeral target lookup.
Callers supply canonical origin, path, and title from their validated runtime
context.

`DynamicPageCoordinator` observes the document and each known open shadow root,
batches relevant work, and exposes explicit navigation and late-shadow hooks to
the content-script lifecycle adapter.

## Invariants

- Passwords and other form values are never read.
- Closed shadow roots and frames are never traversed.
- Oracle, extension-owned, and arbitrary page attributes are excluded unless
  explicitly allowlisted.
- Parent and shadow-host references always point to earlier included elements.
- IDs are unique within one inspection and are never persisted as durable
  locators.
- Provider context and the private element registry are separate objects.

## Dependencies

The module depends on shared page-context contracts and
`dom-accessibility-api`. Permission, consent, runtime sender validation,
providers, and durable targeting remain separate boundaries.

## Failure Behavior

Invalid location data or duplicate ID generation fails before context is
returned. Payload overflow removes trailing pre-order elements while preserving
reference closure.

## Tests

Tests cover privacy exclusions, accessible semantics, budgets, SPA path state,
open and nested shadow roots, closed roots, opaque ID resolution, and invalid ID
generation. Large-page tests prove inspection and dynamic shadow discovery stop
without materializing unbounded subtrees. The M0 browser benchmark retains real
responsive geometry coverage.
