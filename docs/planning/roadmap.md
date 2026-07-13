# Delivery Roadmap

GitHub Issues are the source of truth for status and dependencies. This document
records milestone intent and release gates.

## M0: Foundations and Risk Gates

Establish the repository, product boundary, architecture contracts, CI, and
high-risk feasibility evidence for Store policy, targeting, rollback, and BYOK
provider networking.

Exit criteria:

- Chat-only targeting succeeds on at least 90 percent of benchmark tasks within
  one clarification.
- Ambiguous targets never cause silent mutations.
- Rollback restores all extension-owned fixture changes.
- Every provider can be reached through the intended permission boundary.
- The declarative operation model has an identified Chrome Web Store path or a
  styling-only fallback.

## M1: Styling Vertical Slice

Deliver a complete path from side-panel chat through minimized page inspection,
one provider, validated style operations, preview, undo, and local visible chat
history.

## M2: Saved Profiles

Compile durable locators, save versioned profiles against path patterns, and
reapply exactly one profile across reloads, SPA navigation, and open shadow-root
updates.

## M3: Rich Capabilities

Add reversible same-root movement, conservative ARIA operations, safe keyboard
actions, mixed-operation transactions, drift diagnostics, and user-initiated
repair.

## M4: Provider Parity

Complete Anthropic, Gemini, and HTTPS OpenAI-compatible adapters with common
cancellation, errors, settings, and contract tests.

## M5: Release

Complete packed-extension testing, security and privacy review, performance
budgets, accessibility-focused beta validation, Store documentation, and public
Chrome Web Store submission.

## Definition of Done

- Acceptance criteria cover success, rejection, interruption, and recovery.
- Source and test code contain no inline comments.
- New or changed behavior has regression tests.
- Public module behavior and invariants are documented in its `README.md`.
- Type checking, linting, unit tests, browser tests, and production build pass.
- Sensitive data does not appear in content-script messages, logs, fixtures, or
  test artifacts.
- The issue links its dependencies and updates this roadmap when milestone
  intent changes.
