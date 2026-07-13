# ADR 0002: Declarative Operations

## Status

Accepted

## Context

An AI model must be able to describe useful page adaptations without turning
remote output into executable extension logic.

## Decision

Model responses use a finite, versioned schema for style, movement, ARIA, and
predefined keyboard operations. The extension validates, compiles, preflights,
applies, and rolls back those operations using packaged code.

No operation field executes or interprets text as JavaScript, HTML, an event
handler, remote module, CSS import, arbitrary URL, expression, or control flow.
User-facing and ARIA values remain untrusted text.

## Consequences

New capabilities require a reviewed schema version, executor support, policy,
tests, and module documentation. Unsupported output fails safely. The submitted
package exposes a bounded data model for review, but Store admissibility remains
a release gate under the remote complex-command rule. The current assessment
and fallback are documented in
[`docs/spikes/chrome-web-store-operation-policy.md`](../spikes/chrome-web-store-operation-policy.md).
