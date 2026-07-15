# Provider Networking

## Browser Model

Provider requests originate only from the Manifest V3 extension service worker.
The side panel stores settings and credentials in trusted local extension
storage. Content scripts receive proposal/profile operations but never provider
credentials, authorization headers, raw provider envelopes, or provider error
bodies.

Before page inspection, the user must approve one optional host-permission
request containing both the exact page origin and selected provider origin. The
trusted worker then rechecks the permission and the page/provider consent record
before every proposal request.

## Destinations And Headers

| Provider   | Origin and endpoint                                                               | Credential header                               | Browser-specific requirements                                                         |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| OpenAI     | `https://api.openai.com/v1/responses`                                             | `Authorization: Bearer <key>`                   | Responses API JSON schema; `store: false`                                             |
| Anthropic  | `https://api.anthropic.com/v1/messages`                                           | `x-api-key: <key>`                              | `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true` |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` | `x-goog-api-key: <key>`                         | Model is path-allowlisted; JSON response schema is requested                          |
| Compatible | User-confirmed canonical HTTPS Responses endpoint                                 | Bearer, `x-api-key`, or `api-key` as configured | OpenAI Responses JSON-schema support and `store: false` are mandatory                 |

The extension requests exact origin patterns such as
`https://api.openai.com/*`; none are required manifest host permissions. The
manifest exposes only optional `https://*/*` capability so Chrome can display
and revoke each user-selected origin grant.

## Request Policy

- Requests use `POST`, JSON bodies, `credentials: omit`, `redirect: error`, and
  `referrerPolicy: no-referrer`.
- Page context contains bounded visible semantic data, current origin/path, and
  allowlisted computed styles. It excludes query strings, fragments, hidden
  content, form values, scripts, and raw HTML.
- Official and compatible structured output is reparsed by the same strict
  proposal contract before any preview operation reaches content.
- Requests use a 60-second abort timeout. Caller cancellation is combined with
  the timeout and normalized to `provider_cancelled`.
- Transport, HTTP, refusal, safety, malformed-output, and size failures become
  fixed error codes. Response bodies and credentials are never included.
- A tab, route, reload, or document change invalidates the request epoch. A late
  response cannot preview or persist operations.

## Live Smoke Record

Run each smoke from the production package in stable Chrome, not from Node. Use
disposable low-quota keys and a synthetic HTTPS page with no private content.

For each provider record:

1. Candidate commit, version, ZIP SHA-256, Chrome version, provider, model, and
   destination origin.
2. Exact optional site/provider grants visible in Chrome.
3. One valid structured style preview and exact rollback.
4. Cancellation before response with no page mutation.
5. A held response followed by navigation with no stale mutation or profile.
6. One malformed response producing only a fixed redacted error.
7. Confirmation that content messages, chat/history storage, console output,
   retained CI artifacts, and the Store ZIP contain no key or authorization
   value.

Do not record keys, raw request bodies, raw responses, extracted page context,
HAR files, browser profiles, screenshots of private pages, or provider account
identifiers. Azure-compatible evidence validates only the compatible path and
cannot substitute for official OpenAI, Anthropic, and Gemini smoke requests.
