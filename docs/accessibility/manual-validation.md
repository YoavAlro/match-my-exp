# Manual Accessibility Validation

## Required Sessions

Run the same fixture in current stable Chrome with:

- macOS VoiceOver using keyboard navigation and the web rotor
- Windows NVDA using browse mode, focus mode, landmarks, and elements lists
- Keyboard-only navigation without a screen reader

Record Chrome, operating-system, and assistive-technology versions. Record every
deviation as a reproducible issue. Do not mark the milestone complete from
automated results alone.

## Representative Fixture

Use an HTTPS page containing these page-authored semantics:

```html
<header><h1>Account</h1></header>
<nav aria-label="Primary"><a href="#details">Details</a></nav>
<main>
  <p id="live" role="status" aria-live="polite">Account saved</p>
  <section aria-label="Account actions">
    <button>Primary action</button>
  </section>
  <section><button>Secondary action</button></section>
  <section id="details">Details content</section>
  <button>Shortcut target</button>
</main>
```

The test origin must contain no personal data or credentials. Keep browser zoom,
screen-reader verbosity, and keyboard layout in the session record.

## Procedure

1. Before preview, traverse headings, landmarks, links, buttons, and the status
   message. Record names, roles, order, and announcement behavior.
2. Preview moving **Secondary action** before **Primary action** in the account
   actions region.
3. Preview naming **Details content** as `Account details` with role `region`.
4. Preview a nonreserved modified shortcut that focuses **Shortcut target**.
5. Traverse the page again. Confirm visual order, focus order, browse order, and
   elements lists agree; no element is duplicated or lost.
6. Trigger the shortcut outside an editable control. Confirm focus moves without
   activation. Repeat inside a text field and confirm the extension does nothing.
7. Trigger the page-authored status update. Confirm the live announcement occurs
   once and remains unchanged by extension operations.
8. Discard the mixed preview. Confirm original order, names, roles, landmarks,
   live-region behavior, and shortcut behavior are restored.
9. Repeat with Keep, reload, SPA navigation, permission revocation, and browser
   restart when the rich-operation production bridge is enabled.

## Expected Results

- Focus never enters hidden, detached, or duplicate content.
- Page-authored landmark and live-region semantics remain available.
- Added names and roles are announced consistently with their visible targets.
- Shortcuts are discoverable, require a modifier, avoid reserved combinations,
  and never intercept editable controls.
- Rollback restores the exact pre-preview semantic and keyboard state.
- Any unexpected activation, focus loss, duplicate announcement, hidden focused
  content, or rollback conflict is release-blocking.

## Session Record

| Field                | Result  |
| -------------------- | ------- |
| Date and tester      | Pending |
| Chrome version       | Pending |
| OS and version       | Pending |
| Assistive technology | Pending |
| Fixture origin       | Pending |
| Preview results      | Pending |
| Rollback results     | Pending |
| Findings             | Pending |
