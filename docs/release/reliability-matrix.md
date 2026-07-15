# Packed Extension Reliability Matrix

## Scope

The release gate loads the production WXT build in headless Chromium and covers
fresh install state, candidate update, browser restart, abrupt Manifest V3
worker termination, permission revocation, page reload, SPA route
changes, and open shadow roots.

The predecessor fixture grants synthetic site and provider origins as required
permissions because headless Chromium cannot accept its native optional-host
prompt. The fixture stores two profiles through the real panel workflow. The
candidate then replaces the predecessor at the same path with its original,
unmodified manifest and must retain those origins only as removable optional
grants.

## Invariants

- The fresh candidate has no required host permissions or initial host grants.
- Kept operations contain durable targets and survive candidate update,
  service-worker termination and browser restart.
- Reload and SPA navigation never issue another provider request.
- A held provider response is rejected after another tab becomes active and
  cannot preview or persist changes in either tab.
- Exact-path profiles clear on a nonmatching route and reapply on return.
- Durable locators resolve inside an open shadow root.
- Revocation clears reachable styles, removes dynamic registration, and blocks
  application after reload.
- The candidate manifest is restored byte-for-byte before candidate tests.

## Artifacts

CI retains `.output/packed-artifacts/result.json` for seven days. The allowlisted
report contains stage names, fixed status values, and counts only. It excludes
credentials, provider bodies, page text, storage values, screenshots, traces,
and browser profiles. The harness scans the report for fixed secret/private-data
canaries before writing it.
