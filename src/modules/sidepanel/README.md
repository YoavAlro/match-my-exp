# Side Panel Module

## Purpose

Present the extension's accessible user interface inside Chrome's side panel.

## Responsibilities

- Render product, chat, preview, settings, and profile-management experiences
- Preserve keyboard and screen-reader usability
- Translate user actions into typed application requests
- Present redacted errors and explicit permission or data disclosures

## Public API

`index.ts` exports the `SidePanel` React component.

## Data Ownership

The module owns transient presentation state only. Conversations, profiles,
credentials, permissions, and page state belong to their respective modules.

## Invariants

- The module does not call provider APIs or manipulate website DOM directly.
- Provider credentials are never rendered after entry.
- Interactive behavior remains available by keyboard.
- Status does not rely on color alone.

## Dependencies

The foundation component depends only on React. Future workflows depend on
public chat and contract APIs.

## Failure Behavior

Failures are displayed as actionable, redacted messages. Closing or switching
the panel must not corrupt a preview or durable profile.

## Tests

Component tests verify semantics, visible behavior, and jsdom-compatible axe
rules. Packed-extension tests will cover Chrome-specific interaction and real
browser color contrast.
