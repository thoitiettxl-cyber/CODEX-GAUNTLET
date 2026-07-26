# Build the Pi Router MVP

Harness story: `TERMUX-007`

## Current context

Codex CLI `0.145.0` rejects `wire_api = "chat"` and accepts
`wire_api = "responses"`. AgentRouter works through Pi's
`openai-completions` or `anthropic-messages` providers, and Pi `0.82.1`
exposes `ModelRuntime` for login, auth refresh, model discovery, and normalized
streaming.

The accepted outcome is a new module named `pi-router` that uses Pi providers
and exposes a local Responses API. The task is high-risk because it touches
credentials, an external provider runtime, and a client-visible API.

## Approach

1. Record the product and architecture contract before implementation.
2. Add a dependency-minimal Node.js package using the pinned Pi runtime.
3. Keep protocol parsing and event translation pure enough for deterministic
   tests with a fake runtime.
4. Keep the HTTP server loopback-only and require a separate local bearer key.
5. Add CLI `login`, `models`, and `serve` commands without sharing Pi CLI
   credentials.
6. Wire build, unit, integration, acceptance, and coverage proof into the
   repository's existing verification authority.

## Progress

- [x] Confirmed Codex Responses-only provider behavior locally and in current
  official configuration documentation.
- [x] Confirmed Pi `0.82.1` credential and `ModelRuntime` contracts.
- [x] Defined the Pi Router product contract and architecture decision.
- [x] Implemented the package, runtime adapter, Responses adapter, and server.
- [x] Implemented CLI login/logout/models/serve behavior.
- [x] Added deterministic tests and canonical verification commands.
- [x] Ran focused proof and `./qa/verify --mode targeted`.
- [x] Corrected Pi's post-login catalog-network behavior and added regression
  proof.
- [x] Ran opt-in AgentRouter acceptance for JSON text, SSE, and strict
  function-tool round trips across the six checked-in models.
- [x] Completed `TERMUX-007` with fresh atomic proof.
- [x] Moved the plan to completed state and reviewed the final diff.

## Last safe boundary

Source, documentation, tests, dependency lock, and project-command wiring are
implemented. Harness story `TERMUX-007` is `implemented` after fresh targeted
proof, and decision `0005` verification passes.

The first story-completion attempt exposed that Pi's
`allowModelNetwork: false` applies only to the create-time refresh:
`ModelRuntime.login()` subsequently follows process-level `PI_OFFLINE`.
A configured remote catalog could therefore make a static custom-provider
login wait indefinitely. Pi Router now defaults the process to offline catalog
mode and exposes the deliberate `PI_ROUTER_MODEL_NETWORK=1` opt-in. The
custom-provider login acceptance probe completes without network access.

Final post-completion verification, credentialed AgentRouter acceptance, and
raw Git review pass. The upstream credential and local bearer remained in
memory and were not copied into router state, Pi CLI state, or the repository.
Live provider requests used an ephemeral loopback process; no provider login,
service deployment, or global Pi state mutation occurred.

## Outcome

`pi-router` now provides a loopback-only, bearer-authenticated OpenAI
Responses JSON/SSE gateway over the pinned Pi provider runtime. It includes
router-owned named account state, interactive API-key/OAuth login, exact model
routing, text and function-tool round trips, bounded error behavior, abort
propagation, an AgentRouter example, and current Codex
`wire_api = "responses"` configuration.

The MVP intentionally supports one credential per provider in each explicitly
selected account. Automatic account rotation/failover remains future work.
Credentialed acceptance is proven for the six checked-in AgentRouter models;
other provider and model combinations still require explicit acceptance.

## Decisions

- Pin `@earendil-works/pi-coding-agent` to `0.82.1`.
- Use Pi `ModelRuntime`, not `createAgentSession()` or a Pi subprocess.
- Use Node's built-in HTTP server and test runner; add no web framework.
- Bind loopback only and require `PI_ROUTER_API_KEY`.
- Support one credential per provider and no account failover in the MVP.
- Treat unsupported Responses input explicitly as `400`.
- Support HTTP/SSE only; WebSocket and stored `previous_response_id` are out of
  scope.
- Keep Pi remote model-catalog refresh offline by default; opt in explicitly
  with `PI_ROUTER_MODEL_NETWORK=1`.

## Risks

- Responses event ordering or item shape may be stricter in Codex than generic
  SSE consumers.
- Custom Chat Completions providers may not preserve every Responses reasoning
  field.
- Pi package upgrades may change normalized event or credential contracts.
- Pi `ModelRuntime.login()` follows login with a catalog refresh controlled by
  process-level `PI_OFFLINE`, not by the create-time `allowModelNetwork`
  option. Pi Router sets offline mode by default to prevent an unrelated
  remote catalog from making login unbounded.
- Credentialed live tests consume provider quota and must keep credentials in
  memory while sanitizing all output.
- The pinned Pi `0.82.1` npm shrinkwrap currently includes
  `brace-expansion@5.0.7`, which npm reports as a high-severity denial-of-
  service advisory. The router does not expose glob patterns, but the
  transitive pin cannot be changed independently without repackaging or a Pi
  upgrade.

## Recovery

Before materialization, removal is limited to the new `pi-router/` source,
tests, product/decision/plan documentation, and verification wiring. Router
persistent state remains outside the repository; automated tests use temporary
state that is removed after each run.

If the Pi dependency cannot load on Termux, keep the protocol adapter and tests
but do not claim the MVP complete. Remove only the unverified runtime wiring or
return the story to `planned`; do not alter Pi CLI installation or auth.

## External side effects

- Harness initialization validated the existing ignored `harness.db`.
- `npm install` downloaded the pinned package graph into ignored
  `pi-router/node_modules/` and created `package-lock.json`.
- The opt-in AgentRouter harness made real text, SSE, and strict function-tool
  requests for all six checked-in models. It used in-memory credentials and an
  ephemeral loopback bearer and created no `auth.json`.
- No real-provider login, persistent credential-file read/write, persistent
  service deployment, or global Pi state mutation occurred.

## Validation

Passed:

- package import/startup check;
- 30 deterministic unit, integration, and acceptance tests;
- loopback HTTP and bearer-auth negative proof;
- fake-provider text and function-tool round trips;
- client-disconnect abort propagation;
- pinned Pi runtime load and custom-provider credential-store probe on Termux;
- AgentRouter JSON text and strict function-tool round trips for
  `claude-opus-4-8`, `claude-opus-4-6`, `gpt-5.5`, `gpt-5.6-sol`, `glm-5.2`,
  and `kimi-k3`;
- AgentRouter SSE lifecycle proof for both configured upstream API types;
- source line coverage `796/928` (`85.8%`);
- decision `0005` verification through the canonical repository command.

Final recorded evidence:

- `npm --prefix pi-router run check` — passed;
- `npm --prefix pi-router test` — 30/30 deterministic tests passed;
- `npm --prefix pi-router run test:live:agentrouter` — all six configured
  models passed text and strict tool round trips; both upstream API types
  passed SSE;
- source line coverage `796/928` (`85.8%`);
- decision `0005` verification — passed through the canonical command;
- `story complete TERMUX-007 --json` — fresh targeted proof passed and
  atomically marked the story `implemented`;
- final `./qa/verify --mode targeted` — passed 65/65 structural checks plus
  policy, build, unit, integration, acceptance, and coverage gates;
- final raw `git status --short`, diff review, and `git diff --check` — passed.
