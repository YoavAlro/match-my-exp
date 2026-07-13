# Chat-Only Targeting Benchmark

## Status

Passed on July 13, 2026.

The accepted campaign selected exact targets for 25 of 25 frozen tasks, asked a
valid clarification for all five intentionally ambiguous tasks, and performed
zero probe mutations on ambiguous initial turns.

This passes the M0-05 feasibility gate. It does not establish a population-wide
100 percent success rate or provider parity.

## Question

Can a model use only a user request and minimized semantic page context to
identify exact ephemeral page elements across representative page structures,
with at most one clarification and no silent ambiguous mutation?

## Method

The version-controlled benchmark under `benchmarks/targeting` contains:

- 25 tasks split evenly across static, SPA, repeated, responsive, and
  open-shadow categories
- One intentionally ambiguous task in every category
- Five multi-target tasks and exact unordered-set scoring
- Six Chromium-rendered fixture states
- Opaque case-scoped element identifiers
- Separate DOM oracle keys that never enter model context
- A 250-element and 64 KiB extraction budget
- Privacy sentinels for hidden, script, form-value, and closed-shadow content
- A target probe that mutates only after a valid selection resolves exactly

Direct tasks must select the exact target set on turn one. Ambiguous tasks must
ask an interrogative question containing predeclared candidate labels, return no
target IDs on turn one, and select the exact target after one scripted
natural-language answer.

Provider errors, malformed output, unknown IDs, wrong targets, irrelevant
clarifications, and timeouts remain in the denominator. The campaign performs
no semantic retries.

## Gate

| Requirement                      | Threshold          | Accepted result          |
| -------------------------------- | ------------------ | ------------------------ |
| Success within one clarification | At least 23 of 25  | 25 of 25                 |
| Per-category success             | At least 4 of 5    | 5 of 5 in every category |
| Expected initial clarifications  | 5 of 5             | 5 of 5                   |
| Ambiguous initial-turn mutations | 0                  | 0                        |
| Provider model consistency       | One returned model | `gpt-5.6-luna`           |

The accepted evidence is
[`azure-gpt-5.6-luna-run-4.json`](../../benchmarks/targeting/evidence/azure-gpt-5.6-luna-run-4.json).
It records source commit `9e5a4de`, prompt, corpus, and context hashes, bounded
structured decisions, hashed provider response IDs, model metadata, and category
totals. It contains no endpoint, credential, authorization header, raw provider
envelope, or hidden reasoning.

## Campaign History

The harness was committed before the first live call. Failed campaigns remain
versioned:

1. [Run 1](../../benchmarks/targeting/evidence/azure-gpt-5.6-luna-run-1.json)
   scored 22 of 25. Three valid candidate-specific questions exposed a grader
   that relied on generic keywords and exact trailing punctuation.
2. [Run 2](../../benchmarks/targeting/evidence/azure-gpt-5.6-luna-run-2.json)
   scored 24 of 25. The shadow case still used the generic word `button` rather
   than its two candidate labels.
3. [Run 3](../../benchmarks/targeting/evidence/azure-gpt-5.6-luna-run-3.json)
   scored 24 of 25. A valid question contained bounded Unicode after its question
   mark, exposing a remaining end-of-string assumption.
4. Run 4 used the corrected frozen grading contract and passed 25 of 25.

No prompt, page fixture, expected target, model configuration, or selection
scoring rule was changed during these grader corrections. Each campaign reran
all 25 tasks; no failed semantic response was selectively retried.

## Decision

The minimized context shape is sufficient to proceed to M1-03 for this model and
corpus. Production inspection should preserve:

- Opaque request-scoped identifiers
- Parent and open-shadow host relationships
- Semantic names, roles, bounded text, geometry, and selected styles
- Hidden, script, form-value, raw-HTML, query, fragment, and closed-shadow
  exclusions
- Exact request-bound ID validation before preview
- Clarification without target application when ambiguity remains

The benchmark extractor is prototype evidence, not production code. M1-03 must
replace its accessible-name approximation, formalize truncation and settling,
and run inside the extension's isolated content-script boundary.

## Limitations

- The corpus is synthetic and small. The result is not a confidence interval for
  arbitrary websites or requests.
- Only the Azure `gpt-5.6-luna` deployment was tested.
- SPA evidence captures a settled client-side navigation state; it does not test
  ongoing mutation settling.
- Open shadow roots are included; closed roots and frames remain excluded.
- The probe validates target routing only. It does not prove CSS execution,
  transaction atomicity, rollback, durable locators, or MV3 provider networking.
- Clarification relevance uses frozen interrogative and candidate-label checks,
  not a general semantic judge.

These limitations become explicit regression and product-validation work in M1,
M2, and the later beta program rather than being inferred as solved by M0-05.
