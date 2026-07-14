# Atomic Preview and Rollback Spike

## Purpose

Prove that packaged browser code can preflight and reversibly apply a mixed
style, movement, and ARIA preview without rebuilding page content.

This is M0 feasibility evidence. It is not the production transforms module.

## Transaction Boundary

The spike accepts contract-shaped ephemeral operations and permits one active
preview per document. It supports style, move, and ARIA operations. Keyboard
operations are rejected because focus and scroll actions are not meaningfully
reversible.

Preflight resolves every target and destination exactly once, validates page
identity, rejects duplicate write cells, validates CSS with browser semantics,
requires connected nodes, prevents ancestor cycles, and restricts movement to
one `Document` or open `ShadowRoot`. Preflight performs no connected-page writes.

Apply runs synchronously in operation order. Every primitive records a journal
entry before its first write. Any injected or real apply failure immediately
rolls the journal back in reverse order.

## Movement

Movement requires Chrome 133+ and `ParentNode.moveBefore()`. The spike does not
fall back to remove-and-reinsert APIs.

Each move records the existing node, original parent, and three extension-owned
comment markers. The target moves between destination markers while a source
marker retains its original slot. Rollback moves the same node back by reference
and removes all markers.

This preserves node identity, direct listeners, and focus. The spike accepts at
most one move per transaction; arbitrary mixed-move planning remains M3-04.

## Rollback Ownership

Style journals retain original value, priority, attribute presence, and exact
raw `style` text. Uncontended rollback restores the raw attribute exactly. If
the page changes another inline declaration, rollback restores only the owned
property when its current value still equals the preview value.

ARIA journals distinguish absent, empty, and populated attributes. They restore
only when the page has not replaced the preview value.

Movement rolls back only while the node remains between its destination markers.
If the page moves it elsewhere, the page position wins and rollback reports a
conflict. Surviving extension markers are always removed.

## Navigation

The browser runtime listens to the Navigation API and `pagehide`. An active
preview rolls back synchronously when SPA navigation begins. The old document's
journal is never applied to a new route.

## Tests

`preview-rollback.test.ts` runs in Chromium and proves:

- Mixed style, movement, and ARIA apply and exact explicit rollback
- Complete preflight with missing and multiply resolved targets
- All four movement placements
- Reverse compensation at all six primitive mutation boundaries
- Exact raw style and `!important` restoration
- Node identity, direct listener, and focus preservation
- Unrelated class, style, attribute, sibling, and text preservation
- Page-writes-win handling for style, ARIA, and movement conflicts
- SPA navigation rollback
- Traditional `pagehide` cleanup before the old document unloads
- Same-root open-shadow movement and cross-root rejection
- Apply and rollback idempotence by preview ID

## Limitations

- Atomicity means no partial final state after synchronous failure. Page
  MutationObservers can still observe apply and compensation records.
- The prototype supports one move and does not detect shorthand-longhand CSS
  overlap across operations.
- ARIA validation proves attribute mechanics, not semantic accessibility.
- Traditional navigation normally destroys the document; BFCache lifecycle and
  packed-extension recovery remain production work.
- Main-world fixture injection does not prove isolated-world messaging, worker
  restart recovery, dynamic settling, or content-script lifecycle behavior.
- Page writes that exactly equal preview values are indistinguishable from
  extension ownership.
- Custom-element lifecycle behavior, frames, closed shadow roots, keyboard
  actions, and arbitrary multi-move planning are outside this spike.

Production implementations belong in M1-05, M3-01, M3-02, M3-04, and the
preview workflow rather than being promoted directly from this benchmark.
