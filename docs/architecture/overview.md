# Architecture Overview

## System Shape

Match My Exp is a single-package Chrome Manifest V3 extension built with WXT,
React, and strict TypeScript.

```text
Side Panel
    |
Typed Messages
    |
Service Worker -------- Provider APIs
    |                        |
    |                   Credential Vault
    |
Content Script -------- Page DOM and Open Shadow Roots
    |
Validated Transform Engine

Service Worker -------- Profiles and Settings
Side Panel ------------ Conversation History
```

The service worker coordinates privileged operations but owns no durable
in-memory state. The side panel owns presentation state. The content script
owns page inspection and transformation for its current document.

## Runtime Components

### Side Panel

The side panel presents conversations, provider settings, permission prompts,
change summaries, previews, profile controls, and repair flows. It communicates
through versioned messages and never manipulates a website directly.

### Service Worker

The service worker validates messages, coordinates tabs, retrieves credentials,
calls provider APIs, persists profiles, reconciles site permissions, and
registers content scripts. Event listeners are registered synchronously and
all durable state is read from storage.

### Content Script

The content script runs in an isolated world. It extracts minimized page
context, assigns ephemeral target references, resolves durable locators,
preflights operations, applies previews, records rollback state, and reapplies
saved profiles.

### Provider APIs

Provider adapters use direct `fetch` from the service worker. Adapters own
provider-specific authentication and request formats. A shared transport owns
HTTPS enforcement, timeouts, cancellation, response limits, redirect policy,
and error redaction.

## Modules

| Module        | Responsibility                                                      |
| ------------- | ------------------------------------------------------------------- |
| `contracts`   | Versioned profile, proposal, operation, target, and message schemas |
| `inspection`  | Bounded, privacy-filtered page context extraction                   |
| `targeting`   | Ephemeral references, durable locators, and exact resolution        |
| `transforms`  | Preflight, apply, journal, rollback, and health diagnostics         |
| `profiles`    | Profile matching, specificity, revisions, and health state          |
| `providers`   | Provider adapters, transport, and normalized responses              |
| `persistence` | Profile, settings, credential, and conversation repositories        |
| `permissions` | Origin grants and dynamic content-script reconciliation             |
| `chat`        | Conversation, proposal, draft, and preview orchestration            |
| `sidepanel`   | Accessible React presentation and interaction                       |

Each module exposes a narrow public API through `index.ts`. Cross-module imports
must not reach internal files.

## Dependency Direction

`contracts` has no product-module dependencies. Browser and provider adapters
depend on contracts rather than the reverse. Entrypoints compose modules and
connect platform APIs.

The transform engine depends on targeting contracts but not provider or chat
implementations. Profile application remains deterministic and independent of
AI availability.

## Proposal Flow

1. The side panel requests a new proposal for the active tab.
2. The worker verifies tab identity, origin permission, provider permission,
   and user consent.
3. The content script returns a bounded semantic representation with ephemeral
   target references.
4. The worker sends the user message and page context to the provider.
5. The provider returns a user-facing response and structured operations.
6. Runtime schemas reject malformed, excessive, or unsupported output.
7. The content script resolves every required target before making changes.
8. The transform engine applies the proposal atomically and records a journal.
9. The user retains the preview as part of a draft or rolls it back.

Navigation or a tab change invalidates an outstanding response. Model output
never directly triggers privileged browser actions.

## Targeting

The current page context uses ephemeral references so a preview targets the
exact inspected node. Saving compiles those references into durable target
specifications based on stable attributes, role, accessible name, structural
anchors, and bounded selector fallbacks.

Open shadow roots are represented as a chain of host targets followed by the
inner target. Movement across document or shadow-root boundaries is rejected.

Every required target must resolve exactly once. Missing or ambiguous targets
fail preflight and produce no mutations.

## Transformations

Transformations are finite, versioned data. The extension does not accept
JavaScript, HTML, event handlers, URLs, expressions, or control flow from a
model.

Style operations use allowlisted declarations and reject network-bearing CSS.
Move operations preserve existing nodes and event listeners. ARIA operations
use an explicit policy and semantic validation. Keyboard actions are limited to
focus and scroll behavior and do not intercept editable controls.

Every operation is idempotent and reversible. A mixed-operation profile is
preflighted completely before its transaction begins.

## Profiles

A profile owns its origin, path pattern, intent summary, conversation
reference, operations, shortcuts, revision, and health state. Query strings and
fragments do not participate in matching.

The most specific path pattern wins. Saving a pattern that ties with an
existing pattern requires the user to replace or edit it, preventing ambiguous
resolution.

Saved profiles are applied without a provider request. A failed settled-page
preflight changes nothing, marks the profile as needing repair, and disables it
until the user reviews a repaired preview.

## Dynamic Pages

Content scripts observe history navigation, added subtrees, and newly attached
open shadow roots. Work is batched and ignores extension-owned mutations.
Targets are resolved within bounded settling windows rather than through
unbounded rescans.

## Storage

| Data                      | Storage                            | Content-script access |
| ------------------------- | ---------------------------------- | --------------------- |
| Profiles and revisions    | `chrome.storage.local`             | No                    |
| Settings and consent      | `chrome.storage.local`             | No                    |
| Provider credentials      | `chrome.storage.local`             | No                    |
| Visible conversations     | IndexedDB                          | No                    |
| Preview and request state | Memory or `chrome.storage.session` | No direct access      |

Local extension storage is restricted to trusted extension contexts. Content
scripts request only the profile and operation data required for their own tab.

## Permissions

Installation requests `activeTab`, `scripting`, `sidePanel`, and `storage`.
Website access is optional and granted one HTTPS origin at a time. Official
provider origins and configured compatible origins are requested only when the
user configures that provider.

Revoking an origin removes future content-script registration and prevents
profile application. Existing extension-owned changes are rolled back when the
extension can still reach the page.

## Failure Policy

- Invalid model output is rejected before page execution.
- Ambiguous targeting requests clarification.
- Partial profile application is prohibited.
- Stale tab or navigation responses are discarded.
- Provider errors expose actionable, redacted messages.
- Permission loss stops collection and application.
- Storage migrations fail without deleting the previous data.
