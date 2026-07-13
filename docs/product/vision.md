# Product Vision

## Promise

Match My Exp is a personal web layer that helps individuals adapt websites to
how they see, focus, navigate, and interact.

It is a personalization aid. It does not claim to remediate every
accessibility issue or certify WCAG compliance.

## Primary User

The first user is an individual who repeatedly encounters a website experience
that does not fit their visual, cognitive, or assistive needs. They want to
describe a better experience in ordinary language and have it return reliably
on later visits.

## Core Experience

1. The user opens the Chrome side panel on an HTTPS website.
2. The user grants access to that origin.
3. The user describes the desired experience through chat.
4. The extension sends minimized page context to the selected AI provider.
5. The extension previews validated, reversible changes.
6. The user keeps, revises, undoes, or discards the preview.
7. The user saves the accepted draft against an editable path pattern.
8. The extension reapplies the saved profile without contacting an AI model.
9. A profile that no longer matches the page is disabled and offered for
   user-initiated repair.

## MVP Capabilities

- Visual styling and layout adaptation
- Reordering existing elements within the same document or open shadow root
- Validated ARIA changes from a conservative allowlist
- Keyboard actions for focusing and scrolling to selected elements
- Chat-only instructions with clarification when targeting is ambiguous
- One deterministic saved profile for any resolved page
- OpenAI, Anthropic, Gemini, and HTTPS OpenAI-compatible providers
- Device-local profiles, settings, credentials, and visible chat history

## Supported Pages

- Top-frame HTTPS pages
- Traditional navigation
- Client-side navigation in single-page applications
- Elements inside open shadow roots

## Excluded From MVP

- Closed shadow roots
- Same-origin or cross-origin frames
- Browser-internal pages
- HTTP, localhost, and file URLs
- Incognito profiles
- Content rewriting or summarization
- Form completion and workflow automation
- Generated or remotely hosted executable code
- Cloud accounts, synchronization, profile sharing, or telemetry
- Automatic AI repair without user approval

## Privacy Expectations

- Page context is sent only after an explicit user chat action.
- The extension identifies the selected provider and destination before use.
- Passwords, form values, scripts, hidden content, URL query strings, URL
  fragments, and raw HTML are excluded from model context.
- Visible user and assistant messages are retained locally.
- Extracted page context and hidden provider payloads are not retained.
- Provider credentials are retained locally only after clear extractability,
  billing, deletion, and rotation disclosures.

## Success Measures

- At least 90 percent of representative benchmark requests target correctly
  within one clarification.
- Ambiguous targets never cause silent page changes.
- Preview rollback restores 100 percent of extension-owned fixture changes.
- Saved profiles reapply successfully on at least 95 percent of supported
  benchmark visits.
- Accessibility-focused beta participants report a meaningful reduction in at
  least one recurring barrier.
- Users choose to keep profiles enabled across repeated visits.

## Store Fallback

The preferred Chrome Web Store release supports the full declarative operation
model. If review rejects remote model-generated DOM or ARIA operation data, the
Store MVP will ship with styling operations only while richer capabilities
remain disabled.
