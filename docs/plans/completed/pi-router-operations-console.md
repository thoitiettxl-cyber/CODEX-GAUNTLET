# Rebuild Pi Router Management Center as an operations console

Harness story: `TERMUX-009`

## Current context

`TERMUX-008` is complete against its original contract. It delivered a
self-contained React/TypeScript page with `Overview / Probe / Updates`, a
bounded Management API, verified updates, and a native Termux Android AArch64
SEA binary. The current binary is version `0.2.0` with SHA-256
`51b3c92c3571bb71c6cfdf4403efa656d15a3874d7bf9ae22f094e05cf496db2`.

The operator has rejected that Web UI as visually unprofessional and
insufficient for day-to-day operations. This is a new product change, not a
failure of the already completed binary-build lane and not a reason to rewrite
the history of `TERMUX-008`.

The accepted primary navigation for this story is:

```text
OPERATE
  Dashboard
GATEWAY
  AI Providers
  Auth Files
  OAuth Login
OBSERVE
  Quota Management
  Logs Viewer
CONTROL
  Config Panel
```

No additional top-level page is in the current requested scope. Existing
Responses, update, rollback, and binary behavior must remain working, but
`Probe` and `Updates` are not part of this primary navigation.

The logic and information architecture may learn from
`router-for-me/Cli-Proxy-API-Management-Center` at inspected commit
`21af57620b45f5e159e5450bc7e702498b664639`. Relevant upstream patterns are
feature/page/API/store separation, grouped navigation, capability-aware empty
states, provider-specific adapters, and a self-contained HTML build. Do not
copy its backend contract, remote-management model, browser credential
persistence, dependency set, or raw credential/log behavior into Pi Router.

## Current assessment

The existing page passes its old tests, but its implementation and information
hierarchy do not match an operations console:

- `pi-router/web/src/main.tsx:447` starts one `App` component that owns health,
  authentication, model discovery, request composition, streaming, release
  mutation, notices, and every page render. The file is 1,786 lines.
- `pi-router/web/src/styles.css` is one 2,970-line global stylesheet. Page,
  layout, control, and responsive rules have no feature ownership.
- `pi-router/web/src/main.tsx:986` provides only three in-memory tab buttons;
  the active surface is not deep-linkable and does not implement the requested
  grouped navigation.
- `pi-router/web/src/main.tsx:1005` reserves a large route-rail visualization
  for every surface, while `pi-router/web/src/main.tsx:1036` reserves the
  connection panel beside every surface. Decorative routing detail therefore
  outranks operational inventory and actions.
- `pi-router/web/src/styles.css:289` and
  `pi-router/web/src/styles.css:360` rely on dense uppercase condensed text and
  8–10 px labels. Together with fixed 680 px workbench panels at
  `pi-router/web/src/styles.css:456`, this makes the UI visually busy and slow
  to scan.
- `pi-router/web/src/main.tsx:1159` and
  `pi-router/web/src/main.tsx:1326` use tab roles without tab/panel IDs,
  `aria-controls`, roving focus, or arrow-key behavior.
- Form controls beginning at `pi-router/web/src/main.tsx:1059` have labels but
  no meaningful `name`; several placeholders are generic rather than
  example-shaped. `pi-router/web/shell.html:16` has no skip link.
- The backend gap is material: `pi-router/src/management.js` exposes only
  status and update operations, while `pi-router/src/server.js` routes only
  status, update, models, and Responses requests. There is no management API
  for provider inventory, credential metadata, browser login sessions, quota,
  logs, or config mutation.

The current product contract explicitly excludes provider login/logout,
credential mutation, `models.json` editing, and request history from the Web
UI. The contract and security boundary must therefore change before
implementation.

## Accepted outcome

- Replace the current visual hierarchy with a calm, responsive operator shell:
  grouped sidebar navigation on wide screens, an accessible drawer on narrow
  screens, a compact status header, clear page titles, consistent cards,
  tables, filters, empty states, loading states, and destructive-action
  confirmations.
- Make each requested page addressable through a stable hash route so reload,
  back/forward, and copied local URLs restore the selected page without adding
  a routing dependency unless one becomes demonstrably necessary.
- Keep the page one committed, offline-capable HTML file with no CDN, remote
  font, telemetry, cookie, local-storage, session-storage, or IndexedDB use.
- Keep the serving origin loopback-only and require the router bearer for every
  management read or mutation. The bearer and all login input remain only in
  current page memory.
- Dashboard shows actionable bounded state: service/version/uptime, active
  account, configured provider and credential counts, available models,
  request/error activity, quota capability summary, and restart/update
  posture. It must not be a decorative topology page.
- AI Providers lists registered providers, supported auth modes, configured
  status, model counts, availability/error state, and safe actions.
- Auth Files lists only non-secret credential metadata. It may initiate a
  replace/login flow or confirmed logout, but it never displays, returns,
  downloads, or copies API keys, access tokens, refresh tokens, credential
  JSON, or the raw `auth.json` path.
- OAuth Login adapts Pi's `AuthInteraction` into bounded, cancellable,
  single-use browser sessions that can emit auth URLs, device codes, progress,
  prompts, completion, and failure. Sessions must expire, serialize conflicting
  provider mutations, and never echo stored credentials.
- Quota Management uses explicit provider capability adapters. It reports real
  provider-backed quota only where a reviewed adapter exists and renders a
  clear unsupported state elsewhere; it must not infer or fabricate quota from
  model token usage.
- Logs Viewer reads a bounded, sanitized operational event buffer. Events may
  contain timestamp, request class, status, duration, model/provider identity,
  and bounded error code, but never authorization headers, prompts, request or
  response bodies, credential values, environment values, raw upstream
  response bodies, or state/executable paths. Persistence is off unless a
  later contract explicitly adds it.
- Config Panel edits only a schema-defined router-owned configuration surface.
  The initial safe boundary is `models.json` plus explicitly approved
  non-secret router settings; arbitrary paths, environment secrets, executable
  targets, and raw credential files are not editable. Show validation and a
  diff before an atomic write, and report whether runtime refresh or process
  restart is required.
- Preserve the accepted `/v1/*`, verified update/rollback, loopback, CSP,
  no-cache, credential isolation, and binary recovery contracts.
- Rebuild and recommit `web/dist/index.html`, then rebuild the native Termux
  binary so its embedded HTML and management backend exactly match source.

## Modular design boundary

Use existing React, TypeScript, esbuild, and Node facilities first. Do not copy
the upstream dependency graph merely to resemble it.

Target frontend ownership:

```text
pi-router/web/src/
  app/                 shell, navigation, hash routing, page composition
  components/ui/       buttons, cards, tables, dialogs, fields, states
  features/dashboard/
  features/providers/
  features/auth-files/
  features/oauth/
  features/quota/
  features/logs/
  features/config/
  lib/api/             bearer-aware client and typed response guards
  lib/format/          locale-aware time, number, duration, and size formatting
  styles/              tokens, reset, shared layout, accessibility utilities
  main.tsx             bootstrap only
```

Target backend ownership:

```text
pi-router/src/management/
  index.js             service composition only
  status.js
  providers.js
  credentials.js
  auth-sessions.js
  quota.js
  quota-adapters/
  event-log.js
  config.js
  validation.js
  routes.js
```

`PiRuntime` may expose the pinned runtime's existing
`getProviders()`, `getModels()`, `checkAuth()`, `getProviderAuthStatus()`, and
`listCredentials()` capabilities through sanitized adapters. Provider-specific
network behavior stays outside generic route parsing. File writes, auth
mutations, and OAuth sessions are separate services with independent tests and
serialization.

## Approach

1. Update `docs/product/pi-router.md` and the relevant architecture decision
   before widening the Web UI or Management API. Specify auth-session,
   credential-metadata, quota-capability, sanitized-log, config-write, restart,
   and retention semantics.
2. Add deterministic backend contracts and fake-runtime tests for each new
   management domain before connecting UI pages.
3. Split the frontend bootstrap, API client, shell, shared controls, and
   features. Establish the requested navigation and design tokens with mocked
   states at desktop and narrow widths.
4. Implement vertical slices in dependency order: Dashboard/provider
   inventory; credential metadata; OAuth/API-key login and logout; sanitized
   event log; capability-driven quota; validated config diff/write/reload.
5. Exercise accessibility and operator workflows: keyboard navigation,
   visible focus, skip link, labels/names, announcements, reduced motion,
   unsaved-change guard, destructive confirmation, empty/loading/error states,
   long provider/model names, and narrow Android screens.
6. Rebuild the single HTML artifact, run focused source/API/browser evidence,
   rebuild and natively smoke-test the Android AArch64 SEA, review the final
   diff, and pass canonical verification.

## Progress

- [x] Inspected the completed `TERMUX-008` contract, plan, source, tests,
      runbook, binary provenance, and work graph.
- [x] Audited the current UI structure and Web Interface Guidelines gaps.
- [x] Inspected the named upstream reference at a fixed commit and selected
      reusable architectural patterns without adopting its incompatible
      security assumptions.
- [x] Recorded the operator's exact primary navigation and safe default
      credential/log/config boundaries.
- [x] Created this durable handoff and linked planned story.
- [x] Update product and architecture contracts for the expanded management
      boundary.
- [x] Implement modular backend Management API services with deterministic
      proof.
- [x] Implement the modular operations-console frontend and responsive visual
      system.
- [x] Rebuild the self-contained HTML and native Termux binary.
- [x] Run focused proof, native binary proof, spec check, final diff review,
      and `./qa/verify --mode targeted`.
- [x] Complete the story and move this plan to `completed/`.

## Result

Pi Router `0.3.0` now ships the exact seven-page operations console, modular
Management API domains, bounded auth sessions, metadata-only credential
operations, explicit quota capabilities, sanitized in-memory events, and
validated atomic configuration recovery. The committed HTML and native Android
AArch64 SEA were rebuilt from the final source. Existing `/v1/*`,
update/rollback, loopback, bearer, and binary recovery behavior remains covered
by deterministic and native proof.

## Decisions

- Treat this as `TERMUX-009`, not a reopening of `TERMUX-008`.
- Use the requested seven-page information architecture exactly; defer other
  top-level pages.
- Preserve existing Probe/Responses and update/rollback behavior at the
  backend and test boundary while removing them from primary navigation.
- Learn upstream domain decomposition and operator flows, not its API paths,
  persistence model, source code, dependencies, or remote-management posture.
- Keep credential enumeration metadata-only. Raw credential import/export is
  outside scope unless the product contract and user explicitly authorize it.
- Keep logs sanitized and bounded in memory by default.
- Treat quota as provider-specific capability, never a fabricated generic
  number.
- Restrict config mutation to validated router-owned state with preview,
  atomic replacement, and explicit activation semantics.
- Keep the frontend dependency-minimal and retain the one-file build.
- Ship no default quota adapter; an explicit operator read returns
  `unsupported` until a provider-specific adapter receives separate review.
- Reject config drafts whose complete field diff exceeds 200 changes, complex
  unreviewed compat objects, secret-bearing headers/URLs, and non-enum compat
  values before any write.
- Bump the router and artifact version from `0.2.0` to `0.3.0` because the
  Management API and embedded console are materially expanded.

## Risks

- OAuth login is interactive and asynchronous. A naive request/response
  wrapper can leak prompts, orphan provider flows, double-write credentials,
  or hold HTTP requests indefinitely.
- Provider quota semantics and endpoints are not uniform and are not exposed
  by the current generic `ModelRuntime` API.
- Logs and auth/config screens expand the sensitive-data surface. Returning raw
  bodies, headers, errors, environment values, paths, or credentials would
  violate the current security posture.
- Config edits can make startup fail. Schema validation, diff preview, atomic
  replacement, retained recovery input, and activation reporting are required.
- Every source or HTML change makes the committed SEA binary stale until it is
  rebuilt natively on Android AArch64.
- Adding large UI libraries can bloat the one-file artifact and expand the
  dependency/security review surface without improving operator workflows.

## Recovery

- Keep the current `0.2.0` binary and checksum as the known-good baseline until
  the replacement passes native proof.
- Build each backend domain behind its own service and tests; disable or remove
  an unaccepted route without changing credential files.
- Config writes retain the last validated configuration for atomic restore;
  failed validation never replaces the live file.
- Cancelling or expiring an auth session aborts only that session and never
  deletes a previously valid credential.
- If quota support is unproven for a provider, return a typed unsupported
  result rather than making an exploratory provider request.
- The existing verified binary rollback lane remains the release recovery
  mechanism after a new artifact is installed.

## External side effects

- Harness lifecycle moved `TERMUX-009` from `planned` to `in_progress` using
  stable run id `20260726-termux-009-implementation`.
- Harness completion reran the story verification command, recorded a passing
  completion event, moved `TERMUX-009` to `implemented`, and linked this
  completed plan using the same stable run id.
- The build lane used the checksum-pinned Termux Node input and rewrote only
  the committed Pi Router HTML, binary, checksum, and provenance artifacts.
- `qa/verify` ran the repository-declared `npm ci`; this refreshed ignored
  `node_modules` only and did not change the dependency lock beyond the
  intentional router version bump.
- No live provider login, credential, quota, inference, or configuration
  mutation ran. No release was checked, installed, published, tagged, pushed,
  or deployed.

## Validation

- `npm --prefix pi-router run build` and
  `npm --prefix pi-router run check` passed TypeScript, reproducible one-file
  HTML, source loading, binary input freshness, provenance, ELF identity, and
  checksum checks.
- `npm --prefix pi-router test` passed 53/53 deterministic tests. New proof
  covers all Management API domains, provider mutation serialization,
  expiring/cancellable/single-use auth without secret echo, adapter-only
  quota, fixed-shape logs, config validation/diff/revision/apply/restore, the
  seven routes, CSP/no-storage/no-remote-asset rules, and preserved Responses
  behavior.
- `npm --prefix pi-router run test:coverage` passed at 83.8% Pi Router source
  line coverage.
- `npm --prefix pi-router run test:binary` executed the final artifact natively
  on Android AArch64 and passed version/help/model/server/health/embedded-UI,
  authenticated status/provider API, and clean-shutdown smoke.
- `npm --prefix pi-router run check:binary` confirmed ELF64 AArch64,
  `/system/bin/linker64`, mode `0755`, source freshness, and SHA-256
  `ba753352b5c2b4d99f4d52690dccad6422c2d544a680f79a828a401e5729034f`.
- Generated-HTML integration proof checks exact navigation labels, stable
  hash-route code, skip/focus/drawer hooks, desktop/narrow media rules,
  reduced motion, destructive dialogs, CSP hashes, absence of inline style
  attributes, browser storage, external assets, and entered secrets. No
  standalone WebDriver-capable browser was available in this Termux session,
  so no screenshot or pixel-level visual-regression claim is made.
- Spec check found no contradiction across the active-plan outcome, product
  contract, ADR 0007, architecture, implementation, tests, runbook, generated
  artifact, binary, and provenance.
- `./qa/verify --mode targeted` passed 65/65 Gauntlet self-checks, policy
  audit, build, unit, integration, acceptance, 83.8% coverage, and mutation.
