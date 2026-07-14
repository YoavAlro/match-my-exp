# Transforms Module

## Purpose

Compile validated declarative operations into exact, reversible page changes.

The production surface implements style operations, conservative ARIA
attributes, predefined keyboard focus/scroll actions, and reversible same-root
movement. Mixed rich transactions arrive in M3-04.

## Responsibilities

- Reparse untrusted style operations through the shared contract
- Validate browser CSS support and module-specific policy
- Reject duplicate operation identifiers and overlapping target properties
- Scope CSS rules to exact resolved targets through extension-owned tokens
- Apply, replace, and roll back preview styles synchronously
- Preserve page inline styles, classes, attributes, and unrelated preview tokens
- Reject unsafe ARIA roles, missing references, and hiding focused content
- Apply and compare-and-restore ARIA attributes without overwriting page changes
- Reject reserved/conflicting shortcuts and bypass editable controls
- Resolve keyboard targets dynamically and clean up listeners on disable
- Move existing nodes with state-preserving `moveBefore()` and identity markers
- Preserve page-owned relocation conflicts instead of yanking nodes back
- Apply style, movement, ARIA, and keyboard primitives in deterministic order
- Compensate completed primitives in exact reverse order after any failure

## Public API

`StylePreviewRegistry` owns active style previews for one content-script
document. Callers provide already resolved target elements paired with untrusted
operation objects. `apply`, `replace`, `rollback`, and `rollbackAll` are the only
mutation methods.

## Invariants

- All operations compile before the first DOM write.
- Only shared-contract `style` operations are accepted.
- Every target is connected to a `Document` or open `ShadowRoot`.
- A preview writes at most one declaration for any target/property cell.
- Values containing `!important` are rejected; the packaged executor owns rule
  priority.
- Rules contain only contract-allowlisted properties and values.
- CSS is isolated by an opaque extension-owned target token and root-local style
  element.
- Applying the same preview twice is idempotent; reusing its ID for different
  content fails.
- Invalid replacement leaves the active preview unchanged.
- Rollback removes only owned style elements and tokens.

## Security Boundary

Contract validation rejects unknown properties, resource-bearing syntax,
generated content, braces, comments, escapes, controls, and executable forms.
This module additionally checks browser CSS support and rejects embedded
priority. It never accepts selectors, URLs, HTML, or arbitrary stylesheet text
from a model.

## Dependencies

The module depends only on shared contracts and browser DOM/CSS APIs. Target
resolution, preview orchestration, persistence, and provider behavior remain
outside this boundary.

## Failure Behavior

Compilation errors throw `StylePreviewError` before mutation. Commit failure
removes every token and style element written by that attempt. Rollback of a
missing preview is an idempotent false result.

## Tests

Tests cover exact scoping, document and shadow roots, idempotence, replacement,
rollback, disconnected targets, duplicate writes, excessive output, unsupported
CSS, generated content, URLs, executable syntax, priority injection, and
preservation of unrelated page state.
