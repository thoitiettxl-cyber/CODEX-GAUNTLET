# 0007 Bound the Pi Router operations console

Date: 2026-07-26

## Status

Superseded by ADR 0015.

## Context

The original Management Center exposes runtime status and verified binary
updates, but its `Overview / Probe / Updates` information hierarchy does not
support routine provider operations. Pi's pinned `ModelRuntime` already owns
provider enumeration, model inventory, metadata-only credential listing,
interactive login, serialized credential storage, logout, and offline
configuration refresh.

Exposing those primitives directly would widen the browser boundary to
credentials, asynchronous OAuth prompts, provider-specific quota traffic,
operational data, and router configuration. Raw credentials, provider
responses, paths, or arbitrary files cannot safely cross that boundary.

## Decision

Rebuild the Management Center as a seven-page operations console behind the
existing loopback listener and router bearer:

- Dashboard;
- AI Providers;
- Auth Files;
- OAuth Login;
- Quota Management;
- Logs Viewer;
- Config Panel.

Keep the HTML unauthenticated so an operator can enter the local bearer, but
require that bearer for every management read and mutation. Keep the bearer
and all login input in page memory and retain the one-file offline build.

Adapt Pi runtime capabilities through domain-specific management services:

- provider and credential responses are metadata-only;
- browser login is an expiring, cancellable, single-use session protocol whose
  prompt responses are never echoed;
- credential mutations are serialized per provider;
- quota is available only through reviewed provider adapters and is otherwise
  explicitly unsupported;
- operational events are fixed-shape, sanitized, bounded to 250 records, and
  process-memory-only;
- configuration mutation is restricted to an allowlisted non-secret
  `models.json` schema with preview, revision compare-and-set, same-directory
  atomic replacement, retained validated recovery input, and explicit
  activation state.

Retain `/v1/*`, update/install/rollback, loopback, CSP, no-cache, credential
isolation, and verified Termux SEA behavior. The console does not become a
Harness, Gauntlet, arbitrary filesystem, process-control, or general provider
proxy surface.

## Alternatives Considered

1. Copy the Cli-Proxy-API Management Center backend and browser persistence.
   Rejected because its remote-management and credential assumptions do not
   match Pi Router's loopback and in-memory secret boundary.
2. Return `auth.json` or accept credential JSON uploads. Rejected because
   metadata and provider-owned login/logout are sufficient for current
   operations and raw credential transport creates an unnecessary secret
   surface.
3. Derive a generic quota number from model usage. Rejected because provider
   quotas have different authorities, windows, units, and endpoints.
4. Expose an arbitrary JSON/path editor. Rejected because it could disclose
   or overwrite credentials, environment-backed secrets, executables, and
   unrelated files.
5. Persist request logs or browser state. Rejected because current operational
   needs are satisfied by bounded process-memory metadata.

## Consequences

Positive:

- operators receive stable, deep-linkable day-to-day workflows;
- sensitive provider state remains behind typed, bounded adapters;
- unsupported quota and activation states are explicit rather than inferred;
- config changes have stale-write protection and recoverable atomic writes;
- backend domains and frontend features can be tested independently.

Tradeoffs:

- OAuth requires polling and prompt-response orchestration in the browser;
- terminal auth-session metadata remains in memory until bounded eviction;
- the initial quota page can show mostly unsupported providers;
- the Web UI intentionally cannot edit every Pi `models.json` capability;
- any source or HTML change requires a fresh native Termux SEA.

## Follow-Up

- Add a real quota adapter only as a reviewed provider-specific change.
- Expand the editable config schema only after classifying each added field as
  non-secret and defining activation/recovery behavior.
- Add process restart or supervisor integration only under a separate accepted
  contract.
