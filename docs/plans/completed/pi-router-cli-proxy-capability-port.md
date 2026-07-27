# Port CLI Proxy management capabilities to Pi Router

Harness story: `TERMUX-010`

## Current context

Pi Router `0.3.0` has a seven-page operations console, but its current
management boundary still assumes one credential per provider in one selected
Pi account. The same `PI_ROUTER_API_KEY` protects both `/v1/*` and
`/management/api/*`; quota has no production adapters; and the browser-safe
`models.json` editor intentionally omits account pools, proxy API-key
management, model aliases, excluded models, and per-provider proxy settings.

The requested behavior is already established in
`router-for-me/Cli-Proxy-API-Management-Center` at current HEAD
`21af57620b45f5e159e5450bc7e702498b664639`. The relevant upstream behavior is:

- a management key authenticates the console while separately managed proxy
  API keys authenticate inference clients;
- OAuth/device flows cover Codex, Claude, Antigravity, Kimi, and xAI/Grok and
  retain account identity so same-provider credentials remain distinguishable;
- quota is loaded per auth record through provider-specific request and parser
  adapters;
- provider entries expose base URL, headers, proxy, aliases, exclusions, and
  arbitrary OpenAI-compatible definitions.

Pi Router must port those outcomes through its own loopback, Pi runtime,
Responses, secret-handling, and atomic-write contracts. It must not copy the
upstream remote-management posture, browser persistence, raw auth-file
transport, arbitrary authenticated `api-call` proxy, or dependency graph.

## Accepted outcome

- Add a required `PI_ROUTER_MANAGEMENT_KEY` for `/management/api/*`, distinct
  from one or more router-owned proxy API keys accepted by `/v1/*`.
- Manage proxy API keys through metadata-safe Management API/UI operations.
  New key values are returned only once on creation or replacement and are
  stored in router-owned state with mode `0600`.
- Preserve migration compatibility by seeding the proxy-key store from
  `PI_ROUTER_API_KEY` when no persisted proxy keys exist; never treat the
  management key as an inference key.
- Represent OAuth/API-key credentials with stable credential IDs, provider,
  account ID, type, label, and active-account metadata. Permit multiple
  credentials for one provider by using isolated Pi account stores.
- Let auth sessions target a new or existing account. After successful OAuth,
  derive a bounded label from provider-returned safe identity metadata when
  available, with a deterministic non-secret fallback, and prevent ambiguous
  duplicate labels.
- Keep inference on the explicitly selected startup account. Multi-account
  rotation/failover remains out of scope; additional accounts are manageable
  and quota-queryable without silently changing routing.
- Add reviewed server-side quota adapters for Codex, Claude, Antigravity,
  Kimi, and xAI/Grok. Each adapter receives one exact credential context,
  uses fixed provider endpoints and bounded responses, and returns normalized
  per-credential windows. Unsupported providers remain explicit.
- Expand the validated provider document with router-owned `modelAliases`,
  `excludedModels`, and `proxyUrl` fields while preserving Pi-compatible
  `models.json` input. Apply aliases/exclusions in model listing/resolution and
  apply proxy configuration only through reviewed provider-scoped runtime
  settings.
- Support arbitrary custom provider IDs and arbitrary OpenAI-compatible
  provider definitions without a hard-coded UI provider list.
- Update Dashboard, AI Providers, Auth Files, OAuth Login, Quota Management,
  and Config Panel to expose these behaviors while retaining the self-contained
  one-file HTML, no browser persistence, accessibility, loopback, CSP, update,
  rollback, and sanitized logging contracts.
- Rebuild the committed HTML and native Termux Android AArch64 SEA from the
  final source, then pass the canonical repository gate.

## Approach

1. Amend the product contract and add a durable architecture decision for the
   split authentication boundary, account catalog, per-credential quota, and
   router provider policy.
2. Add atomic router-owned stores for proxy API keys and account metadata, with
   migration and redaction tests.
3. Extend runtime/account composition so management can enumerate and log into
   isolated accounts while inference remains bound to the selected account.
4. Add typed quota adapters and provider-policy transforms using deterministic
   fake upstream responses.
5. Extend Management API routes and typed frontend client contracts.
6. Port the upstream operator flows into the existing dependency-minimal
   Pi Router pages.
7. Rebuild HTML and binary artifacts, run focused proof, review the final diff,
   perform spec-check, and run `./qa/verify --mode targeted`.

## Progress

- [x] Read repository workflow, product contract, architecture, ADRs, completed
      Management Center plans, implementation, tests, and verification skill.
- [x] Inspected upstream Management Center and CLIProxyAPI HEAD for the four
      requested capability areas.
- [x] Updated product and architecture contracts.
- [x] Implemented split management/proxy authentication and proxy-key storage.
- [x] Implemented multi-account credential catalog and labelled auth sessions.
- [x] Implemented per-credential quota adapters.
- [x] Implemented flexible provider policy and custom OpenAI-compatible entries.
- [x] Updated the operations-console UI and rebuilt the one-file artifact.
- [x] Rebuilt, checked, and smoke-tested the native Termux binary.
- [x] Ran focused proof, spec-check, final diff review, and canonical verify.
- [x] Recorded final Harness proof, moved this plan to completed, and completed
      `TERMUX-010`.

## Last safe boundary

Pi Router `0.4.0`, its one-file console, and its Android AArch64 binary
implement the accepted outcome. Focused proof, canonical verification, and
Harness completion proof are green. `TERMUX-010` is implemented; recovery
remains the atomic state/config paths and verified binary rollback described
below.

## Decisions

- Use upstream behavior as the feature reference, not as a source-compatible
  backend or security model.
- Keep `/v1/*` client keys and the management key as separate credential
  classes.
- Reuse Pi account isolation for multiple same-provider credentials rather
  than changing Pi's provider-keyed `auth.json` format.
- Keep inference account selection explicit at process startup; this task does
  not introduce automatic rotation, failover, or hidden account switching.
- Query quota only through fixed provider adapters. Do not add an arbitrary
  credential-injecting HTTP endpoint.
- Preserve one self-contained frontend. Promote the exact `undici@8.5.0`
  version already pinned transitively by Pi to a direct dependency so
  provider-scoped proxy dispatch is explicit and independently reviewable;
  do not introduce another transport dependency.
- Scope the Undici dispatcher through both async setup and deferred iterator
  consumption so a genuinely lazy provider stream cannot escape its selected
  proxy or inherit another provider's proxy.

## Risks

- Authentication-boundary migration can lock out either API clients or the
  console if precedence and empty-store semantics are not deterministic.
- Account labels may be unavailable for providers whose Pi credential metadata
  lacks an email/name; fallback labels must remain unique without exposing
  token material.
- Quota endpoints and payloads are provider-specific and temporally unstable.
  Network code must be bounded, injectable, and failure-isolated.
- Pi's pinned runtime owns credential writes and supports one credential per
  provider per `auth.json`; management must not concurrently mutate the same
  account/provider pair.
- Provider proxy and alias transforms can make model resolution ambiguous or
  route traffic differently. Preview and validation must show these changes.
- Any source or HTML change makes the committed SEA stale until it is rebuilt
  natively on Android AArch64.

## Recovery

- Atomic stores retain the previous validated document and never overwrite a
  valid store on parse or validation failure.
- Existing `PI_ROUTER_API_KEY` remains a migration input for an empty proxy-key
  store, so current inference clients remain usable after first upgrade.
- Account credentials remain in their isolated account directories; failure
  to catalog or label an account does not rewrite its `auth.json`.
- Failed quota reads do not mutate credentials or routing state.
- Config preview/apply/restore remains revision-checked and atomically
  recoverable.
- The existing verified binary `.previous` rollback lane remains the packaged
  release recovery mechanism.

## External side effects

- Read-only clones of upstream Management Center and CLIProxyAPI were created
  under the Termux temporary directory for source comparison.
- No live provider login, quota request, inference request, release operation,
  publication, push, or credential read has occurred.

## Validation

- `npm run build:web && npm run typecheck:web && npm run check:web &&
  npm run test:integration` passed. The committed HTML is reproducible and all
  10 Management/Responses integration tests passed.
- `npm run build:binary && npm run check:binary && npm run test:binary`
  passed on Android AArch64. The committed ELF64 binary uses
  `/system/bin/linker64`; its SHA-256 is
  `04dfb50a80e88e7494b1ca6106506a42651575b48bd606567bf8597d44d00985`.
- `npm run check && npm test && npm run test:coverage` passed: 62/62 tests and
  82.7% Pi Router source line coverage.
- Manual spec-check found direct implementation and executable evidence for
  all accepted outcomes, no raw auth-file or generic credential-injecting API
  surface, no browser persistence, and no management/inference key crossover.
- `./qa/verify --mode targeted` passed its first full run: 65/65 repository
  self-checks, Pi Router unit 48/48, integration 10/10, acceptance 4/4,
  mutation 28/28, and coverage.
- `story complete TERMUX-010` ran the same canonical command as fresh proof,
  passed, and atomically moved the Harness lifecycle to `implemented`.
- `npm audit --omit=dev --json` reports one high-severity advisory in
  `brace-expansion@5.0.7` below the pinned Pi runtime's `minimatch`. The exact
  nested version was already present in the pre-change lockfile; this task did
  not run an unrelated dependency override or `npm audit fix`.
