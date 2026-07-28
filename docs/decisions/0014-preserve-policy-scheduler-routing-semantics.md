# 0014 — Preserve Policy Scheduler routing semantics

Date: 2026-07-28

## Status

Accepted.

## Context

`policy-scheduler` must return an explicit `AuthID` when it creates or fails
over a session-affinity binding. Version `0.2.0` used LRU for that choice when
`balance_strategy: delegate`, even when `delegate_builtin` was `fill-first`.
Its LRU and weighted state was also shared across models.

Official `zhumengling/codex-token-usage` HEAD
`a5221681fbcca071ac9f0dcb1ff37f8edcd97a6d` and the pinned CLIProxyAPI
`v7.2.103` source both preserve built-in strategy and isolate round-robin
cursors by provider/model. The reference plugin also implements usage-backed
account protection, but that behavior depends on a `usage` capability, SQLite
history, auth identity reads, and reservations that are outside this plugin's
scheduler-only contract.

## Decision

1. Scope affinity HMAC input and local rotation, LRU, and weighted state by the
   normalized provider set plus requested model.
2. Keep a still-eligible affinity binding without advancing the local
   round-robin cursor.
3. For a new or failed-over binding, use explicit `weighted` or
   `least-recently-used` policy when configured. In delegate mode, mirror
   `delegate_builtin`: stable AuthID order for `fill-first`, or a
   provider/model-scoped cursor for `round-robin`.
4. Clear local selection state when the balance strategy, weight attribute, or
   delegated built-in strategy changes. Preserve eligible affinity bindings
   unless an affinity field changes.
5. Do not add usage storage, token logging, auth-file reads, quota probes, or
   network execution to obtain reference-plugin account protection. Host
   status/cooldown filtering and safe candidate attributes remain the available
   inputs.

## Alternatives Considered

1. Always use LRU for affinity creation. Rejected because it silently changes
   configured `fill-first` behavior and couples unrelated model traffic.
2. Read the host configuration file to discover routing strategy. Rejected
   because `delegate_builtin` is already an explicit validated plugin field.
3. Port the reference plugin's usage database and concurrency/token limits.
   Rejected because it expands capability, credential, persistence, and
   request-side-effect boundaries instead of completing the scheduler seam.

## Consequences

Positive:

- affinity creation now matches operator-selected built-in behavior;
- one model's selection history cannot perturb another model's first choice;
- affinity hits do not consume round-robin turns intended for new bindings;
- the plugin retains its no-database, no-token, no-network boundary.

Tradeoffs:

- switching strategy intentionally forgets process-local selection history;
- at decision time source `0.3.0` differed from the separately managed live
  `0.2.0` artifact; the later authorized hot promotion resolved this gap;
- concurrency and rolling-token protection remain unavailable without a future
  accepted capability expansion.

## Follow-Up

- Require unit proof for fill-first, route-scoped round-robin/LRU/weighted
  behavior, affinity hits, and reconfigure reset.
- Require deterministic Linux ARM64 build, isolated official-host integration,
  and `./qa/verify --mode targeted` before release or live promotion.
