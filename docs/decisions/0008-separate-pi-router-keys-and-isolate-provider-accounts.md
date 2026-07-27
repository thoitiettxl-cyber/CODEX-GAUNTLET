# 0008 Separate Pi Router keys and isolate provider accounts

Date: 2026-07-27

## Status

Accepted

## Context

Pi Router 0.3 used the same bearer for inference clients and the operations
console, exposed only the selected Pi account, had no production quota
adapters, and intentionally offered a narrow `models.json` editor. The
CLIProxyAPI Management Center demonstrates useful operator behavior in all
four areas, but its remote-management backend, raw auth-file model, browser
persistence, and arbitrary authenticated request proxy do not match Pi
Router's loopback and secret-isolation contracts.

Pi's pinned runtime stores one credential per provider in one `auth.json`.
Changing that upstream format would fork credential refresh and locking
semantics. Pi Router also needs to keep one explicit inference account rather
than silently rotating accounts.

## Decision

Port the Management Center behavior through four router-owned adapters:

1. Require `PI_ROUTER_MANAGEMENT_KEY` for management and authenticate
   `/v1/*` with a persisted set of independently managed proxy API-key
   digests. Generate new values server-side and disclose them once. Seed an
   empty store from legacy `PI_ROUTER_API_KEY`, but never accept the management
   key as an inference key.
2. Represent multiple credentials for one provider as isolated Pi account
   directories. Maintain a non-secret catalog with stable credential/account
   ids and unique bounded labels. Keep inference bound to the account selected
   at process startup.
3. Query Codex, Claude, Antigravity, Kimi, and xAI/Grok quota separately for
   each OAuth credential through fixed, bounded, provider-specific adapters.
   Do not add the upstream arbitrary credential-injecting HTTP call surface.
4. Keep Pi-compatible model definitions in `models.json` and persist
   router-only `proxyUrl`, aliases, and exclusions in
   `provider-policy.json`. Merge them in the typed Management API, apply policy
   before model exposure/dispatch, and allow arbitrary safe custom provider
   ids including OpenAI-compatible definitions.

Promote the exact `undici@8.5.0` version already pinned by the Pi runtime to a
direct dependency. Use its dispatcher with async-local provider context so
concurrent streams can select different proxies without mutating process-wide
environment.

Use Pi-owned OAuth/device flows for Codex, Claude, Kimi, and xAI/Grok.
Register Antigravity through a router adapter only when its OAuth client
configuration is supplied by the process environment; OAuth client secret
material never crosses the browser or enters repository/config documents.

## Alternatives Considered

1. Reuse one bearer and merely relabel it in the UI. Rejected because proxy
   clients would retain management authority.
2. Extend one `auth.json` to hold arrays. Rejected because it would bypass
   Pi's provider-keyed credential store and refresh lock.
3. Automatically rotate managed accounts for inference. Rejected because it
   changes routing behavior and failure semantics beyond this management
   capability port.
4. Copy upstream auth-file upload/download and generic `api-call`. Rejected
   because either surface can disclose or apply OAuth tokens outside a
   reviewed provider boundary.
5. Put router-only fields directly in `models.json`. Rejected because the
   pinned Pi schema must remain the runtime authority for model definitions.
6. Hard-code all provider configuration cards. Rejected because arbitrary
   OpenAI-compatible provider ids are a required capability.

## Consequences

Positive:

- management authority and inference authority have independent lifecycles;
- same-provider OAuth accounts remain distinguishable without exposing raw
  credential files;
- quota failures are isolated per credential and provider;
- model policy can grow without forking Pi's configuration parser;
- the UI can create custom OpenAI-compatible providers without a release.

Tradeoffs:

- startup now requires a management key and at least one persisted or
  migration-seeded proxy key;
- additional account runtimes consume some memory even though only the
  selected account serves inference;
- the router directly owns the already-transitive Undici pin and a bounded
  provider-proxy dispatcher cache;
- policy/config apply coordinates two atomically replaced files under one
  process mutation lock;
- Antigravity login requires explicit environment-supplied OAuth client
  configuration;
- automatic multi-account routing remains a separate future decision.

## Follow-Up

- Revisit automatic account selection only with an explicit routing,
  health-check, retry, and observability contract.
- Add or revise quota endpoints only as provider-specific reviewed changes.
- Reassess Antigravity inference only when its request/response protocol has a
  pinned Pi-compatible provider adapter and deterministic tests.
