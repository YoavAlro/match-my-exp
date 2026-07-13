# ADR 0003: Local Data and Credentials

## Status

Accepted

## Context

The MVP has no backend. Users bring provider credentials and want them to
survive browser restarts. Full visible conversations should remain available
without retaining extracted page payloads.

## Decision

Persist profiles, settings, consent records, and provider credentials in local
extension storage. Restrict that storage to trusted extension contexts.
Persist visible conversation messages in IndexedDB. Do not persist extracted
page context, hidden prompts, complete provider payloads, or model credentials
in conversation records.

Keep credentials inside a dedicated service-worker repository. Content scripts
and message payloads never receive them. Present clear extractability, billing,
rotation, and deletion disclosures because browser-local persistence is not a
credential vault.

## Consequences

Users receive a low-friction remembered-key experience but must accept the risk
of profile, malware, DevTools, or compromised-extension access. Encryption with
a key stored beside the ciphertext is not presented as meaningful protection.
The product provides forget-key and clear-all controls.
