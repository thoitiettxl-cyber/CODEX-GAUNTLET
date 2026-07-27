# Remove Pi Router safe-projection limits

Harness story: `TERMUX-012`

## Starting context

Pi Router `0.4.0` exposes only an OpenAI Responses inference endpoint, a
structured non-secret configuration projection, metadata-only credential
management, and custom providers limited to the two OpenAI wire protocols.
Those restrictions were deliberate in ADRs 0007-0009 and are enforced by the
product contract, backend validation, capability metadata, UI, tests, and the
committed Android AArch64 SEA.

The owner now explicitly accepts the same management-key trust model as
CLIProxyAPI: a holder of the management key may read and replace raw
configuration and credential files. The accepted request requires raw
`config.yaml`, credential import/export, a generic Anthropic-compatible custom
provider option, inbound Chat Completions and Anthropic Messages endpoints,
operator warnings instead of hard capability blocks, updated product truth,
coverage at or above 82.8%, and a rebuilt native artifact.

## Approach

1. Map the existing server, routing, configuration, account, management,
   frontend, test, packaging, and capability boundaries.
2. Define one router-owned raw `config.yaml` contract that can preserve source
   bytes on GET, parse and validate before atomic replacement on PUT, and drive
   the existing runtime without weakening the management/proxy key split.
3. Add exact-account credential file download and bounded JSON upload using
   existing account isolation and mutation serialization.
4. Extend custom provider validation and UI protocol selection to
   `openai-completions`, `openai-responses`, and `anthropic-messages`, including
   protocol-specific browser test requests.
5. Add inbound adapters for OpenAI Chat Completions and Anthropic Messages that
   share current authentication, model resolution, Pi dispatch, streaming
   abort, error, and model-list behavior.
6. Update capability metadata, product/runbook/architecture truth, and a new
   ADR before claiming each capability available.
7. Add deterministic focused proof, rebuild the single-file UI and native SEA,
   review the final diff, run spec-check, coverage, and canonical verification.

## Progress

- [x] Read the owner request, repository workflow, product contract,
      architecture, runbook, relevant prior plan, RTK guidance, and required
      verification skills.
- [x] Initialized Harness and recorded high-risk intake `#17`.
- [x] Complete the source/test/capability inventory and lock concrete API/state
      shapes in the product contract and ADR.
- [x] Implement raw configuration and credential import/export vertical slices.
- [x] Implement three-protocol custom providers and browser test requests.
- [x] Implement Chat Completions and Anthropic Messages inbound adapters.
- [x] Update docs, capabilities, deterministic tests, coverage, and artifacts.
- [x] Complete spec-check and pre-completion canonical verification; the
      workflow performs story completion and one final-state gate after this
      plan moves to `completed/`.

## Last safe boundary

Pi Router `0.5.0`, its embedded UI, and the Android AArch64 SEA are rebuilt and
agree with the recorded provenance. Focused proof, coverage, binary checks,
manual spec-check, and the canonical gate pass. No live provider, credential,
router state, release, or Git remote was mutated. The exact next action is to
update the story contract path, record the implementation trace, complete
`TERMUX-012`, and run the final-state canonical gate.

## Decisions

- Treat possession of the management key as explicit authority over raw router
  configuration and isolated `auth.json` files, while preserving the separate
  proxy API-key boundary for every `/v1/*` request.
- Retain UI confirmation/warning gates for self-lockout and credential
  disclosure. These are operator-error warnings, not authorization limits.
- Match CLIProxyAPI batch semantics: the UI repeats its per-file import and
  download operations; no synthetic archive endpoint is introduced.
- Reuse Pi `ModelRuntime` protocol implementations and current model resolution;
  do not implement new upstream protocol clients.
- Preserve `/v1/responses` behavior and existing operations-console routes.

## Risks

- Replacing listener or management-key configuration can make the current
  console unreachable; validation cannot prevent every operational lockout.
- Raw credential transport can disclose or overwrite OAuth tokens/API keys.
- `auth.json` is owned by Pi's credential store; unsafe concurrent import can
  race refresh/login/logout unless it uses the existing account/provider
  mutation boundary.
- Protocol adapters can silently lose tool calls, system prompts, usage, stop
  reasons, or streaming events if format conversion is incomplete.
- Frontend/source changes make the committed HTML and Android AArch64 SEA stale
  until native rebuild and checksum/provenance checks pass.
- Current product and architecture documents contain intentional restrictions
  that must be amended coherently, not merely contradicted by code.

## Recovery

- All file replacements must validate first and use same-directory atomic
  renames; failed config or credential imports leave the previous file intact.
- Keep one configuration backup/restore path or equivalent recoverable previous
  raw source before activation.
- Failed frontend or protocol work can be isolated by vertical-slice tests; the
  existing `/v1/responses` adapter remains the reference behavior.
- Git remains the recovery source for repository files and committed artifacts.
  No external credential or runtime state will be used for deterministic proof.

## External side effects

- Harness intake `#17` uses stable run id
  `20260727-termux-012-pi-router-full-freedom`.
- Harness initialization validated/materialized the ignored local
  `harness.db`.
- Public source reads were limited to the requested CLIProxyAPI behavior
  reference and the pinned Termux binary build inputs.
- No network-backed provider request, live credential read, router-state
  config write, update, install, rollback, release, publish, commit, or push
  has occurred.

## Validation

Required evidence:

- focused unit/integration tests for byte-preserving raw config GET/PUT,
  `400 invalid_yaml`, `422` semantic validation, atomic failure, and lockout
  confirmation behavior;
- focused tests for exact-account raw credential export/import, malformed and
  oversized JSON rejection, mutation serialization, UI warning, and list
  refresh;
- frontend typecheck/build/check plus tests or deterministic assertions for all
  three custom-provider protocols and protocol-specific test requests;
- deterministic JSON and SSE tests for both new inbound endpoints, proxy-key
  authentication, model resolution, tool/message conversion, abort, and error
  envelopes, with `/v1/responses` regression proof;
- `npm --prefix pi-router test`, `npm --prefix pi-router run test:coverage`
  at or above 82.8%, native SEA build/check/smoke, independent SHA-256 check,
  manual spec-check, and `./qa/verify --mode targeted`;
- after moving this plan to `completed/` and completing the Harness story,
  rerun `./qa/verify --mode targeted` on the final repository state.

Recorded evidence on 2026-07-27:

- `npm --prefix pi-router test`: PASS, 73/73 tests;
- `npm --prefix pi-router run test:coverage`: PASS,
  `5866/7041` source lines (`83.3%`, minimum `82.8%`);
- `npm --prefix pi-router run build:binary`: PASS, native Android AArch64 SEA
  version `0.5.0`;
- independent `sha256sum`: PASS,
  `e592ad02dcc1a0ddec5917b46473dae0eaf23e3284767f6ac9318fbc25890a7e`;
- `npm --prefix pi-router run check`: PASS;
- `npm --prefix pi-router run test:binary`: PASS;
- manual `spec-check`: PASS after reconciling product/CLI help and adding
  bundle assertions for protocol choices, probe routes, export warning, and
  self-lockout confirmation;
- `./qa/verify --mode targeted`: PASS on the pre-completion repository state.
