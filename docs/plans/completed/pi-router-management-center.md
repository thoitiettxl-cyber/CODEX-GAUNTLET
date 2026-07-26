# Complete the Pi Router Management Center

Harness story: `TERMUX-008`

## Current context

The inherited worktree contains a passing first implementation of a React and
TypeScript operator bench. It builds to one self-contained
`web/dist/index.html`, is served at `/` and `/management.html`, keeps the local
bearer in page memory, and exercises the existing Responses JSON/SSE API.

This continuation expands that work into a complete local Management Center.
The task is high-risk because it adds an authenticated management API, a
binary-replacement path, GitHub networking, and a committed Android AArch64
artifact. Existing source and untracked handoff files must be preserved.

## Accepted outcome

- Keep the single-file, offline-capable Management Center and the inherited
  request probe.
- Add a bearer-authenticated management API for bounded runtime status and
  update operations.
- Check GitHub stable releases and install only an exact, checksum-verified
  Termux Android AArch64 asset.
- Support explicit one-click/CLI updates and opt-in automatic installation;
  activation occurs after process restart.
- Build and execute a native Android AArch64 Node SEA artifact derived from a
  pinned Termux Node package, never a generic Linux AArch64 release binary.
- Add deterministic tests, focused proof, artifact provenance, recovery
  instructions, and canonical `./qa/verify` proof.

## Approach

1. Extend the product contract before widening the server boundary.
2. Isolate release discovery, version comparison, artifact validation, atomic
   replacement, and rollback in a testable updater module.
3. Keep every management route behind the existing local bearer and return no
   credential, prompt, response, or raw filesystem-path data.
4. Evolve the inherited visual language into `Overview / Probe / Updates`
   surfaces while retaining the route rail as the design signature.
5. Bundle router source, Pi runtime, and committed HTML into a Node SEA based
   on a pinned Termux Android package; record and verify its identity.
6. Build release automation around the same exact artifact name and checksum
   contract used by the updater.

## Progress

- [x] Recovered and inspected the inherited worktree without discarding it.
- [x] Confirmed the inherited UI build/check and all 31 deterministic tests
  pass before further edits.
- [x] Defined the Management API, update, artifact, and recovery contracts.
- [x] Implemented updater, management routes, CLI controls, and opt-in automatic
  update behavior.
- [x] Completed the Management Center UI and rebuilt the one-file artifact.
- [x] Built and validated the native Termux Android AArch64 artifact.
- [x] Added deterministic update/API/binary tests and ran focused proof.
- [x] Ran spec check, reviewed the complete diff, and passed `./qa/verify`.
- [x] Recorded validation and moved this plan to `completed/`.
- [x] Completed `TERMUX-008` with fresh canonical proof.

## Decisions

- Use `/management/api/*` rather than widening the OpenAI-compatible `/v1/*`
  namespace.
- Keep HTML loading unauthenticated on the loopback listener; every management
  and inference API request remains bearer-authenticated.
- Treat `PI_ROUTER_AUTO_UPDATE=1` as explicit consent to install a verified
  stable update. The default is check/manual-install only.
- Never overwrite the Node interpreter in source mode. Installation is
  available only from the packaged binary or an explicitly injected test
  target.
- Keep one recoverable `.previous` binary beside the installed target and
  expose rollback through CLI and the authenticated management API.
- Use a fixed GitHub release asset name plus a SHA-256 asset. Reject drafts,
  prereleases, unexpected tags, redirects outside HTTPS, oversized payloads,
  checksum mismatches, and non-Android/non-AArch64 ELF files.
- Read the ELF `PT_INTERP` program header instead of accepting a decoy linker
  string, and require the exact embedded router version marker before
  replacement.
- Prepare the SEA blob with the checksum-pinned Termux Node executable. Patch
  only its exact pinned AArch64 callback signature so Bionic selects the
  `/data/...` main image after reporting `/system/bin/linker64` first.

## Risks

- A replaced executable cannot activate inside its already-running process;
  the UI and API must report that restart is required.
- Node SEA support is experimental on Android. Local Termux execution is
  mandatory evidence; cross-platform CI may verify only source, metadata, and
  artifact checksum/identity.
- The SEA inherits shared-library requirements from the pinned Termux Node
  package. Initial installation must satisfy those documented Termux package
  dependencies.
- GitHub can be unavailable or rate-limited. Serving and inference must remain
  usable when checks fail, and automatic checks must never block startup.
- A stale browser candidate must not install a different release. Apply
  requests carry the exact version observed during check.

## Recovery

- Before installation, copy the current binary to `<binary>.previous`; write
  the new artifact to a sibling temporary file, sync it, then rename atomically.
- On failed validation, remove only the temporary candidate and leave the
  current executable untouched.
- `pi-router update rollback` and the corresponding authenticated API restore
  the previous binary atomically; restart activates it.
- Source-mode recovery remains `node pi-router/src/cli.js serve`; update
  failures never mutate router account state, `auth.json`, or `models.json`.
- If binary execution proof cannot pass on Termux, keep source functionality
  but do not complete this story or claim the artifact lane complete.

## External side effects

- Harness lifecycle state and this linked plan record the multi-session work.
- Dependency installation is limited to pinned build-time packages in
  `pi-router`; no provider credential or live inference is required.
- GitHub update tests use local fake HTTP responses and temporary files.
- A real GitHub release is not published by this task; release publication
  remains an explicit tag/push action.

## Validation

- `npm --prefix pi-router run build` and `npm --prefix pi-router run check`
  passed; `web/dist/index.html` is reproducible from the React/TypeScript
  source and the committed binary input digest is current.
- `npm --prefix pi-router test` passed 42/42 deterministic tests covering
  Management API authentication and actions, the self-contained browser
  surface, semver/release selection, exact version matching, per-hop HTTPS,
  bounded downloads, checksum/digest validation, real ELF `PT_INTERP`
  validation, atomic install, rollback, source-mode refusal, and mutation
  serialization.
- `npm --prefix pi-router run test:coverage` passed at 85.9% source line
  coverage.
- `npm --prefix pi-router run test:binary` executed the committed artifact
  natively on Android AArch64 and passed version, help, deterministic Pi model
  loading, server, health, Management Center, authenticated Management API,
  and clean termination smoke checks.
- `file`, `readelf`, `check:binary`, and `sha256sum --check` confirmed ELF64
  AArch64, Android API 24, `/system/bin/linker64`, the pinned Bionic callback
  patch, artifact freshness, mode `0755`, and SHA-256
  `51b3c92c3571bb71c6cfdf4403efa656d15a3874d7bf9ae22f094e05cf496db2`.
- The release workflow parsed as YAML, matched tag
  `pi-router-v0.2.0` to package/provenance version `0.2.0`, selected the fixed
  binary/checksum assets, and delegates release verification to
  `./qa/verify --mode ci`.
- Spec check found no remaining contradiction or missing acceptance evidence
  across the product contract, ADR 0006, implementation, tests, provenance,
  runbook, and release workflow.
- `./qa/verify --mode targeted` passed the conservative dependency,
  pure-logic, and unknown-mixed matrix: 65/65 Gauntlet self-checks, policy
  audit, build, unit, integration, acceptance, and coverage.
- Harness `story complete TERMUX-008` reran that canonical command successfully
  and atomically transitioned the story to `implemented`.
