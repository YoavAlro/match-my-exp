# Store Package

## Build

Run `npm run check`, then `npm run package:store`. The packaging command rebuilds
the Chrome MV3 extension and creates a deterministic ZIP with fixed timestamps,
sorted entries, and no platform-specific metadata.

The output path is
`.output/match-my-exp-<version>-chrome-store.zip`. Record its SHA-256 digest,
source commit, version, Store outcome, reviewer feedback, and fallback decision
before publication.

## Submission Boundary

The unlisted review build exercises the styling proposal path. It contains no
credential, fixture route, local HTTPS key, test manifest, or packed-matrix
predecessor. Reviewer credentials belong only in the private Store instructions
field and must be disposable.

The automated packed matrix uses a synthetic predecessor because headless
Chromium cannot accept the native optional-host prompt. That predecessor and its
required test origins are created in a temporary directory and are never
included in the Store ZIP.
