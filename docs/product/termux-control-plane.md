# Termux control-plane contract

## Purpose

`codex-gauntlet-termux` is the operating repository for this Termux
environment. Changes to Termux packages, developer tools, repositories,
automation, and agent configuration start here so their intent, implementation,
and proof remain inspectable.

It is a control plane, not an owner of every target repository. Product code
and truth stay in their own repositories; this repository owns the operating
policy, inventory, runbooks, pinned tooling, and cross-repository procedures.

## Entry points

- `scripts/termux-control status` reports the local platform and pinned tools.
- `scripts/termux-control doctor` checks that the Termux Harness installation
  is healthy.
- `scripts/termux-control verify` runs the sole repository verification
  authority.
- `scripts/termux-control rebuild-harness` rebuilds the pinned Harness tools
  from source.

## Change contract

Every consequential Termux or repository mutation must have:

1. an explicit target and desired outcome;
2. a pre-change inspection and a recovery path;
3. pinned or otherwise reviewable inputs;
4. focused runtime evidence;
5. `./qa/verify` evidence for changes to this control plane;
6. a final diff review when Git metadata is available.

Secrets, tokens, private keys, and unredacted credentials must never be stored
in this repository. Runtime state and generated databases stay ignored unless a
separate contract explicitly makes them durable.

## Harness boundary

The native `harness` binary maintains repository-centered core files.
`harness-cli` is the optional SQLite compatibility control plane. Neither
replaces `./qa/verify`, and the compatibility database is not required for
ordinary work. The pinned migrations under `scripts/schema/` are installed
with the CLI; generated `harness.db` state remains ignored.

On Termux, upstream self-update is unsupported for `android/aarch64`. Updates
must use the pinned source-build lane; a Linux release binary is not compatible
with Android's dynamic linker.

Android also lacks the shared advisory lock used by the compatibility CLI.
The build lane applies the reviewed local patch that substitutes an exclusive
lock on Android. This preserves fail-closed epoch fencing while serializing CLI
operations.
