# 0012 — Import CLIProxyAPI Magisk as auxiliary runtime knowledge

Date: 2026-07-28

## Status

Superseded in part by decision 0013, which vendors the maintenance
implementation after the operator expanded the ownership boundary.

## Context

The source repository `thoitiettxl-cyber/repository-harness` contains product,
architecture, operations, validation, and implementation knowledge for a
standalone CLIProxyAPI Magisk runtime. This Termux control plane needs that
knowledge to route future agent work without taking ownership of another
repository's product code or copying secret-bearing live state.

The target architecture already represents optional capabilities through a
Harness registry record, one durable inventory document, and a linked runbook.
Its sole verification authority remains `./qa/verify`.

## Decision

1. Import a distilled product contract, inventory, runbook, and source-hash
   provenance pinned to source commit
   `323b43cdd5789e6a4f7ce63b0d05ade91ebe0989`.
2. Register CLIProxyAPI Magisk as optional capability
   `provider-gateway-runtime`; registry presence is only a TCP observation.
3. Keep module source, generated ZIPs, root-managed runtime state, live config,
   credentials, and plugins outside this repository.
4. Treat source device evidence as historical recovery context. Any current
   runtime claim requires fresh, explicitly authorized device proof.
5. Preserve the source security boundaries: loopback-only listener, remote
   management disabled, reduced-privilege core, secret-free evidence,
   persistent plugins/state, data-preserving uninstall, confirmed destructive
   purge, verified atomic core promotion, and rollback.

## Alternatives considered

1. Copy the complete module implementation into this repository — rejected
   because this control plane does not own that product and would create two
   diverging implementation authorities.
2. Copy only the source runbook verbatim — rejected because it mixes unrelated
   device history with current product truth and contains time-bound live-state
   assertions.
3. Record only a URL — rejected because future work would lack an offline,
   reviewable operating and safety contract.
4. Treat historical device validation as current proof — rejected because
   installed state and upstream releases can drift after the pinned commit.

## Consequences

Future agents can discover the capability, load its exact safety and recovery
context, and trace each imported claim to a pinned source file. The control
plane stays secret-free and does not gain root mutation authority.

Runtime implementation changes still belong in the source repository. A later
knowledge refresh must fetch a live primary source, review semantic drift, and
update the pinned commit and hashes rather than silently replacing this memory.

## Validation

- Verify every recorded SHA-256 against the pinned source commit.
- Parse the inventory and provenance JSON.
- Resolve every repository-local documentation link.
- Query the Harness capability record.
- Run `./qa/verify --mode targeted` and the final mandatory repository gate.
