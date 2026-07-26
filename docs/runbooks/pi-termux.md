# Operate Pi agent on Termux

Use this runbook before installing, updating, rolling back, recovering,
repairing TLS/login, or cleaning Pi agent state in this Termux environment. It
is the repository source of truth shared by Codex, Pi, Claude Code, other agent
runtimes, and human operators.

## Authority and scope

- Repository truth: this runbook and the repository's general operating
  policy.
- Durable inventory: `docs/inventory/pi.json`.
- Harness registry: capability and observed presence only; query with
  `scripts/termux-control orchestrator query tools --capability
  auxiliary-agent-runtime --json`.
- Live materialized state: `~/.local/bin/pi*` and `~/.local/opt/pi/`.
- Upstream release source:
  <https://github.com/earendil-works/pi/releases/latest>.
- Executable repository pass/fail: `./qa/verify` only.

Pi is an optional auxiliary agent runtime. Registration does not make it
Harness core, a required dependency, or a verification authority.

The live filesystem wins over the recorded baseline for installed version and
symlink targets. Never infer those values from an older session or this
document; inspect them before changing state.

This is a user-level installation. Do not invoke root, modify Android system
files, or install a generic GNU/Linux binary directly as though Termux were a
glibc distribution.

## Supported topology

Pi is installed from the official standalone Linux ARM64 package and launched
through a Pi-scoped glibc loader:

```text
~/.local/bin/pi
  → ~/.local/bin/pi-glibc-runner
  → ~/.local/opt/pi/current/bin/pi

~/.local/opt/pi/current
  → releases/<active-release>

~/.local/opt/pi/previous
  → releases/<rollback-release>
```

Managed files:

- `~/.local/bin/pi`: primary launcher. It pins `PI_PACKAGE_DIR` to `current`,
  supplies the Termux CA defaults, and routes core-only update requests to the
  safe updater.
- `~/.local/bin/pi.before-update-core`: runs `previous` for a non-mutating
  recovery check, falling back to `current` only when no previous release
  exists.
- `~/.local/bin/pi-glibc-runner`: Pi-only loader that preserves argument
  boundaries.
- `~/.local/bin/pi-core-update`: transactional core check, install, and
  activation.
- `~/.local/bin/pi-core-rollback`: validated atomic switch between `current`
  and `previous`.
- `~/.local/opt/pi/releases/`: immutable versioned or timestamped release
  directories.
- `~/.pi/agent/APPEND_SYSTEM.md`: optional global append policy. When present
  for RTK, it must byte-match `config/rtk/RTK.md`.

Do not replace this topology with a global npm install. Do not modify
`$PREFIX/bin/glibc-runner` for Pi: its current implementation may split quoted
arguments because it forwards an unquoted `$@`. The Pi-scoped runner exists to
avoid that system-wide mutation.

## RTK guidance

Pi uses RTK through global prompt guidance only. It may deliberately prefix a
supported individual noisy command when compact orientation output is useful.
Exact readers, machine output, shell composition, mutation, final Git review,
control-plane commands, and canonical verification stay raw. Filtered output
never proves correctness.

The canonical policy is `config/rtk/RTK.md`, materialized at
`~/.pi/agent/APPEND_SYSTEM.md`. Do not install
`~/.pi/agent/extensions/rtk.ts`: the upstream extension automatically delegates
Bash tool calls to `rtk rewrite` and violates the no-automatic-rewrite
boundary.

Before changing the append policy, inspect only metadata and checksums:

```bash
if test -e "$HOME/.pi/agent/APPEND_SYSTEM.md"; then
  stat "$HOME/.pi/agent/APPEND_SYSTEM.md"
  sha256sum "$HOME/.pi/agent/APPEND_SYSTEM.md" config/rtk/RTK.md
fi
test ! -e "$HOME/.pi/agent/extensions/rtk.ts"
```

If the append target exists and differs, preserve a private exact backup and
stop for review rather than overwriting unrelated Pi customization. After an
authorized materialization, use `/reload` in an existing session or start a
new session, then run the RTK status and doctor commands from the maintenance
runbook.

## Project Gauntlet adapter

This repository has a trusted, dependency-free project extension at
`.pi/extensions/gauntlet/`. It keeps using the root `AGENTS.md`, the existing
`.agents/skills`, and the global RTK append policy. Do not add project
`SYSTEM.md`, `APPEND_SYSTEM.md`, settings, copied skills, packages, or generated
dependency trees.

The adapter is defense in depth, not a sandbox. It gates only Pi's known
built-in `bash`, `edit`, and `write` events, fails closed for malformed or
non-interactive approval-required calls, reports successful mutations, and
runs `./qa/verify --mode stop` after a mutation epoch settles. Custom and
extension tools are not covered by that built-in gate.

Review the project extension before trusting it. For the first runtime proof,
use a temporary trust override and an ephemeral session:

```bash
PI_GAUNTLET_PROBE=1 \
  pi --approve --no-session --mode json "/gauntlet-probe"
```

The command is handled by the extension before an agent/provider turn. The
expected record has operation `pi.gauntlet-probe`, reports the project resource
loaded, denies the synthetic destructive and protected-write cases, preserves
the default prompt prefix, appends the Pi guidance, and exposes bounded Stop
wiring.

Then confirm the global RTK policy and prohibited rewrite extension remain
unchanged:

```bash
sha256sum \
  config/rtk/RTK.md \
  "$HOME/.pi/agent/APPEND_SYSTEM.md" \
  "$HOME/.codex/RTK.md"
test ! -e "$HOME/.pi/agent/extensions/rtk.ts"
pi list --no-approve
```

Do not persist trust from an automated probe and do not inspect auth, session,
or credential bodies. If the adapter fails, run with `--no-approve`, inspect
the repository diff, and repair only `.pi/extensions/gauntlet/`.

## Session continuity

Trusted persistent Pi sessions automatically use the repository
`session-continuity-v1` protocol. The extension prefixes the native session ID
as `pi:<native-session-id>`, binds it to an existing exact binding or the only
`in_progress` Harness story, checkpoints before compaction, and recovers after
compaction or reopen.

The prompt appendix reports the exact continuity key. Before consequential
work or a planned `/compact`, record the current safe boundary and operation
state with that key:

```bash
scripts/termux-control continuity checkpoint \
  --session "pi:${PI_SESSION_ID:?Pi session ID is unavailable}" \
  --safe-boundary "<last fully completed operation>" \
  --next-action "<one exact next action>" \
  --completed-operation "<stable completed operation>" \
  --pending-operation "<stable pending operation>" \
  --external-side-effect "<observed target state>" \
  --verification '{"focused":"pass","canonical":"pending"}'
```

Use repeated operation flags when more than one bounded item is needed. Do not
put tokens, credentials, request bodies, transcript excerpts, or secret-bearing
command input in these values.

Native Pi session commands remain unchanged:

```bash
pi --continue
pi --session <path-or-id>
pi --resume
```

After manual or threshold compaction, the recovery packet is appended to the
next turn without starting a provider turn. Overflow recovery is delivered to
the retry already in progress. A saved session reopened by a later Pi process
receives the latest valid packet. `--no-session` is intentionally not durable
across processes.

If binding is ambiguous, inspect `scripts/termux-control orchestrator status`
and bind the exact injected Pi key explicitly:

```bash
scripts/termux-control continuity bind \
  --session "pi:${PI_SESSION_ID:?Pi session ID is unavailable}" \
  --story <TERMUX-ID>
```

Never retry a consequential external operation merely because Pi resumed.
Inspect both `scripts/termux-control continuity operation show --key <key>` and
the real target state first.

The repeatable Termux-only proof uses temporary agent, session, and continuity
state, provides a local compaction summary, disables startup networking, and
reopens the same native Pi JSONL in a second process:

```bash
python3 -m unittest -v \
  tests.pi.test_adapter.PiRuntimeContinuityTests
```

Cross-platform CI verifies the static adapter contract but declares the
Android Pi binary surface absent. The local Termux gate must run this consumer
test through the configured Pi integration command.

## Recorded baseline

Observed and verified on 2026-07-26 UTC:

- architecture: Android/Termux `aarch64`;
- Pi core: `0.82.1`;
- `current`: `releases/0.82.1`;
- `previous`: `releases/0.82.1-reinstall-20260726124459`;
- CA bundle: `$PREFIX/etc/tls/cert.pem`;
- `.bashrc`: `PI_RTK_DISABLED=1`.

This baseline is recovery context, not permission to overwrite live state.
Always run the inspection below first.

## Inspect before action

Use raw output:

```bash
command -v pi
type -a pi
pi --version
pi-core-update --check
readlink "$HOME/.local/opt/pi/current"
readlink "$HOME/.local/opt/pi/previous"
find "$HOME/.local/opt/pi/releases" \
  -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

Expected invariants:

- `command -v pi` resolves to `~/.local/bin/pi`;
- `pi --version` returns a real version, not `0.0.0`;
- `current` and `previous`, when present, resolve below
  `~/.local/opt/pi/releases/`;
- no global npm launcher shadows `~/.local/bin/pi`;
- a check-only update does not change either symlink.

Inspect syntax and shebangs before modifying a launcher:

```bash
for file in \
  "$HOME/.local/bin/pi" \
  "$HOME/.local/bin/pi.before-update-core" \
  "$HOME/.local/bin/pi-glibc-runner" \
  "$HOME/.local/bin/pi-core-update" \
  "$HOME/.local/bin/pi-core-rollback"
do
  bash -n "$file" || exit
  head -n 1 "$file"
done
```

The required shebang is:

```text
#!/data/data/com.termux/files/usr/bin/bash
```

If live paths, ownership, symlink scope, binary architecture, or commands
differ materially from this topology, stop and diagnose the drift before
installing or deleting anything.

## Routine health check

```bash
pi --version
pi-core-update --check
test -r "$PREFIX/etc/tls/cert.pem"
readlink "$HOME/.local/opt/pi/current"
readlink "$HOME/.local/opt/pi/previous"
```

Do not print environment dumps or credential file contents during health
checks.

## Update core

Check without mutation:

```bash
pi-core-update --check
```

Use the explicit stable entrypoint:

```bash
pi update --self
```

The launcher translates that request to:

```bash
pi-core-update
```

The custom lane is required because the upstream standalone install method is
detected as `bun-binary` and does not provide a working integrated self-updater.
Do not bypass this by reinstalling from npm.

The updater must:

1. query official release metadata;
2. select the exact Linux ARM64 asset;
3. validate tag, asset URL, and GitHub-published SHA-256 digest;
4. reject unsafe archive paths and unsupported entry types;
5. extract into staging below `$PREFIX/tmp`;
6. validate package version and AArch64 ELF identity;
7. smoke-test through `pi-glibc-runner`;
8. install into a new release directory;
9. atomically switch `current` and preserve the old target as `previous`;
10. restore the old `current` if the final launcher check fails.

Verify after update:

```bash
pi --version
pi-core-update --check
readlink "$HOME/.local/opt/pi/current"
readlink "$HOME/.local/opt/pi/previous"
```

Stop on checksum, archive, architecture, smoke-test, or final-launcher failure.
Never manually point `current` at an unverified staging directory.

## Reinstall the same core version

When the active release is damaged and upstream has no newer version:

```bash
pi-core-update --force
```

The force lane creates a distinct
`<version>-reinstall-<timestamp>` directory; it must not overwrite an existing
release. It retains the same verification and atomic activation requirements
as a normal update.

## Rollback and recovery

Test the fallback without changing active state:

```bash
pi.before-update-core --version
```

Perform the validated switch:

```bash
pi-core-rollback
```

Then verify:

```bash
pi --version
readlink "$HOME/.local/opt/pi/current"
readlink "$HOME/.local/opt/pi/previous"
```

`pi.before-update-core` only launches the fallback; it does not mutate
symlinks. `pi-core-rollback` smoke-tests `previous`, switches atomically, and
restores the original target if the post-switch check fails.

If `previous` is absent, rollback is unavailable. If `current` is broken,
`pi-core-update --force` remains the recovery entrypoint because update
interception happens before the launcher requires a working active binary.

## Extensions

Keep extension updates separate from core:

```bash
pi update --extensions
```

Avoid:

```text
pi update --all
```

Combining extensions with core bypasses the intended operational boundary for
checksum verification and release rollback.

## TLS and login

The Pi launchers use the same Termux CA bundle defaults as Codex:

```text
SSL_CERT_FILE=$PREFIX/etc/tls/cert.pem
CURL_CA_BUNDLE=$SSL_CERT_FILE
```

Check metadata only:

```bash
test -r "$PREFIX/etc/tls/cert.pem"
ls -l "$PREFIX/etc/tls/cert.pem"
rg -n 'SSL_CERT_FILE|CURL_CA_BUNDLE' \
  "$HOME/.local/bin/pi" \
  "$HOME/.local/bin/pi.before-update-core"
```

Respect caller-supplied values when the launchers intentionally use shell
defaults. Never display, copy, persist, or commit tokens, cookies, API keys,
OAuth credentials, or credential file contents while diagnosing login.

## Failure diagnosis

### `bad interpreter: /usr/bin/env`

The shell is probably finding an npm or stale launcher:

```bash
command -v pi
type -a pi
head -n 1 "$HOME/.local/bin/pi"
```

The primary launcher must resolve under `~/.local/bin` and use the absolute
Termux Bash shebang.

### Version is `0.0.0`

`PI_PACKAGE_DIR` is probably wrong. The primary and recovery launchers must pin
it to the selected managed release. Do not rely on a session-global override.

```bash
rg -n 'PI_PACKAGE_DIR' \
  "$HOME/.local/bin/pi" \
  "$HOME/.local/bin/pi.before-update-core"
```

### Quoted arguments split unexpectedly

The wrong glibc runner is in use. Confirm the primary launcher invokes:

```text
~/.local/bin/pi-glibc-runner
```

Do not repair this by changing the system runner.

### Update verification fails

Leave `current` unchanged. Check network availability, free space, official
release metadata, and the exact error, then rerun the check. Never suppress
digest or architecture validation.

## Cleanup and retention

Keep at least:

- the release referenced by `current`;
- the release referenced by `previous`.

Before considering cleanup, resolve both references and enumerate exact
release directories:

```bash
readlink "$HOME/.local/opt/pi/current"
readlink "$HOME/.local/opt/pi/previous"
find "$HOME/.local/opt/pi/releases" \
  -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

Do not use a broad glob or recursive cleanup against
`~/.local/opt/pi/releases/`. Deletion requires an explicitly resolved absolute
target that is not referenced by either symlink, a stated recovery path, and
user authorization for that exact target.

At the recorded baseline, two retained releases use roughly 224 MB. Treat that
number as historical; measure live state before making a storage decision.

## Command summary

| Purpose | Command |
| --- | --- |
| Active version | `pi --version` |
| Check core update | `pi-core-update --check` |
| Update core | `pi update --self` |
| Reinstall same version | `pi-core-update --force` |
| Test fallback | `pi.before-update-core --version` |
| Roll back | `pi-core-rollback` |
| Update extensions | `pi update --extensions` |
| Active target | `readlink "$HOME/.local/opt/pi/current"` |
| Fallback target | `readlink "$HOME/.local/opt/pi/previous"` |

## Session discovery

- Codex and Pi sessions started in this repository load `AGENTS.md`. Its generic
  auxiliary-tool route leads to the Harness registry, `docs/inventory/pi.json`,
  and then this runbook only when Pi is relevant.
- Claude Code loads the repository `CLAUDE.md` shim, which directs it to the
  same `AGENTS.md` authority without duplicating Pi-specific context.
- An already-running Pi session can use `/reload` after entry-map changes.
- An already-running Pi session must also use `/reload` after
  `APPEND_SYSTEM.md` changes.
- A runtime started with context-file loading disabled must be told explicitly
  to read `AGENTS.md` and this runbook.

Never treat runtime memory, a previous chat, hook output, or an agent assertion
as a substitute for the live inspection and verification commands above.
