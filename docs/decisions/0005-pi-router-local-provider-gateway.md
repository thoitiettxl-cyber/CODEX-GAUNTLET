# 0005 Use Pi provider runtime behind a local Responses gateway

Date: 2026-07-26

## Status

Accepted

## Context

Current Codex clients accept only the Responses wire API for custom model
providers, while AgentRouter's documented Codex integration still uses the
removed Chat Completions wire mode. Pi already supports the relevant upstream
provider protocols, interactive login, credential persistence, OAuth refresh,
model discovery, and normalized streaming.

Pi's credential store is keyed by provider and holds one credential per
provider. Pi is not itself a multi-account HTTP gateway.

## Decision

Create `pi-router` as an optional loopback-only service that:

- imports the pinned Pi provider runtime instead of launching Pi CLI sessions;
- owns credential and model configuration separately from Pi CLI;
- exposes an OpenAI Responses-compatible HTTP/SSE boundary for Codex;
- keeps protocol translation, local client authentication, and future
  account-pool policy outside Pi's Gauntlet extension;
- disables optional remote model-catalog refresh by default, with an explicit
  environment opt-in for providers that require discovery.

The MVP supports one credential per provider. A later multi-account design
must add an explicit account pool rather than changing the meaning of Pi's
provider-keyed credential store.

## Alternatives Considered

1. Continue adapting AgentRouter directly to Codex. Rejected because the
   documented integration depends on the removed Chat Completions wire mode.
2. Extend CLIProxyAPI. Deferred because it introduces a separate lifecycle and
   translation surface and does not reuse the already installed Pi provider
   runtime.
3. Run Pi CLI in RPC or print mode behind HTTP. Rejected because it adds an
   agent loop, session semantics, prompt policy, and tools to a provider-only
   gateway.
4. Add the gateway to `.pi/extensions/gauntlet/`. Rejected because that
   extension owns repository policy and continuity, not provider credentials
   or network serving.

## Consequences

Positive:

- one provider implementation supplies API-key and OAuth-backed upstreams;
- Codex receives its required Responses protocol without requiring upstream
  Responses support;
- router credentials remain independent from Pi CLI state;
- multi-account routing can be added later at an explicit boundary.

Tradeoffs:

- Pi Router owns a strict Responses translation contract and its tests;
- the pinned Pi package becomes a reviewed production dependency;
- a local bearer key and process supervision are required;
- provider terms and quota semantics remain provider-specific.

## Follow-Up

- Add multi-account selection only after one-account failure behavior and
  protocol fidelity are proven.
- Add inbound Anthropic Messages and Chat Completions endpoints as separate
  stories.
- Define a recoverable Termux launcher/update lane after the source MVP passes.
