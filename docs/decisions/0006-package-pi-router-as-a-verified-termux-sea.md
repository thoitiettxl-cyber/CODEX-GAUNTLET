# 0006 Package Pi Router as a verified Termux SEA

Date: 2026-07-26

## Status

Accepted

## Context

The source Pi Router requires Node.js and a dependency tree, while a local
Management Center needs a bounded way to identify, update, and recover the
running application. Generic Linux AArch64 release binaries are not valid
Android/Termux artifacts, and replacing a running executable from browser
input creates a high-risk trust boundary.

Node single executable applications can embed a bundled application in a Node
executable. Termux publishes an Android AArch64 Node package whose ELF uses
Android's linker. GitHub releases provide immutable binary assets and digest
metadata, but remote metadata alone is not sufficient authority to overwrite
local code.

Upstream SEA preparation and `postject` are primarily exercised on GLIBC.
Preparing the blob with a generic Linux Node is not proof for the Bionic
target. In addition, GLIBC reports the main executable first from
`dl_iterate_phdr()`, while Bionic reports `/system/bin/linker64` first and the
Termux executable second. The upstream postject callback stops at the first
image, so an otherwise valid Termux SEA cannot find its embedded blob.

## Decision

- Build the router bundle and one-file Management Center into a Node SEA whose
  base is a checksum-pinned Termux `nodejs` AArch64 package.
- Prepare the SEA blob natively with the exact extracted Termux Node
  executable; reject a GLIBC preparation executable even when its Node
  version matches.
- Apply one version-pinned, signature-checked AArch64 callback patch after
  injection so the Bionic lookup selects the `/data/...` main executable
  instead of `/system/bin/linker64`. Refuse the build when the signature or
  reserved executable padding is not exact, and verify the patch in committed
  artifact checks.
- Commit the native artifact and provenance so local Termux verification and
  cross-platform checksum review use the same bytes.
- Publish the fixed binary and SHA-256 asset names under
  `pi-router-vMAJOR.MINOR.PATCH` stable releases.
- Keep release checks and all mutations behind the existing loopback bearer.
- Require exact semantic-version, size, SHA-256, and Android AArch64 ELF
  validation before installation.
- Replace atomically, keep one `.previous` executable, and activate only after
  restart.
- Default to manual installation. Automatic verified installation requires
  `PI_ROUTER_AUTO_UPDATE=1` and must never block serving.
- Refuse installation in source mode so the updater cannot overwrite the Node
  interpreter.

## Alternatives Considered

1. Publish a GNU/Linux AArch64 SEA. Rejected because Android cannot safely
   substitute that runtime and repository policy requires a native Termux
   artifact.
2. Download a release and execute it directly from a temporary path. Rejected
   because it removes atomic recovery and makes installed identity unstable.
3. Let the Management API choose an arbitrary repository, asset, or target
   path. Rejected because browser input must not widen the executable-write
   boundary.
4. Automatically restart or supervise the process. Deferred because launcher
   ownership differs between interactive Termux, `termux-services`, and other
   supervisors.
5. Update source with `git pull` or `npm install`. Rejected because it mutates
   a worktree/dependency graph, has no single artifact checksum, and cannot
   provide bounded rollback.

## Consequences

Positive:

- one reviewed Android artifact serves the API and exact UI;
- release discovery is convenient without trusting remote metadata blindly;
- failed updates preserve the working executable and account state;
- source users retain a safe check-only path.

Tradeoffs:

- the repository carries a relatively large native artifact;
- SEA support on Android requires local execution proof in addition to
  cross-platform CI;
- the Bionic image-selection compatibility patch is coupled to the
  checksum-pinned Termux Node base and must be re-audited before that pin
  changes;
- the artifact inherits shared-library dependencies from Termux Node;
- an installed update requires a later process restart.

## Follow-Up

- Add supervisor-specific restart integration only as a separate accepted
  contract.
- Add release signing only after choosing a key lifecycle and recovery policy;
  SHA-256 and committed provenance remain mandatory either way.
