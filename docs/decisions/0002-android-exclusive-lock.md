# 0002 Serialize Harness CLI locking on Android

Date: 2026-07-24

## Status

Accepted

## Context

The compatibility CLI uses an advisory epoch lock to fence concurrent
operations. Android does not provide the shared advisory lock used by the
upstream implementation. Building the upstream code unchanged would leave the
Termux control plane without a supported locking implementation.

## Decision

The Termux source-build lane applies
`scripts/patches/harness-cli-android-exclusive-lock.patch`. On Android, both
shared and exclusive lock requests use an exclusive advisory lock. Other
platforms retain the upstream locking behavior.

The source tag, commit, patch, built artifacts, and checksums remain pinned and
reviewable. CLI operations must fail closed if the exclusive lock cannot be
acquired.

## Alternatives Considered

1. Disable locking on Android. Rejected because concurrent operations could
   bypass epoch fencing.
2. Use an incompatible GNU/Linux release binary. Rejected because Android uses
   a different dynamic linker.
3. Disable `harness-cli` on Termux. Rejected while SQLite compatibility
   commands remain supported by the control-plane contract.

## Consequences

Positive:

- Epoch fencing remains fail closed on Android.
- The compatibility CLI remains available as an optional control plane.
- The platform divergence is a small, explicit, reviewable patch.

Tradeoffs:

- Operations that could share a lock upstream are serialized on Android.
- Every Harness upgrade must revalidate or retire the patch against the pinned
  upstream source.

## Follow-Up

- Remove the patch if upstream provides an Android-compatible locking
  implementation with equivalent fail-closed behavior.
- Run the upstream `harness-cli` tests, focused integrity checks, and
  `./qa/verify` whenever the patch or pinned Harness version changes.
