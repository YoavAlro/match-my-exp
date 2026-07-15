# Match My Exp Privacy Policy

Last updated: July 15, 2026

## Summary

Match My Exp is a local-first browser extension that lets a user ask a selected
AI provider to propose reversible website adaptations. There is no Match My Exp
cloud account, synchronization service, telemetry service, or advertising.

## Data Processed

After explicit site permission, provider selection, and disclosure acceptance,
the extension may process:

- The current HTTPS origin and path without query string or fragment
- Visible page text
- Semantic names, roles, and allowlisted attributes
- Element geometry and selected computed style values
- The user's chat request and clarification answers
- Validated declarative proposal operations

Passwords, entered form values, scripts, raw HTML, hidden content, query strings,
fragments, frames, and closed shadow roots are excluded from provider context.

## Data Recipients

Page context and requests are sent directly from the extension to the provider
the user selected:

- OpenAI
- Anthropic
- Google Gemini
- A user-configured HTTPS OpenAI-compatible endpoint

The selected destination is shown before consent. Custom endpoints are operated
by their owner and may have different security, retention, billing, and privacy
practices. Match My Exp does not proxy provider traffic.

## Provider Credentials

Users bring their own API credentials. Provider usage may incur charges under
the provider account. Keys are stored in trusted local extension storage so they
can survive browser restarts.

Browser-local storage is not a hardware or operating-system credential vault.
Keys may be extractable by someone controlling the browser profile, malware, or
DevTools. The extension provides replace, forget, and clear-all controls. Keys
are never sent to website content scripts, visible chat history, logs, telemetry,
or Match My Exp servers.

## Local Retention

- Profiles, revisions, consent, settings, and credentials use local extension
  storage.
- Visible user and assistant messages use local IndexedDB.
- Extracted page context, hidden prompts, complete provider requests, complete
  provider responses, authorization headers, and provider error bodies are not
  retained.

Saved profiles reapply deterministically without contacting an AI provider.

## User Control and Deletion

Users can disable or delete profiles, revoke a site's permission, delete one or
all conversations, forget provider credentials, and clear provider settings.
Revocation stops future inspection and profile application for that origin.

Uninstalling the extension removes extension-local data according to Chrome's
extension data behavior.

## Security

The extension uses Manifest V3, packaged code, optional per-origin access,
strict model-output schemas, bounded context, redacted errors, and no remote
executable code. No security mechanism eliminates all browser-profile or
provider risk.

## Changes

Material changes to collected data, recipients, or retention require an updated
policy and in-product disclosure before release.
