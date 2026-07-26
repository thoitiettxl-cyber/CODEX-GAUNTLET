# Pi Router MVP contract

## Purpose

`pi-router` is a local provider gateway that reuses Pi's provider, model,
credential, OAuth-refresh, and streaming runtime while presenting the OpenAI
Responses HTTP contract required by current Codex clients.

It is a separate optional service. It is not a Pi agent session, a Pi
extension, a Harness component, or a verification authority.

## Supported MVP surface

The MVP provides:

- a Node.js service backed by
  `@earendil-works/pi-coding-agent` `0.82.1`;
- one configured credential per provider in each explicitly selected
  router-owned account store;
- Pi built-in providers plus custom providers declared in a router-owned
  `models.json`;
- an AgentRouter custom-provider example with model-level
  `openai-completions` and `anthropic-messages` routing;
- `GET /health`;
- authenticated `GET /v1/models`;
- authenticated `POST /v1/responses` in JSON and HTTP/SSE modes;
- a self-contained operator and debugging Web UI at `/` and
  `/management.html`;
- a bearer-authenticated Management API below `/management/api/`;
- stable GitHub release checks, verified binary installation, and one-step
  rollback;
- a committed, native Termux Android AArch64 single executable;
- Responses text output and function-tool call round trips;
- interactive provider login through Pi's `ModelRuntime.login()`;
- deterministic local tests that make no provider request.

Automatic multi-account routing or rotation, automatic failover, inbound
Anthropic Messages or Chat Completions endpoints, WebSocket transport, hosted
deployment, and prompt/body logging are outside the MVP.

## Runtime and state

The supported runtime is Node.js `>=22.19.0`. The package pins the Pi runtime
dependency to `0.82.1`; upgrades require explicit compatibility proof.

Router state defaults to `~/.local/state/pi-router` and may be overridden with
`PI_ROUTER_STATE_DIR` or `--state-dir`. The state layout is:

```text
<state-dir>/
  accounts/
    default/
      auth.json
  models.json
```

`auth.json` is owned and locked by Pi's credential store. Pi Router never
copies credentials from `~/.pi/agent/auth.json`, returns an upstream
credential to a client, or stores a credential in this repository.

## Network and client authentication

The server binds only to `127.0.0.1` or `::1`. Any other host is rejected
before listening.

`PI_ROUTER_API_KEY` is required when serving. All `/v1/*` routes require
`Authorization: Bearer <PI_ROUTER_API_KEY>`. `/health` is unauthenticated and
returns bounded readiness metadata without provider, model, path, or
credential details.

The static operator page is also unauthenticated so a user can enter the local
bearer after it loads. Loading the page does not read models, touch provider
state, or make an authenticated request. The page is served only by the same
loopback listener; all model discovery and inference requests retain the
`/v1/*` bearer boundary.

Every `/management/api/*` route requires the same router-local bearer as
`/v1/*`. Management responses may report bounded service, runtime, account,
model-count, and release state, but never return credentials, authorization
headers, prompts, Responses payloads, environment values, or raw state and
executable paths.

Request bodies and authorization headers are not logged. Error responses use
an OpenAI-style bounded JSON error envelope and never include raw upstream
response bodies or credential values.

Remote model-catalog refresh is disabled by default so startup and
post-login refresh do not depend on unrelated configured providers or catalog
endpoints. `PI_ROUTER_MODEL_NETWORK=1` opts the process into Pi's remote
catalog refresh. This setting does not disable the provider network traffic
required for login, OAuth refresh, or inference.

Provider and model headers declared in the router-owned `models.json` are
forwarded by Pi's request runtime. The AgentRouter example sets
`User-Agent: pi-coding-agent`, which identifies the pinned Pi runtime without
injecting the Pi agent system prompt or loading an agent session.

## Operator Web UI

The Web UI source uses React and TypeScript and builds to one committed,
self-contained HTML file. It has no CDN, remote font, telemetry, or other
browser-side dependency. The server provides a restrictive content security
policy with hashes for the inline script and style, disables framing, and
prevents caching.

The UI supports:

- health and authenticated model discovery against its serving origin;
- structured text, reasoning, and strict function-tool request templates;
- editable raw Responses JSON;
- JSON and SSE requests with live output, ordered event inspection, function
  call payloads, usage, HTTP status, and elapsed time;
- browser cancellation, which exercises the server's provider abort path;
- copying response data and a sanitized curl command that references
  `$PI_ROUTER_API_KEY` without containing the entered bearer.

The bearer, prompts, request bodies, and responses stay in page memory and are
not written to local storage, session storage, IndexedDB, cookies, or router
logs. Reloading the page clears them. Provider login/logout, credential
mutation, `models.json` editing, account switching, and request history remain
CLI or out-of-scope operations.

## Management API

The Management API provides:

- `GET /management/api/status`, which performs no release-network request and
  returns bounded service, runtime, selected-account, model-count, and updater
  capability data;
- `POST /management/api/updates/check`, which checks the latest stable GitHub
  release and returns a sanitized candidate summary;
- `POST /management/api/updates/install` with the exact candidate `version`,
  which prevents a stale UI from installing a different release;
- `POST /management/api/updates/rollback`, which restores the single retained
  previous executable.

Update mutations are serialized. Concurrent install or rollback requests fail
with HTTP `409`. Source mode can check releases but reports installation and
rollback as unsupported; it never treats the Node interpreter as a router
binary. Successful installation or rollback takes effect only after the
serving process restarts.

The Management API does not expose provider login/logout, credential mutation,
arbitrary command execution, arbitrary path selection, account switching,
`models.json` editing, process restart, or request history.

## GitHub update contract

Stable releases use tags named `pi-router-vMAJOR.MINOR.PATCH` in
`thoitiettxl-cyber/codex-gauntlet-termux`. The updater accepts only the fixed
assets:

```text
pi-router-android-aarch64
pi-router-android-aarch64.sha256
```

The release must be published, non-draft, non-prerelease, newer than the
running semantic version, and served over HTTPS. The updater bounds metadata
and artifact sizes, verifies the separately published SHA-256 (and the GitHub
asset digest when present), then validates ELF64 little-endian AArch64 identity
and Android's `/system/bin/linker64` before any replacement.

Installation writes a sibling temporary file, sets mode `0755`, syncs it,
retains the current executable as `<binary>.previous`, and renames the verified
candidate atomically. A validation or write failure leaves the current binary
unchanged. `PI_ROUTER_AUTO_UPDATE=1` explicitly opts a packaged serving process
into a non-blocking startup check and verified installation; the default never
installs automatically. Automatic update failure cannot prevent serving.

No GitHub credential is required for the public release. Release metadata,
download URLs, response bodies, and checksums are never treated as executable
instructions.

## Termux binary

The committed binary is a Node single executable application containing the
router bundle, pinned Pi runtime, and the exact committed Management Center
HTML. Its base executable comes from the pinned Termux `nodejs` AArch64
package, not from a GNU/Linux AArch64 Node release. Build provenance records
the package URL and SHA-256, embedded Node and router versions, output SHA-256,
ELF machine, interpreter, and Android API.

The SEA preparation blob must be produced natively by the exact extracted
Termux Node executable. A version-matched GLIBC Node is not an acceptable
substitute. Because Bionic enumerates `/system/bin/linker64` before the main
executable, the artifact carries the version-pinned callback compatibility
patch defined by ADR 0006. The build and artifact checks must reject a missing,
ambiguous, or modified patch signature.

The binary may depend on the shared Termux libraries declared by that pinned
`nodejs` package. It must execute `--version`, `help`, deterministic model
loading, and the browser/API smoke surface on Android AArch64 before release.
Non-Android CI verifies the pinned checksum, ELF identity, embedded version,
and source/artifact freshness but does not claim native execution.

The repository release workflow publishes the already verified committed
artifact only when an exact `pi-router-vMAJOR.MINOR.PATCH` tag matches the
package and provenance versions and the canonical repository gate passes. The
workflow does not cross-build or substitute a generic Linux binary.

## Responses compatibility

`POST /v1/responses` accepts:

- `model`;
- `instructions`;
- text `input` or input items with user/assistant messages;
- `function_call` and text `function_call_output` items;
- function tools using JSON Schema parameters;
- `stream`;
- `max_output_tokens`;
- supported reasoning effort values.

Unsupported input item, content, or tool types fail with HTTP `400`; the
router never silently drops them.

For streaming responses the router emits typed SSE events with monotonically
increasing `sequence_number`. The lifecycle contains:

- `response.created`;
- `response.in_progress`;
- output-item and content-part events for text;
- function-call argument events for tools;
- exactly one terminal `response.completed`, `response.failed`, or
  `response.incomplete` event.

Client disconnect aborts the provider request. The MVP does not implement
`previous_response_id` storage or Responses WebSocket transport.

## Model routing

Model names use either:

- `provider/model`, which selects an exact Pi provider and model; or
- an unqualified model ID only when it resolves to exactly one available
  model.

Ambiguous or unknown model names fail without making a provider request.
`GET /v1/models` returns only models for which the active runtime reports
configured auth.

## Verification

Executable proof must cover:

- loopback-only startup and mandatory local bearer authentication;
- the self-contained operator page, browser security headers, and the
  unauthenticated page load not touching the authenticated model runtime;
- management authentication and bounded status without release networking;
- deterministic GitHub release selection, version matching, checksums,
  download bounds, Android ELF validation, atomic install, rollback, source
  mode refusal, and concurrent-mutation rejection;
- native Termux binary identity, embedded Management Center freshness, CLI
  smoke behavior, and pinned Pi runtime loading;
- health and model listing without credential leakage;
- request validation and model resolution;
- JSON text responses;
- SSE text lifecycle and sequence ordering;
- SSE function-call lifecycle;
- function-call output conversion back into Pi context;
- abort propagation on client disconnect;
- CLI argument and state-path behavior without real login;
- package loading against the pinned Pi runtime on Termux.

`./qa/verify` remains the only repository definition-of-pass.

Credentialed live-provider acceptance is an explicit, separate operation. The
AgentRouter live command must keep credentials in memory, bound every request,
sanitize its output, and stay outside deterministic `qa/verify`.
