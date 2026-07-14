# Runtime Module

## Purpose

Coordinate trusted extension contexts with the active top-frame document through
a versioned, bounded message boundary.

## Responsibilities

- Derive current-site readiness from active-tab metadata without reading page
  content
- Track a monotonic epoch across tab switches, navigation, and removal
- Validate side-panel sender identity before serving readiness
- Capture tab, origin, path, and epoch for page requests
- Validate content responses against extension ID, tab, top frame, URL,
  document, request ID, schema version, and payload size
- Reject stale responses after tab or route invalidation

## Public API

`installRuntimeCoordination` registers the background listeners.
`ActiveTabCoordinator` exposes the pure state machine for orchestration and
tests. `handlePanelReadinessRequest` is the bounded request handler.

## Invariants

- Readiness uses tab metadata only and never injects or inspects page content.
- Only top-frame HTTPS pages without URL credentials are ready.
- Query strings and fragments do not participate in document identity.
- Every identity change increments the epoch.
- A stale epoch, tab, origin, path, frame, sender, request, or document ID fails
  closed.
- Oversized and cyclic messages fail before schema parsing.

## Dependencies

The module depends on shared contracts and a narrow browser runtime/tabs adapter.
Permissions, page inspection, providers, transforms, and panel presentation
remain separate responsibilities.

## Failure Behavior

Untrusted, malformed, oversized, or stale messages return no response. A page
request on an unready tab throws before any content-script work begins.

## Tests

Tests cover supported and unsupported pages, sender trust, payload bounds,
version and request validation, tab/frame/document matching, epoch invalidation,
and listener installation.
