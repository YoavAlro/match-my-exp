# Accessibility-Focused Beta Protocol

## Objective

Evaluate whether repeated saved styling profiles reduce real barriers without
introducing safety, privacy, or accessibility regressions. This is product
research, not a claim of WCAG conformance or medical benefit.

## Participants

Recruit consenting adults who regularly encounter web barriers related to
vision, cognition, attention, or screen-reader use. Include at least one
keyboard-only participant and one screen-reader participant before treating the
beta as accessibility evidence.

Participants use disposable test accounts or non-sensitive public pages. They
must not expose passwords, payment details, health information, private
messages, or employer/customer data to the extension or researcher.

## Entry Gate

- The exact Store candidate commit and SHA-256 digest are recorded.
- `npm run check` and the manual accessibility protocol pass.
- Each provider destination, retention policy, and possible provider charge is
  disclosed before consent.
- Participants know how to discard a preview, remove site permission, and
  uninstall the extension.
- A facilitator can immediately stop a session and restore the original page.

## Session Tasks

1. Identify one recurring visual barrier on a supported HTTPS site.
2. Describe the desired change without facilitator rewriting.
3. Review any clarification, preview the result, and decide whether to keep it.
4. Reload and revisit the page to verify local deterministic reuse without an AI
   request.
5. Repeat the task on at least two different days or work sessions.
6. Exercise discard and site-permission revocation.
7. For assistive-technology users, repeat core navigation before preview, during
   preview, after Keep, and after rollback.

## Measures

Record counts and participant statements, not raw page content or provider
payloads.

| Measure                | Definition                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| First-attempt quality  | Participant keeps the first preview without correction           |
| Clarification burden   | Number of clarification turns before a usable preview            |
| Correction burden      | Number of discarded previews or rewritten requests               |
| Time to useful preview | Participant-observed minutes from request to decision            |
| Daily reuse            | Matching-page visits where the saved profile remains useful      |
| Barrier reduced        | Participant describes the original task as easier or possible    |
| Regression             | Visual, keyboard, semantic, performance, or task-completion harm |
| Recovery success       | Discard or revocation restores an acceptable original state      |

## Severity And Stop Rules

- P0: credential/page-data disclosure, unexpected activation, inaccessible
  rollback, persistent corruption, hidden focused content, or inability to stop
  extension access. Stop all sessions and block submission.
- P1: repeatable loss of task completion, focus, announcements, controls, or
  deterministic profile behavior. Pause the affected capability and block public
  release until resolved.
- P2: recoverable confusion, excess clarification, poor targeting, or cosmetic
  regression. Record and prioritize before broader beta.
- P3: preference or documentation improvement with no task or safety impact.

## Evidence Record

Use participant codes instead of names. Store consent separately from findings.
Do not retain screenshots, recordings, URLs with private paths, raw requests,
credentials, browser profiles, or extracted page context in the repository.

| Field                                 | Result  |
| ------------------------------------- | ------- |
| Candidate commit and digest           | Pending |
| Participant code and access need      | Pending |
| Browser, OS, and assistive technology | Pending |
| Supported site category               | Pending |
| Sessions and dates                    | Pending |
| First-attempt quality                 | Pending |
| Clarification and correction burden   | Pending |
| Daily reuse                           | Pending |
| Barrier reduced                       | Pending |
| Regressions and severity              | Pending |
| Recovery result                       | Pending |
| Release recommendation                | Pending |

## Exit Decision

Public submission remains blocked if any P0 or unresolved P1 exists. A positive
decision requires repeated useful reuse, successful recovery, no unexplained
provider calls during reapplication, and explicit evidence from keyboard and
screen-reader participants. Report negative or inconclusive findings; do not
convert missing participants into a pass.
