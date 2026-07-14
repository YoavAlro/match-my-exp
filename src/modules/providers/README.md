# Providers Module

## Purpose

Keep credentials inside trusted extension contexts and normalize direct AI
provider requests into validated proposals.

## Responsibilities

- Persist provider credentials in trusted local storage
- Expose only key presence and a non-sensitive digest identifier to settings
- Call fixed official HTTPS origins with bounded requests, timeout,
  cancellation, redirect rejection, and `store: false`
- Supply portable structured-output schema and reparse with the authoritative
  runtime proposal contract
- Normalize usage and fixed redacted error codes

## Public API

`CredentialVault` owns credential set, status, provider-call read, forget, and
clear behavior. `OpenAIProvider`, `AnthropicProvider`, and `GeminiProvider`
normalize their official direct APIs. Fetch and storage are injectable for
deterministic tests.

`CompatibleProvider` requires an explicit canonical endpoint, model,
authentication mode, structured-output dialect, and `store: false` capability;
it never infers behavior from a server response.

`withProviderLifecycle` normalizes bounded transient retries with visible retry
notices. Refusals, malformed responses, cancellation, and unknown failures are
never retried.

`ProviderSettingsService` owns provider/model configuration, validated key
replacement, presence-only status, forget, clear-all, and compatible-origin
reconfirmation.

## Invariants

- Credentials never enter content messages, settings responses, visible
  conversation history, errors, or logs.
- OpenAI requests use only `https://api.openai.com/v1/responses`.
- Page context is validated and marked as untrusted in the packaged prompt.
- Raw provider envelopes and errors are not retained.
- Provider structured output is advisory until `ProposalSchema` accepts it.
- Redirects, oversized payloads, malformed output, refusals, and unknown fields
  fail closed.

## Dependencies

The module depends on shared page/proposal contracts and trusted storage/fetch
adapters. Site permission, consent, page inspection, chat persistence, and
preview execution remain separate responsibilities.

## Failure Behavior

Missing credentials use `ProviderCredentialError`. Requests use fixed
`ProviderRequestError` codes that exclude keys, headers, prompts, page content,
and raw response bodies.

## Tests

Tests cover credential lifecycle and non-disclosure, fixed transport options,
structured success, usage, malformed responses, hostile proposals, HTTP errors,
refusals, cancellation, response limits, and model validation.
