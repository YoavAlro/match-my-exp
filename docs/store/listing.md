# Chrome Web Store Listing Draft

## Name

Match My Exp

## Summary

Adapt recurring website experiences through chat and reapply approved changes
locally.

## Description

Match My Exp is a personal web layer for people who repeatedly encounter a
website experience whose visual presentation does not fit their needs.

Describe the change you want in the Chrome side panel. The extension sends a
minimized semantic representation of the current page to your selected AI
provider, validates the response, and previews reversible declarative changes.
Nothing is saved until you approve it.

Approved profiles reapply locally on matching pages without another AI request.
You can undo a preview before keeping it and revoke site access through Chrome's
extension settings to stop future application.

### Local-first and BYOK

- Bring your own OpenAI, Anthropic, Gemini, or compatible endpoint credential.
- Provider usage may incur charges.
- Profiles, settings, credentials, and visible messages remain in local browser
  storage.
- There is no Match My Exp cloud account, synchronization, advertising, or
  telemetry.

### Privacy and control

The extension requests access to one HTTPS site at a time. Before sending page
context, it identifies the provider destination and disclosed data categories.
Passwords, form values, hidden content, scripts, raw HTML, query strings, and
fragments are excluded.

Match My Exp is a personalization aid. It does not certify WCAG compliance or
replace website accessibility remediation.
