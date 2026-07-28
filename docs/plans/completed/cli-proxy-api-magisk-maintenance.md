# Vendor CLIProxyAPI Magisk maintenance implementation

Harness story: `TERMUX-013`

## Current context

The first transfer imported only durable knowledge. The operator clarified
that this repository must also contain the module implementation and tools
needed for future build, test, operation, and update work. The source of truth
for the import is `thoitiettxl-cyber/repository-harness` commit
`323b43cdd5789e6a4f7ce63b0d05ade91ebe0989`.

The live payload below `/data/local/cli-proxy-api/current` is root-restricted;
user-level `file` and `readelf` cannot open it. Repository proof therefore uses
a checksum-verified upstream core downloaded into temporary storage, not `su`
or live credentials.

## Approach

1. Vendor the complete module source, its three test layers, and the safe
   status helper byte-for-byte from the pinned source commit.
2. Add target-repository provenance and a non-root control-plane entrypoint for
   status, source drift, syntax, test, and build operations.
3. Keep root lifecycle, live staging, installation, update, purge, and reboot
   behind explicit authorization and the linked runbook.
4. Prove the imported source manifest, shell syntax, deterministic module
   build, fixture lifecycle/update/security tests, and canonical repository
   verification.

## Progress

- [x] Confirm source HEAD and imported commit identity.
- [x] Record high-risk intake and start `TERMUX-013`.
- [x] Import the 19 source/test/helper files byte-for-byte with executable modes.
- [x] Add local ownership, provenance, runbook, and control-plane integration.
- [x] Run focused build/test proof with a reviewed temporary payload.
- [x] Run canonical verification and review the implementation diff.
- [x] Complete Harness story `TERMUX-013` with fresh configured proof.
- [x] Run the final mandatory gate after all lifecycle metadata changes.

## Last safe boundary

The 19 upstream files match the pinned checkout by byte and mode. Source-check,
syntax, the default fixture suite, and two deterministic builds pass with a
temporary upstream `v7.2.104` runtime. No root command, live config read,
credential read, service mutation, package install, or deployment has
occurred. `TERMUX-013` is implemented after fresh configured proof. Next
action: run the final mandatory gate on the settled worktree.

## Decisions

- The target repository now owns a vendored maintenance copy while provenance
  preserves the upstream origin.
- Generated ZIPs and runtime payloads remain ignored; source and tests are the
  durable artifacts.
- Live root tests are never called by the non-root control entrypoint.

## Risks

- Controller code can mutate root-managed service and credential state when an
  operator explicitly invokes it as root.
- A build requires a Linux ARM64 CLIProxyAPI core, matching minimal glibc
  runtime, and CA bundle; none may contain live credentials.
- Historical module version and device evidence are not proof of current live
  state.

## Recovery

Before deployment, recovery is deleting only the newly vendored source,
helper, tests, provenance, and documentation after reviewing their exact diff.
No live module state needs recovery because this task does not mutate it.

After a future authorized deployment, recovery follows the runbook: retain the
previous release, preserve `/data/local/cli-proxy-api`, restore the selected
release atomically, and verify `cpactl doctor` plus loopback API health.

## External side effects

Harness intake/story changes were recorded under stable run ID
`cli-proxy-api-implementation-20260728`. The only network reads are pinned
source/release metadata and a temporary checksum-verified build payload. No
external repository, root path, service, credential, or release was changed.

## Validation

Focused evidence collected 2026-07-28 UTC:

- Upstream release `v7.2.104` archive
  `CLIProxyAPI_7.2.104_linux_aarch64.tar.gz` matched official SHA-256
  `d77647b161eb9af6c117200c4ce439a845a846acf0e8ab57420aff38989b84f5`.
- `source-check` matched all 19 vendored files and executable modes.
- Shell syntax passed for module controller, build, feasibility, module, and
  staging scripts.
- The default module suite passed archive integrity/layout, secret exclusion,
  persistent plugins, unsafe-config rejection, foreign listener preservation,
  checksum-gated core promotion, runtime corruption rejection, and confirmed
  purge boundaries.
- Two builds produced identical 19,715,091-byte ZIPs with SHA-256
  `5314bd9d47a20ef1f9c09962c8e9f9cb7db8d6b5cca48f83f2119b2bed3c6d7c`.
- `./qa/verify --mode targeted` passed after the vendored implementation,
  control entrypoint, provenance, and documentation were present.
- `story complete TERMUX-013` ran its configured
  `./qa/verify --mode targeted` command and transitioned the story to
  `implemented`.
- `./qa/verify` passed on the settled implementation and completed Harness
  lifecycle state.

Repeatable verification commands:

```bash
scripts/termux-control cli-proxy-api-magisk source-check
scripts/termux-control cli-proxy-api-magisk syntax
CPA_RUNTIME_DIR=<temporary-reviewed-runtime> \
  scripts/termux-control cli-proxy-api-magisk test
./qa/verify --mode targeted
./qa/verify
```
