# ADR 0001: Extension Stack

## Status

Accepted

## Context

The product needs a Manifest V3 side panel, service worker, runtime content
scripts, packaging, strict type checking, and real-extension browser tests.

## Decision

Use WXT with React and strict TypeScript in a single npm package. Use React
state and reducers before considering an external state library. Use direct
Chrome-compatible APIs through WXT's browser facade.

Use Vitest for unit tests, Testing Library and axe for side-panel behavior, and
Playwright with bundled Chromium for packed-extension tests.

## Consequences

WXT owns manifest generation and extension entrypoint packaging. Generated
manifests must be inspected in tests because configuration mistakes can widen
permissions. The project accepts WXT's development dependency surface and will
track unresolved upstream audit findings separately from shipped code.
