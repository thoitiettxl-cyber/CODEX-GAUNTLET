# Port the Pi Router management UI stack and operator experience

Harness story: `TERMUX-011`
Status: Implemented

## Current context

Pi Router `0.4.0` already has a modular seven-page React/TypeScript operations
console and the management capabilities completed by `TERMUX-009` and
`TERMUX-010`. The new operator request in
`/storage/emulated/0/Download/tag.md` asks for the current frontend stack and
interaction patterns of
`router-for-me/Cli-Proxy-API-Management-Center`, without copying its branding,
assets, license text, remote-management assumptions, or backend contract.

The reference was inspected read-only at commit
`21af57620b45f5e159e5450bc7e702498b664639`.

The concrete gaps in the current Pi Router console are:

- it bundles with a custom esbuild script instead of Vite single-file;
- it uses component-local state, `fetch`, and a handwritten hash parser rather
  than Zustand, Axios, and React Router `HashRouter`;
- it uses global CSS and hard-coded English strings rather than SCSS Modules
  and i18next resources;
- it has no theme/language controls or System route;
- Config Panel uses a JSON textarea and field-list preview rather than a YAML
  CodeMirror source editor and source diff;
- Logs Viewer refreshes only on demand and has no incremental polling,
  auto-refresh, management-event filtering, or clear-view action;
- Auth Files lacks search/pagination and capability-aware advanced metadata;
- the management bearer is memory-only and has no opt-in obfuscated persistence
  or local-login-data removal control.

The backend intentionally does not expose persistent raw logs, arbitrary
credential files, per-credential model-policy mutation, request-logging
mutation, or raw `config.yaml`. Those features require separately accepted
Management API contracts. This story preserves every existing route and
request/response shape and implements capability-aware unavailable states
instead of inventing endpoints.

## Approach

1. Amend the product contract and record the frontend architecture/security
   boundary before implementation.
2. Move the web build to Vite, `vite-plugin-singlefile`, ES2020, React Router,
   Zustand, Axios, i18next, Motion, CodeMirror/YAML, and SCSS Modules while
   preserving one offline HTML artifact.
3. Refresh the shared shell, theme, responsive navigation, loading states, and
   notifications without copying upstream branding or assets.
4. Implement the requested vertical slices in order: Config source/diff, Logs
   polling/filtering, System, Auth Files capability presentation, i18n, and
   opt-in obfuscated bearer persistence.
5. Extend deterministic frontend/artifact assertions, rebuild the committed
   HTML and native Termux SEA, run focused proof and coverage, review the final
   diff, perform spec-check, and run the canonical repository gate.

## Progress

- [x] Read the request, repository workflow, product contract, architecture,
      relevant ADRs, runbook, completed Pi Router plans, source, tests, and
      required verification skills.
- [x] Inspected the reference repository at a fixed commit and recorded the
      implementation gaps and incompatible backend/security assumptions.
- [x] Update product/architecture contracts and create the frontend ADR.
- [x] Port the build/runtime frontend stack and shared design system.
- [x] Implement Config, Logs, System, and Auth Files improvements.
- [x] Implement complete vi/en resources, theme, and obfuscated local login
      storage.
- [x] Rebuild artifacts and pass focused, coverage, native, spec, and canonical
      verification.

## Last safe boundary

The worktree was clean before this plan. Intake `#16` was recorded with stable
run id `20260727-termux-011-management-ui-port`; the story is implemented.
Frontend source, the Vite-generated HTML, and the Android AArch64 SEA were
rebuilt locally. No credential, provider state, release, publication, push, or
external service was mutated.

## Decisions

- Treat the reference as a UX/architecture specimen only. Use no upstream logo,
  image, brand name, license text, or copied component implementation.
- Preserve every existing Pi Router Management API route and payload. A YAML
  editor is a client-side projection of the existing validated combined
  non-secret document; preview/apply still use revision-protected structured
  endpoints.
- Keep persistent raw logs and raw credential transport out of this story.
  Incremental polling uses the existing bounded sanitized event API.
- Add a System page using status, update-check, local-data cleanup, and an
  explicitly entered proxy key for `/v1/models`. Show request-log mutation as
  unavailable until a backend capability is accepted.
- Store a management bearer only when the operator explicitly opts in. The
  stored value must use a Pi-specific `enc::v1::` reversible-obfuscation
  envelope and fail closed rather than falling back to plaintext. Document
  clearly that browser obfuscation is not cryptographic protection.
- Preserve the restrictive CSP. CodeMirror runtime styles must use a
  per-response nonce rather than enabling `unsafe-inline`.

## Risks

- Vite/CodeMirror add a much larger browser dependency graph and can break
  native Termux installation or the one-file/CSP guarantees.
- Persisting a reversible bearer changes the accepted secret-retention
  posture. Opt-in semantics, scoped clearing, no plaintext fallback, and
  explicit warning text are mandatory.
- YAML serialization can lose comments because the existing backend exposes a
  structured safe document, not raw source. The UI must describe this as a safe
  projection and preserve semantic values.
- A stale frontend may overwrite a newer configuration. Existing preview
  revision compare-and-set remains mandatory.
- Any HTML or source change makes the committed Android AArch64 SEA stale until
  a native rebuild succeeds.

## Recovery

- Keep backend API code and router-owned state formats unchanged.
- Configuration preview remains read-only; failed YAML parse/validation never
  calls Apply, and revision conflicts require reload.
- The current committed HTML/binary/checksum/provenance remain recoverable from
  Git until their replacements pass focused and native proof.
- Dependency or Vite failures can be recovered by reverting only this story's
  package/build/frontend changes; no credential or runtime state migration is
  required.

## External side effects

- Harness intake `#16` uses stable run id
  `20260727-termux-011-management-ui-port`.
- A read-only shallow clone of the public reference exists at
  `/data/data/com.termux/files/usr/tmp/pi-router-reference.NOFAC7/upstream`.
- `npm install --ignore-scripts`, the canonical `qa/run-build.sh` dependency
  install, and the native SEA build fetched only pinned package/runtime inputs;
  `npm audit fix` was not run.
- No provider login, quota request, inference request, update check, install,
  rollback, release, publication, push, or credential read has occurred.

## Validation

Focused typecheck, build, integration/all tests, coverage, native
check/smoke evidence, spec-check, and the canonical gate now pass:

- `npm --prefix pi-router run typecheck:web`, `build:web`, and `check:web`
  passed with one self-contained `web/dist/index.html`.
- `npm --prefix pi-router run test:integration` passed 10/10 and
  `npm --prefix pi-router test` passed 62/62.
- `npm --prefix pi-router run test:coverage` passed at 4692/5670
  (`82.8%`) Pi Router source line coverage; this is above the 82.7% prior
  baseline.
- `npm --prefix pi-router run build:binary`, `check`, `test:binary`, and an
  independent `sha256sum -c` passed on Android AArch64. The committed ELF64
  artifact uses `/system/bin/linker64`; SHA-256 is
  `382bf927f63fb9b7a016420c583b35bfb150b7dbc3b97c750474adf93382e26c`.
- Manual spec-check found direct implementation for the requested stack,
  routes, i18n, storage, Config YAML projection/diff, incremental bounded
  event polling, capability-gated unsupported operations, and preserved
  Management API contracts; no fake backend endpoints or reference branding
  were introduced.
- `./qa/verify --mode targeted` passed: 65/65 repository checks, build,
  unit 48/48, integration 10/10, acceptance 4/4, coverage, and mutation
  28/28.
