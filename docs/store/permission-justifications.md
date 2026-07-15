# Permission Justifications

## Required Permissions

| Permission  | Shipped behavior                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab` | Identify the user-selected active tab after the toolbar action and coordinate readiness without reading page content prematurely. |
| `scripting` | Register or execute the packaged content script only for origins the user granted. No remote code is executed.                    |
| `sidePanel` | Present chat, disclosure, preview, profile, and provider controls in Chrome's side panel.                                         |
| `storage`   | Persist local profiles, consent, settings, and BYOK credentials in trusted extension contexts.                                    |

## Optional Host Access

`https://*/*` is declared only as an optional capability. The extension requests
one exact current HTTPS origin at a time after disclosure and user action.
Enabled profiles retain only the origins needed for deterministic reapplication.
Revoked or unused origins lose dynamic content-script registration.

The same optional mechanism supports direct provider origins and a user-selected
compatible endpoint. HTTP, localhost, credential-bearing URLs, query-bearing
endpoints, fragments, redirects, browser-internal pages, and file URLs are
rejected.

## Not Requested

The package does not request history, cookies, webRequest, debugger, userScripts,
nativeMessaging, identity, downloads, clipboard, geolocation, notifications, or
broad required host permissions.
