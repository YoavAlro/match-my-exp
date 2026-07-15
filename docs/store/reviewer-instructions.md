# Chrome Web Store Reviewer Instructions

## Purpose

Match My Exp provides user-requested, previewed, reversible website
personalization. It is not a general browser automation agent.

## Test Build

The beta listing name must end with `BETA` or `DEVELOPMENT BUILD`, and its
description must state `THIS EXTENSION IS FOR BETA TESTING`.

Use only dedicated disposable provider access supplied through the Store test
instructions field. No reviewer or permanent developer key is embedded in the
package.

## Styling Flow

1. Open the extension side panel on the supplied HTTPS fixture.
2. Confirm that the panel reports the current origin and path without displaying
   page text.
3. Select the supplied provider configuration.
4. Choose **Grant site access** and review the exact page-data categories and
   provider destination.
5. Enter the supplied styling request.
6. Inspect the assistant summary and visible preview result.
7. Preview the change, then discard it and confirm full rollback.
8. Repeat, keep the preview, reload, and confirm deterministic reapplication
   without a provider request.
9. Remove the site permission in Chrome's extension settings; confirm the active
   change rolls back and future reloads do not reapply it.

## Failure Flow

- Deny site permission and confirm no page context or provider request occurs.
- Use the malformed-response fixture and confirm no page mutation occurs.
- Start a request, navigate, and confirm the stale response is discarded.
- Trigger an ambiguous request and confirm a clarification appears with no
  preview mutation.

## Remote-Code Explanation

Provider output is untrusted JSON data. Every operation kind, parser, policy,
target resolver, executor, journal, and rollback path is packaged in the
submitted extension. No operation field executes or interprets text as
JavaScript, HTML, an event handler, selector, URL, callback, expression, loop,
branch, or generic API invocation. User-facing text remains untrusted text.

The package contains no eval path, remote import, remotely hosted script, or
remote feature flag that exposes an unreachable rich executor.

## Data and Credentials

Page context goes directly to the selected provider after consent. Credentials
remain in trusted local extension storage and are not visible after entry.
Visible chat history is local; extracted context and raw provider envelopes are
not retained.
