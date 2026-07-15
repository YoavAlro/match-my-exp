# Performance Module

## Purpose

Define deterministic product budgets for page context, provider input,
observation work, long tasks, layout shift, and packaged extension size.

## Budgets

- 250 inspected elements
- 64 KiB serialized page context
- 32,000 estimated provider input tokens
- 200 added elements per observer batch
- 50 ms maximum synchronous long task
- 0.1 cumulative layout shift per application
- 150 KiB background bundle
- 400 KiB side-panel JavaScript
- 128 KiB content script
- 750 KiB complete unpacked extension

## Public API

Budget assertion helpers return measured values or throw
`PerformanceBudgetError` naming the exceeded budget. The build budget script runs
after every production build in `npm run check`.

## Invariants

- Budget checks are deterministic and credential-free.
- Provider token count is a conservative four-bytes-per-token estimate; adapters
  still record actual provider usage.
- Browser-specific long-task and layout-shift observations are supplied to pure
  assertions rather than making CI timing itself flaky.

## Tests

Tests cover every boundary and rejection path. Existing static, SPA, responsive,
and open-shadow benchmarks exercise the context and observer budgets.
