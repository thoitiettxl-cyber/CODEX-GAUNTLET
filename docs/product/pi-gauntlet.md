# Pi Gauntlet adapter contract

## Purpose

The trusted project extension under `.pi/extensions/gauntlet/` gives Pi the
repository's destructive-command, protected-path, maintenance, and canonical
verification posture wherever Pi `0.82.1` exposes an equivalent lifecycle
event. It also adapts Pi compaction and session events to the repository
`session-continuity-v1` protocol.

The adapter is defense in depth only. It is not a sandbox, a permission
boundary, or a replacement for monitored execution. Pi and its extensions run
with the permissions of the user who started the process.

## Repository truth and authority

- Pi continues to load the root `AGENTS.md` and project `.agents/skills`.
- `scripts/gauntlet_policy.py` is the runtime-neutral decision core.
- `scripts/continuity/lifecycle.py` is the runtime-neutral compaction/resume
  boundary; Codex and Pi share its bounded SQLite state.
- Codex and Pi translate native tool events into the shared `allow`, `deny`,
  and `requires_human` contract.
- `./qa/verify` remains the only executable pass/fail authority.
- Pi remains an optional `auxiliary-agent-runtime`; it is not Harness core or a
  verification provider.

Project `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.pi/settings.json`, copied
skills, package metadata, and generated dependency trees are prohibited for
this adapter. The trusted extension appends short turn-specific guidance to
Pi's existing system prompt, so it neither replaces the default prompt nor
shadows the global RTK policy at `~/.pi/agent/APPEND_SYSTEM.md`.

## Policy behavior

The adapter covers Pi's known built-in `bash`, `edit`, and `write` tools:

- destructive commands, policy bypass, hard-protected paths, and attempts to
  weaken the Codex baseline are denied before execution;
- protected-path mutations are denied outside an enabled, exact maintenance
  allowlist;
- exact maintenance scope yields `requires_human`, never automatic approval;
- only TUI mode may present that confirmation, while print, JSON, and RPC
  execution fail closed;
- malformed covered-tool events and shared-core failures fail closed;
- a tool overriding the name of a covered built-in is blocked rather than
  silently treated as protected.

Other custom or extension tools are outside the adapter's mutation coverage.
Prompt guidance and product documentation must say so explicitly; their
presence must never be represented as sandboxed or approved execution.

## Mutation settlement

After a covered tool reports a successful mutation, the adapter records a
bounded policy event. At `agent_settled`, it runs `./qa/verify --mode stop`.
Captured output is bounded. An in-flight guard, mutation epoch, worktree
signature, failure signature, and one-repair-follow-up budget prevent recursive
verification loops.

A failed Stop run can queue one follow-up for repair. A second failure in the
same repair cycle is reported without creating another automatic turn. A new
human input resets the follow-up budget; successful verification closes the
current mutation epoch.

## Session continuity

Persistent Pi sessions use continuity key `pi:<native-session-id>`. The
adapter maps native `session_before_compact`, `session_compact`,
`session_start`, and `session_shutdown` events to the shared lifecycle
protocol. It preserves the latest explicit checkpoint fields, including safe
boundary, completed and pending operations, observed external side effects,
verification state, and the exact next action.

Pi continues to own its session JSONL and compaction summary. The adapter does
not read messages, `branchEntries`, or transcript bodies. Manual and threshold
recovery is appended to the next turn's system prompt. Overflow recovery is
queued as `steer` with `triggerTurn: false` because Pi is already retrying the
interrupted turn.

Continuity failures do not block unrelated Pi work. They produce a bounded
degraded warning, never guess among multiple active stories, and never turn
session loss into authorization to replay an external write. `--no-session`
remains ephemeral and therefore has no cross-process recovery binding.

## Trust and runtime proof

Project trust is only an input-loading guard. Review the extension before
trusting it. The first automated probe uses temporary `--approve`,
`--no-session`, and the guarded `PI_GAUNTLET_PROBE=1` command; it does not
persist a trust decision or send a provider request.

Static and synthetic policy tests run through the cross-platform Python test
surface. Termux additionally loads the installed Pi `0.82.1` extension,
executes the original no-session policy probe, then exercises native manual
compaction and reopens the same temporary persisted session in a second
process. The continuity probe provides a local extension summary, runs with
`--offline`, and makes no provider request. The supported upstream contracts
are:

- <https://pi.dev/docs/latest/usage>
- <https://pi.dev/docs/latest/skills>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/security>

## Recovery

If the project extension fails before trust, inspect the diff and repair or
remove only `.pi/extensions/gauntlet/`. If a temporary `--approve` probe fails,
rerun with `--no-approve`; do not edit `~/.pi/agent/trust.json`.

Never change Pi auth, sessions, global RTK policy, packages, launchers, release
symlinks, or credentials as recovery for this project adapter.
