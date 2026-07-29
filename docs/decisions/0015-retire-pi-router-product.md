# 0015 Retire the Pi Router product

Date: 2026-07-29

## Status

Accepted; supersedes decisions 0005 through 0010 for active product behavior.

## Context

Pi Router introduced a second repository-owned provider, credential, routing,
management, release, and verification surface beside the root-managed
CLIProxyAPI path. The owner has decided to remove that product from this
repository and continue CLIProxyAPI plugin work without claiming feature
parity.

The existing Pi Router worktree also contains unfinished multi-account routing
changes. Removing the product without preserving that state would destroy
recoverable work. Conversely, deleting completed plans and applied Harness
changesets would erase audit history without reducing any runtime surface.

## Decision

Remove the active `pi-router/` implementation and binary, its release workflow,
product contract, runbook, provenance, top-level advertising, architecture
boundary, and canonical QA commands.

Retain completed execution plans, legacy decision bodies, and applied Harness
changesets as historical evidence. Keep Pi CLI, Pi Gauntlet, and Pi continuity
support because they are independent of Pi Router. Preserve the unfinished
Pi Router diff in a recoverable Git object before deletion.

Treat retirement as an intentional product contraction. Policy Scheduler and
Credential Security remain governed by `TERMUX-014`; neither is declared a
complete Pi Router replacement.

## Alternatives Considered

1. Keep Pi Router until plugin parity. Rejected because the owner chose to
   eliminate the duplicate product boundary now.
2. Delete every historical Pi Router reference. Rejected because completed
   plans and semantic changesets are the audit and Harness replay record.
3. Leave a placeholder package so existing QA commands pass. Rejected because
   it would preserve a false product surface and create a second verification
   truth.

## Consequences

Positive:

- one fewer provider/credential/routing control plane in the repository;
- no committed Pi Router runtime binary or release lane;
- product documentation and canonical verification match the supported
  surface.

Tradeoffs:

- Pi-backed provider access and the Pi Router management console disappear;
- the CLIProxyAPI plugins do not yet cover every retired capability;
- historical documents continue to contain Pi Router references by design;
- the protected QA command update requires a separately launched, exact
  Gauntlet maintenance scope.

## Follow-Up

- Complete `TERMUX-015` under
  `CODEX_GAUNTLET_MAINTENANCE_TARGETS=qa/project-commands.json`.
- Finish the independent Policy Scheduler and Credential Security production
  gates in `TERMUX-014` without using retirement as completion evidence.
