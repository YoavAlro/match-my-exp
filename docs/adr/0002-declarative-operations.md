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

Model responses cannot contain executable JavaScript, HTML, event handlers,
remote modules, CSS imports, arbitrary URLs, expressions, or control flow.

## Consequences

New capabilities require a reviewed schema version, executor support, policy,
tests, and module documentation. Unsupported output fails safely. The Chrome
Web Store can evaluate a bounded data model rather than a remote interpreter.
