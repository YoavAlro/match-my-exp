# Chrome Web Store Operation Policy

## Status

Reviewed against official Chrome policy on July 13, 2026.

Decision: conditional go with a Store release gate.

The finite operation model may continue through implementation and testing. A
public Store release must not enable model-generated movement, ARIA, or keyboard
operations until the exact packaged implementation receives written Chrome Web
Store guidance or a representative rich-operation build completes review. This
assessment is not reviewer approval.

## Question

Can a Manifest V3 extension accept model-generated declarative operations and
apply them with packaged code without becoming an interpreter for remote logic?

The relevant policy boundary is not whether the payload is JSON. Chrome states
that JSON and CSS are not remotely hosted code, while the Manifest V3 policy
also prohibits an interpreter that runs complex commands fetched as data. The
published policy does not define when a finite DOM-operation vocabulary crosses
that line.

## Policy Evidence

The Manifest V3 requirements establish four controlling rules:

1. Full extension functionality must be discernible from submitted code.
2. Extension logic must be self-contained.
3. External data is allowed when all functionality logic remains packaged.
4. An interpreter for complex remote commands is prohibited even when commands
   arrive as data.

Chrome's remote-hosted-code guidance separately says that remotely hosted code
does not include data such as JSON or CSS. This supports the proposed data
classification but does not override the complex-command rule.

Related Store obligations also apply:

- Permissions must be the narrowest required by implemented functionality and
  cannot be requested for future features.
- The privacy policy, together with any in-product disclosures, must identify
  collection, use, sharing, and every recipient of user data.
- Private, unlisted, and public items have the same policy requirements and
  review process.

## Exact Schema Assessment

The current model-facing contract is `ProposalSchema` in
`src/modules/contracts/proposal.ts`. Its operation vocabulary is defined in
`src/modules/contracts/operations.ts`.

All proposal objects are strict and versioned. A proposal contains at most 64
operations. Unknown keys and unknown operation kinds fail validation. Provider
JSON Schema constrains generation, while the full Zod schema remains the
authoritative runtime boundary.

The operation array may combine any of the four kinds in one proposal. Apart
from the 64-operation limit and per-kind bounds, the contract has no composition
language or per-kind quota. Atomic mixed-operation execution is planned for M3.
This increases the risk that the Store characterizes the complete vocabulary as
complex remote commands, even though it contains no branching or control flow.

| Capability | Packaged vocabulary                                                                   | Policy assessment                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style      | An ephemeral target plus 1-32 unique declarations from an explicit property allowlist | Strongest case. CSS is identified as data, resource-bearing and executable syntax is rejected, and the executor can remain finite. Styling can still hide or rearrange content, so preview and rollback are required. |
| Move       | Target, destination, and one of four placements                                       | Review-sensitive. DOM changes are a normal content-script capability, but remote data selects structural mutation and may be considered a complex command.                                                            |
| ARIA       | One of six attributes and a bounded value                                             | Review-sensitive. Values are not executable, but incorrect roles, labels, or hidden state can misrepresent a page to assistive technology. Packaged semantic policy is required.                                      |
| Keyboard   | Exact modifiers, a bounded key code, and one of three focus or scroll actions         | Highest concern. The handler remains packaged, but remote data configures persistent page behavior. Editable controls, collisions, and default handling require packaged policy.                                      |

The model cannot provide selectors in a proposal. It can reference only
ephemeral element identifiers assigned during local inspection. Durable targets
and bounded selector fallbacks are compiled locally after an accepted preview.

## Data Classification Evidence

The rich-operation case depends on preserving all of these properties:

- No operation field is interpreted as JavaScript, WebAssembly, HTML,
  event-handler source, a remote module, expression, callback, loop, branch, or
  generic API invocation. User-facing and ARIA strings remain untrusted text.
- No `eval`, string execution, dynamic remote imports, or remotely selected
  function names outside the finite discriminated union.
- Every operation kind, field, policy check, preflight, executor, journal, and
  rollback path ships in the reviewed package.
- Model responses are parsed with the strict runtime schema after provider
  parsing and before any page message is sent.
- Every required target resolves exactly once before mutation.
- Preview and profile commands are bound to the expected HTTPS origin and path.
- Unsupported, stale, malformed, or excessive output fails closed. Mixed
  supported operations are accepted and must execute as one packaged atomic
  transaction.
- Schema expansion requires packaged executor support, tests, documentation,
  policy review, and a new contract version.

These constraints make the proposal a bounded instruction data model. They do
not eliminate Store discretion under the complex-command clause.

## Current Evidence Limits

The repository currently contains contracts and a side-panel shell. It does not
yet contain provider adapters, page inspection, semantic operation policies,
transform executors, atomic preview, or rollback.

The present package cannot validate Store admissibility because reviewers
cannot exercise the planned functionality. It also requests `activeTab`,
`scripting`, and optional HTTPS hosts before those features are implemented. The
current shell must not be submitted as policy evidence.

Planned invariants must not be represented to reviewers as implemented until
their packaged code and tests exist.

## Reviewer Guidance Package

Before requesting guidance or review, provide:

- The exact model-facing JSON Schema and human-readable operation table.
- Accepted and rejected payload examples for every operation kind.
- Packaged source locations for validation, semantic policy, execution,
  preflight, journaling, and rollback.
- A statement that provider output is untrusted data and is reparsed locally.
- A statement that no operation field executes or interprets text as
  JavaScript, HTML, a selector, callback, URL, expression, control flow, or
  provider credential. Assistant and ARIA strings remain untrusted text.
- A deterministic test flow covering apply, reject, rollback, navigation, and
  ambiguous targets without requiring a reviewer-owned paid account. Dedicated,
  disposable test access belongs in Store test instructions, never source,
  listing text, or the extension package.
- Permission rationale for `activeTab`, `scripting`, `storage`, `sidePanel`,
  optional site origins, and provider origins.
- Data-flow disclosure for page text, semantic attributes, geometry, origin,
  path, user prompts, profiles, conversations, and credentials.
- The selected provider and every possible compatible endpoint recipient.
- A compiled-package audit showing no remote code or unreachable rich executor
  hidden behind a remote feature flag.

Frame the single purpose as user-requested, previewed, reversible website
personalization. Do not describe the extension as a general browser agent.

## Early Review Path

1. Complete the M1 styling vertical slice and remove permissions not exercised
   by that submitted build.
2. Upload the package as a draft Store item to obtain the item ID required by
   the One Stop Support policy-question form.
3. Ask One Stop Support a focused question containing the item ID, exact schema,
   and distinction between ephemeral model references and locally compiled
   durable targets.
4. Submit the M1 item as an unlisted beta with reviewer instructions. End its
   name with `BETA` or `DEVELOPMENT BUILD`, and state `THIS EXTENSION IS FOR BETA
TESTING` in its description as required for parallel test versions.
5. Supply only dedicated, disposable reviewer access through Store test
   instructions. Do not embed provider credentials in the package.
6. Treat this review as evidence for style operations, provider transfer,
   permissions, and disclosures. It does not clear richer operations.
7. After packaged move, ARIA, keyboard, semantic policy, and rollback exist,
   submit a representative rich-operation beta for review.
8. Treat a successful review as evidence for that package version, not a
   permanent policy exemption. Reassess after schema or policy changes.

Unlisted and private visibility support controlled testing, not reduced
scrutiny. Chrome states that all visibility modes follow the same policy and
review process.

## Styling-Only Fallback

Trigger the Store fallback when either condition occurs:

1. One Stop Support or a Store decision classifies the rich operation model as
   remote logic, and focused clarification or appeal does not clear the exact
   design.
2. No affirmative evidence for a representative rich-operation package exists
   at release freeze.

The fallback boundary is exact:

- Keep the existing `style` operation, target model, declaration allowlist,
  runtime validation, preview, persistence, and rollback.
- Remove `move`, `aria`, and `keyboard` from provider schemas, proposal and
  profile schemas, runtime messages, and the compiled Store package.
- Remove DOM reparenting, ARIA mutation, and page keyboard listeners from the
  Store package rather than hiding them behind remote configuration.
- Reject a mixed or rich proposal as a whole. Never silently strip operations.
- Describe the fallback as style-operation-only, not cosmetic-only.

If the Store classifies even the style operation as a remote command
interpreter, the fallback is invalid. No model-generated operation may execute
until the design receives further guidance.

## Sources

- [Additional Requirements for Manifest V3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), updated April 3, 2024
- [Deal with remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), updated December 13, 2023
- [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions), updated November 1, 2022
- [Privacy Policies](https://developer.chrome.com/docs/webstore/program-policies/privacy), updated November 1, 2022
- [Set up distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), updated December 7, 2020
- [Provide test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions), updated May 16, 2025
- [One Stop Support](https://support.google.com/chrome_webstore/contact/one_stop_support)

Policy pages and dates were verified on July 13, 2026.
