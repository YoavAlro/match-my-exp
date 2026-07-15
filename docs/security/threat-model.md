# Privacy and Security Threat Model

## Scope

This review covers credentials, messages, page content, model output,
permissions, storage, transforms, provider transport, and the compiled Manifest
V3 package.

## Trust Boundaries

- Website DOM and text are untrusted and may contain prompt injection.
- Model output is untrusted until strict runtime schemas and semantic policy
  accept it.
- Content scripts are isolated but share DOM with the page.
- Side panel and service worker are trusted extension contexts.
- Provider endpoints receive only explicitly consented minimized context.
- Local browser storage is extractable by the browser profile, malware, or
  DevTools and is not presented as a credential vault.

## Controls

### Credentials

- Credentials use one trusted local-storage aggregate.
- Content messages, settings status, errors, logs, evidence, and visible history
  never contain credential values.
- Settings expose only presence and a short SHA-256 identifier.
- Compatible-origin changes clear the bound credential.
- Forget and clear-all paths are tested.

### Page Data

- Inspection requires optional site permission and provider-specific consent.
- Hidden trees, scripts, styles, raw HTML, form values, query strings,
  fragments, frames, and closed shadow roots are excluded.
- Context is bounded to 250 elements and 64 KiB.
- Visible conversations do not persist extracted context or hidden prompts.

### Messages

- Coordination validates schema version, payload size, extension sender, tab,
  top frame, URL, request ID, document ID, and route epoch.
- Stale tab or navigation responses fail closed.
- Content scripts receive only the selected profile or preview operations needed
  for their own document.

### Model Output

- Strict contracts reject unknown kinds, fields, versions, counts, executable
  syntax, URLs, generated content, and malformed targets.
- Provider JSON Schema guides generation but is never the runtime authority.
- Every required target resolves exactly once before mutation.
- Store-sensitive operation kinds remain finite packaged handlers.

### Transforms

- Style rules use allowlisted declarations and exact extension-owned tokens.
- Movement uses state-preserving `moveBefore()` and same-root markers.
- ARIA policy rejects unsafe roles, references, and hiding focused content.
- Keyboard handlers require modifiers, reject conflicts, ignore editable
  controls, and expose only focus or scroll actions.
- Mixed apply compensates completed primitives in reverse order.
- Page-authored write conflicts win during rollback.

### Provider Transport

- Official adapters use fixed HTTPS origins, bounded payloads, `store: false`
  where supported, cancellation, timeout, redirect rejection, and redacted
  errors.
- Compatible endpoints require explicit canonical origin, model,
  authentication, schema dialect, and storage capability.
- Retries are visible, transient-only, and capped at three attempts.

### Package

- Manifest V3 required host permissions are empty; site/provider origins remain
  optional.
- Compiled artifacts are scanned for eval, Function constructors, remote script
  tags, remote imports, secret patterns, and unexpected permissions.
- Build and production dependency audits run in CI.

## Adversarial Coverage

Automated tests cover prompt-like page text, hidden/form data leakage, spoofed
senders, stale messages, hostile model fields, malformed provider responses,
target ambiguity, cross-root movement, CSS resource syntax, ARIA misuse,
keyboard conflicts, migration failure, storage pressure, rollback interruption,
and page-authored concurrent mutation.

## Accepted Residual Risks

- Browser-local provider credentials are extractable from a compromised profile.
- Page MutationObservers can observe preview and compensation mutations.
- A malicious page can copy extension-owned DOM style tokens after application.
- Closed roots and frames cannot be adapted.
- Provider policies, retention, and model behavior can change independently.
- Store policy classification of rich remote declarative operations remains
  subject to reviewer discretion.
- Manual screen-reader and participant beta evidence remains a release gate.

These risks are disclosed to users or reviewers and do not bypass explicit
release gates.
