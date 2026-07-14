# Permissions Module

## Purpose

Request persistent access only for the current supported HTTPS origin and record
provider-specific consent before page context can be collected or transmitted.

## Responsibilities

- Canonicalize supported page origins and reject unsupported schemes or local
  hosts
- Disclose page-data categories and exact provider destination before requesting
  access
- Request one optional host origin at a time
- Bind consent to page origin, provider kind, and provider origin
- Make repeated ready requests idempotent
- Remove host permission and all origin consent on revocation
- Reconcile persistent dynamic content scripts to enabled, still-permitted
  profile origins

## Public API

`SiteAccessService` exposes readiness, request, and revoke operations over narrow
host-permission and consent-storage adapters. `ChromeConsentStorage` persists
strict records in one trusted local key; `MemoryConsentStorage` supports
deterministic tests.

`ContentScriptRegistrationService` adds only missing enabled-origin scripts and
removes stale, revoked, or unused registrations without touching registrations
owned by other extension features.

## Invariants

- Ungranted or unconsented origins are never ready for inspection.
- Consent is recorded only after disclosure acceptance and browser permission.
- Changing provider kind or origin requires new consent.
- Query strings, fragments, and paths do not broaden the requested host origin.
- No page content or credential enters a permission or consent record.

## Dependencies

The module depends on canonical origin contracts and injected browser/storage
adapters. Panel presentation, credential storage, inspection, and provider
transport remain separate responsibilities.

## Failure Behavior

Unsupported pages return `unsupported`. Disclosure or browser denial returns
`denied` without storing consent. Revocation removes stored origin consent even
when the browser reports that no permission remained.

## Tests

Tests cover grant, disclosure denial, browser denial, repeated requests,
provider binding, unsupported pages, revocation, and exact host patterns.
