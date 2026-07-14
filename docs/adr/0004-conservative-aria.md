# ADR 0004: Conservative ARIA Operations

## Status

Accepted

## Context

ARIA can improve names and descriptions, but incorrect semantics can hide
focused content, misrepresent controls, or imply keyboard behavior the page does
not implement.

## Decision

Packaged code accepts only the contract allowlist. Roles are restricted to
landmark, note, status, region, and presentational roles. Presentational roles
are rejected on interactive or focusable elements. `aria-hidden="true"` cannot
target a subtree containing focus. ID-reference attributes require every target
ID to exist in the same document or open shadow root.

Values come only from a validated proposal reviewed in preview. The model cannot
create event handlers or keyboard behavior through ARIA. Rollback restores an
attribute only while it still equals the preview value; page-authored conflicts
win.

## Consequences

The policy intentionally rejects many technically valid role changes. New roles
or attributes require semantic tests, keyboard review, screen-reader evidence,
and an ADR update. Attribute mechanics do not certify WCAG conformance.
