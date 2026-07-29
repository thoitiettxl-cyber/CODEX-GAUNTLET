# 0009 Use a modern single-file Pi Router console

Date: 2026-07-27

## Status

Superseded by ADR 0015.

## Context

The Pi Router operations console completed by ADR 0007 and ADR 0008 is
functional and security-bounded, but it uses a custom esbuild pipeline,
component-local application state, a handwritten hash router, global CSS, and
an English-only JSON textarea. The operator requested the current
architecture and interaction quality of the CLI Proxy API Management Center:
Vite single-file output, Zustand, Axios, React Router, CodeMirror YAML/diff,
i18next, SCSS Modules, responsive themes, incremental log polling, and a
System surface.

Pi Router's backend is deliberately narrower than the reference. It has a
sanitized in-memory event buffer rather than persistent raw log files, a
validated combined provider document rather than raw `config.yaml`, and
metadata-only isolated credentials rather than browser-readable auth files.
Matching frontend behavior must not silently import the reference backend,
remote-management, raw credential, or arbitrary file-editing boundaries.

ADR 0007 also required all browser state to remain in memory. The operator now
explicitly requires a reversible `enc::v1::` local-storage envelope for the
management key and a System action to clear it.

## Decision

- Build the React 19 and TypeScript 6 console with Vite and
  `vite-plugin-singlefile`, targeting ES2020 and retaining exactly one
  committed offline HTML artifact.
- Use React Router's `HashRouter`, Zustand application stores, one Axios
  management instance whose interceptor attaches
  `Authorization: Bearer <PI_ROUTER_MANAGEMENT_KEY>`, i18next resources for
  Vietnamese and English, Motion for lightweight transitions, and SCSS
  Modules for feature/layout ownership.
- Use CodeMirror 6 for the Config source editor and diff. YAML is a browser
  projection of the existing validated combined non-secret document; the
  client parses it and sends the resulting object through the unchanged
  preview/apply/revision contract. It is not a raw filesystem editor and YAML
  comments are not round-tripped.
- Keep the restrictive CSP. Supply CodeMirror's runtime-generated style
  modules with a per-response nonce; do not add `unsafe-inline`.
- Add System as an eighth stable hash route. It composes existing status,
  update-check, local-login cleanup, and authenticated `/v1/models`
  capabilities. A proxy key entered for model discovery stays in memory.
- Poll the existing sanitized event endpoint incrementally. Clearing affects
  the browser view only. Persistent log clear/download and request-log
  mutation remain unavailable unless a later backend contract accepts them.
  Logs remains a stable route because Pi Router's bounded process event buffer
  is always an explicit Management API capability; a future file-log
  capability may gate only its file-specific actions.
- Present Auth Files advanced model, alias, exclusion, runtime-only, and import
  controls only when typed backend capability metadata is available. Do not
  invent raw credential routes.
- Keep the management key in memory by default. Only an explicit
  operator-controlled remember choice may persist it. The persisted envelope
  uses Pi-specific reversible obfuscation prefixed by `enc::v1::`, never falls
  back to plaintext, and is described as convenience rather than encryption.
  Restoration prefills the login form but never authenticates until the
  operator submits it. Theme and language preferences may also use local
  storage. System provides a scoped local-login-data removal action.
- Copy no upstream logo, asset, brand name, license text, or component source.

This decision supersedes ADR 0007 only where ADR 0007 forbids all browser
storage, fixes the console at seven routes, and selects a dependency-minimal
handwritten frontend stack. Its loopback, typed Management API, metadata-only
credential, sanitized-event, validated-config, and one-file boundaries remain
in force.

## Alternatives Considered

1. Keep the current stack and reproduce only the colors. Rejected because the
   requested source editor, routing, state, localization, and single-file Vite
   architecture are acceptance requirements, not a cosmetic theme.
2. Copy the reference frontend. Rejected because its API, remote-management,
   credential-file, raw-log, branding, and persistence assumptions do not
   match Pi Router.
3. Add raw YAML, log-file, credential-upload, and generic settings endpoints.
   Rejected for this story because the operator requires new endpoints to be
   proposed first and the current typed API can support the safe frontend
   projection.
4. Persist the management key automatically or as plaintext. Rejected because
   persistence must be explicit and plaintext storage is prohibited.
5. Relax CSP with `unsafe-inline` for CodeMirror. Rejected because a
   per-response nonce supports runtime editor styles without discarding the
   existing browser hardening.

## Consequences

Positive:

- the console gains the requested professional shell, responsive theme,
  localization, routing, source editing, and consistent client state;
- Pi Router retains its existing API and secret-isolation contracts;
- unsupported reference-only operations are explicit rather than simulated;
- the build remains one offline HTML file embedded in the native artifact.

Tradeoffs:

- the frontend dependency graph and generated HTML become substantially
  larger;
- remembered management keys remain recoverable by code executing in the same
  browser origin because obfuscation is not cryptography;
- YAML formatting and comments cannot survive a structured API round trip;
- CodeMirror requires nonce-aware response rendering;
- every UI change still requires a native Android AArch64 SEA rebuild.

## Follow-Up

- Add persistent log operations only with a bounded file-retention,
  sanitization, and download contract.
- Add request-logging mutation only after specifying whether it is runtime,
  persisted, and restart-sensitive.
- Add per-credential model policy or credential imports only through
  provider-specific typed adapters that never return stored credential
  material.
