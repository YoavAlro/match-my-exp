# Atomic Preview and Rollback

## Status

Passed in Chromium on July 13, 2026.

The M0-06 spike demonstrates complete preflight, synchronous mixed mutation,
reverse compensation, explicit rollback, navigation cleanup, and
conflict-preserving rollback for style, movement, and ARIA operations.

## Decision

Proceed with the journaled transaction architecture.

Use Chrome 133's state-preserving `moveBefore()` for existing-node movement.
Never clone nodes, rebuild HTML, or fall back to remove-and-reinsert movement.

Define atomicity as final-state behavior:

- Every required operation preflights before the first connected DOM write.
- Apply executes synchronously in declared order.
- Any apply failure compensates every completed write in reverse order.
- Cooperative pages return to the exact baseline.
- Conflicting page writes win and produce bounded diagnostics.
- Rollback removes every surviving extension-owned marker.

This does not provide database isolation. Page observers may see both apply and
compensation mutations.

## Evidence

The version-controlled fixture and packaged runtime live under
`benchmarks/preview-rollback`. Ten Playwright/Vitest cases exercise real
Chromium DOM, style, focus, listener, navigation, and open-shadow behavior.

| Requirement                           | Evidence                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Every target resolves before mutation | A valid style operation followed by a missing target rejects with zero mutations; duplicate target IDs also reject.               |
| Reject restores preview state         | Explicit rollback restores exact raw style text, priority, attribute state, node order, focus, and identity.                      |
| Interruption restores preview state   | Failure is injected after each of six primitive writes; every case restores baseline state with no marker leak.                   |
| Navigation restores preview state     | SPA `pushState` triggers synchronous cleanup; `pagehide` restores the old document before traditional navigation.                 |
| Existing nodes and listeners survive  | The exact node object remains live, its direct listener fires after movement, and focus remains on it through apply and rollback. |
| Unrelated page mutations survive      | Page-owned classes, styles, attributes, siblings, and text remain after rollback.                                                 |
| Conflicting page mutations survive    | Same-property style, same-attribute ARIA, and page-owned movement are preserved and reported as conflicts.                        |
| Root safety                           | Same-open-shadow movement succeeds; cross-shadow movement fails before mutation.                                                  |
| Placement correctness                 | `before`, `after`, `inside-start`, and `inside-end` all apply and restore original order.                                         |

The complete repository quality gate runs these browser tests in CI.

## Journal Model

Style entries own one declaration cell and record value, priority, attribute
presence, and raw text. ARIA entries own one attribute cell and record exact
presence and value. Move entries retain the node and parent references plus
source and destination marker identities.

Rollback is compare-and-restore:

1. If the current cell still equals the preview state, restore its original
   state.
2. If the page changed the same cell, preserve the page state and report a
   conflict.
3. Always remove surviving extension markers by identity.

Unrelated page cells are never restored from a whole-element snapshot.

## Production Requirements

M0-06 proves feasibility but does not complete the product executor.

M1-05 must add the production style compiler, stylesheet isolation, full CSS
policy, shorthand footprints, replacement semantics, and hostile values.

M3-01 must add production movement policy, forbidden nodes, rerender handling,
marker loss, custom elements, and durable-target integration.

M3-02 must add ARIA semantic policy and accessibility validation.

M3-04 must add arbitrary mixed-operation planning, multiple move dependencies,
observer coordination, bounded diagnostics, and deterministic ordering.

The preview workflow must bind transactions to sender authorization, tab,
document identity, route epoch, worker recovery, and packed-extension lifecycle.

## Limitations

- One move is allowed per prototype transaction.
- Keyboard operations are excluded.
- Mutation visibility to page observers is not hidden.
- BFCache restoration is not independently proven.
- Main-world test injection does not prove extension isolated-world behavior.
- Frames, closed shadow roots, page replacement of marker nodes, and abrupt
  content-script destruction remain out of scope.

These limitations are explicit downstream acceptance work and are not inferred
as solved by this spike.
