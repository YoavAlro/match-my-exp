# Chat-Only Targeting Benchmark

## Purpose

Measure whether a model can select exact ephemeral element identifiers from a
minimized semantic page context and a user request. This is M0 feasibility
evidence, not production inspection or transformation code.

## Scope

The frozen v1 corpus contains 25 synthetic tasks, five each for static, SPA,
repeated, responsive, and open-shadow pages. Each category includes one request
that must clarify before selecting a target.

Chromium renders every fixture. The benchmark extractor excludes hidden nodes,
scripts, raw HTML, form values, benchmark oracle attributes, query strings,
fragments, and closed shadow roots. Context is limited to 250 elements and 64
KiB even though the shared contract permits larger payloads.

Element identifiers are opaque and case-scoped. Oracle keys remain in the
fixture DOM for scoring but never enter model context.

## Scoring

A direct task passes only when the first response selects the exact unordered
target set. An ambiguity task passes only when the first response asks a
relevant question containing the frozen target discriminators with no target
IDs, the scripted natural-language answer produces the exact target set on turn
two, and the first turn causes zero probe mutations.

The gate requires:

- At least 23 of 25 tasks succeed within one clarification
- At least 4 of 5 tasks succeed in every category
- Every expected ambiguity asks a clarification initially
- Zero mutations occur on ambiguous initial turns
- Unknown IDs, malformed output, provider failures, and wrong answers remain in
  the denominator

The probe only verifies target routing. It does not claim CSS application,
atomic transactions, rollback, durable targeting, or MV3 provider networking.

## Deterministic Tests

`npm test` launches headless Chromium and verifies fixture extraction, context
budgets, privacy sentinels, responsive visibility, SPA navigation, open-shadow
relationships, oracle coverage, exact scoring, and clarification safety.

Mocks and deterministic tests validate the harness but never count toward the
90 percent model gate.

## Live Campaign

Commit the frozen harness before running:

```bash
AZURE_OPENAI_RESPONSES_URL=https://example.openai.azure.com/openai/v1/responses \
AZURE_OPENAI_MODEL=gpt-5.6-luna \
npm run benchmark:targeting
```

`AZURE_API_KEY` must also be present in the environment. The runner refuses a
dirty worktree, performs no semantic retries, redacts provider bodies, and
writes only bounded structured decisions to `evidence/`.

The result applies only to the exact model, prompt, corpus, contexts, and
configuration recorded in the evidence file. It does not establish parity for
other providers or a statistical population guarantee.

## Promotion

M1-03 may promote the proven extraction policy into `src/modules/inspection`.
The benchmark extractor remains a prototype and does not use a complete
accessible-name implementation. M2-01 may reuse these fixtures while rotating
ephemeral IDs to test durable locator compilation.
