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

| Ticket | Issue                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------- |
| M0-01  | [Bootstrap extension repository](https://github.com/YoavAlro/match-my-exp/issues/2)             |
| M0-02  | [Document product and data boundaries](https://github.com/YoavAlro/match-my-exp/issues/3)       |
| M0-03  | [Define versioned domain contracts](https://github.com/YoavAlro/match-my-exp/issues/5)          |
| M0-04  | [Validate Chrome Web Store operation policy](https://github.com/YoavAlro/match-my-exp/issues/9) |
| M0-05  | [Benchmark chat-only page targeting](https://github.com/YoavAlro/match-my-exp/issues/8)         |
| M0-06  | [Prove atomic preview and rollback](https://github.com/YoavAlro/match-my-exp/issues/4)          |
| M0-07  | [Validate BYOK provider networking](https://github.com/YoavAlro/match-my-exp/issues/10)         |
| M0-08  | [Establish automated quality checks](https://github.com/YoavAlro/match-my-exp/issues/1)         |

## M1: Styling Vertical Slice

Deliver a complete path from side-panel chat through minimized page inspection,
one provider, validated style operations, preview, undo, and local visible chat
history.

| Ticket | Issue                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------- |
| M1-01  | [Coordinate side panel and active tab](https://github.com/YoavAlro/match-my-exp/issues/11)          |
| M1-02  | [Request site access and page-data consent](https://github.com/YoavAlro/match-my-exp/issues/12)     |
| M1-03  | [Extract minimized semantic page context](https://github.com/YoavAlro/match-my-exp/issues/13)       |
| M1-04  | [Implement credential vault and OpenAI adapter](https://github.com/YoavAlro/match-my-exp/issues/15) |
| M1-05  | [Validate and compile style operations](https://github.com/YoavAlro/match-my-exp/issues/14)         |
| M1-06  | [Persist visible conversation history](https://github.com/YoavAlro/match-my-exp/issues/16)          |
| M1-07  | [Implement proposal preview workflow](https://github.com/YoavAlro/match-my-exp/issues/18)           |
| M1-08  | [Test the styling vertical slice](https://github.com/YoavAlro/match-my-exp/issues/19)               |
| M1-09  | [Submit early unlisted Store build](https://github.com/YoavAlro/match-my-exp/issues/17)             |

## M2: Saved Profiles

Compile durable locators, save versioned profiles against path patterns, and
reapply exactly one profile across reloads, SPA navigation, and open shadow-root
updates.

| Ticket | Issue                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------- |
| M2-01  | [Compile and resolve durable locators](https://github.com/YoavAlro/match-my-exp/issues/21)           |
| M2-02  | [Persist versioned profiles and revisions](https://github.com/YoavAlro/match-my-exp/issues/20)       |
| M2-03  | [Resolve editable path patterns](https://github.com/YoavAlro/match-my-exp/issues/22)                 |
| M2-04  | [Save drafts as inspectable profiles](https://github.com/YoavAlro/match-my-exp/issues/23)            |
| M2-05  | [Reconcile site permissions and content scripts](https://github.com/YoavAlro/match-my-exp/issues/24) |
| M2-06  | [Automatically apply resolved profiles](https://github.com/YoavAlro/match-my-exp/issues/25)          |
| M2-07  | [Reapply across SPA and shadow updates](https://github.com/YoavAlro/match-my-exp/issues/26)          |
| M2-08  | [Manage profiles and permission revocation](https://github.com/YoavAlro/match-my-exp/issues/27)      |

## M3: Rich Capabilities

Add reversible same-root movement, conservative ARIA operations, safe keyboard
actions, mixed-operation transactions, drift diagnostics, and user-initiated
repair.

| Ticket | Issue                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------- |
| M3-01  | [Add reversible same-root movement](https://github.com/YoavAlro/match-my-exp/issues/29)            |
| M3-02  | [Add validated ARIA operations](https://github.com/YoavAlro/match-my-exp/issues/28)                |
| M3-03  | [Add safe page keyboard actions](https://github.com/YoavAlro/match-my-exp/issues/30)               |
| M3-04  | [Apply mixed-operation profiles atomically](https://github.com/YoavAlro/match-my-exp/issues/31)    |
| M3-05  | [Diagnose and disable broken profiles](https://github.com/YoavAlro/match-my-exp/issues/32)         |
| M3-06  | [Repair broken profiles through preview](https://github.com/YoavAlro/match-my-exp/issues/33)       |
| M3-07  | [Validate keyboard and screen-reader behavior](https://github.com/YoavAlro/match-my-exp/issues/34) |

## M4: Provider Parity

Complete Anthropic, Gemini, and HTTPS OpenAI-compatible adapters with common
cancellation, errors, settings, and contract tests.

| Ticket | Issue                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------- |
| M4-01  | [Implement Anthropic adapter](https://github.com/YoavAlro/match-my-exp/issues/36)               |
| M4-02  | [Implement Gemini adapter](https://github.com/YoavAlro/match-my-exp/issues/35)                  |
| M4-03  | [Support HTTPS OpenAI-compatible endpoints](https://github.com/YoavAlro/match-my-exp/issues/37) |
| M4-04  | [Complete provider and key settings](https://github.com/YoavAlro/match-my-exp/issues/38)        |
| M4-05  | [Normalize provider lifecycle behavior](https://github.com/YoavAlro/match-my-exp/issues/39)     |
| M4-06  | [Build provider contract test suite](https://github.com/YoavAlro/match-my-exp/issues/40)        |

## M5: Release

Complete packed-extension testing, security and privacy review, performance
budgets, accessibility-focused beta validation, Store documentation, and public
Chrome Web Store submission.

| Ticket | Issue                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------- |
| M5-01  | [Run packed-extension reliability matrix](https://github.com/YoavAlro/match-my-exp/issues/42)      |
| M5-02  | [Complete privacy and security review](https://github.com/YoavAlro/match-my-exp/issues/41)         |
| M5-03  | [Enforce performance budgets](https://github.com/YoavAlro/match-my-exp/issues/43)                  |
| M5-04  | [Run accessibility-focused beta](https://github.com/YoavAlro/match-my-exp/issues/44)               |
| M5-05  | [Prepare Store privacy and reviewer materials](https://github.com/YoavAlro/match-my-exp/issues/45) |
| M5-06  | [Prepare styling-only Store fallback](https://github.com/YoavAlro/match-my-exp/issues/46)          |
| M5-07  | [Publish Chrome Web Store MVP](https://github.com/YoavAlro/match-my-exp/issues/47)                 |

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
