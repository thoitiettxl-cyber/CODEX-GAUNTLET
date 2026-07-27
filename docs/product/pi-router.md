# Pi Router contract

## Purpose

`pi-router` is a local provider gateway that reuses Pi's provider, model,
credential, OAuth-refresh, and streaming runtime while presenting OpenAI
Responses, OpenAI Chat Completions, and Anthropic Messages HTTP contracts.

It is a separate optional service. It is not a Pi agent session, a Pi
extension, a Harness component, or a verification authority.

## Supported surface

Pi Router provides:

- a Node.js service backed by
  `@earendil-works/pi-coding-agent` `0.82.1`;
- one configured credential per provider in each explicitly selected
  router-owned account store;
- multiple isolated account stores, with stable non-secret credential metadata
  and labels for managing more than one account for the same provider;
- Pi built-in providers plus custom providers declared in router-owned raw
  `config.yaml`;
- arbitrary custom provider ids using `openai-completions`,
  `openai-responses`, or `anthropic-messages`, with base URL, API key, custom
  headers, aliases, exclusions, model prefix, and provider-scoped proxy;
- an AgentRouter custom-provider example with model-level
  `openai-completions` and `anthropic-messages` routing;
- `GET /health`;
- authenticated `GET /v1/models`;
- authenticated `POST /v1/responses` in JSON and HTTP/SSE modes;
- authenticated `POST /v1/chat/completions` in JSON and HTTP/SSE modes;
- authenticated `POST /v1/messages` in JSON and HTTP/SSE modes;
- a self-contained operations console at `/` and
  `/management.html`;
- a bearer-authenticated Management API below `/management/api/`;
- stable GitHub release checks, verified binary installation, and one-step
  rollback;
- a committed, native Termux Android AArch64 single executable;
- Responses text output and function-tool call round trips;
- interactive provider login through Pi's `ModelRuntime.login()`;
- browser OAuth/device login for Pi-supported Codex, Claude, Kimi, and
  xAI/Grok providers, plus the router Antigravity adapter when its OAuth client
  environment is configured;
- reviewed per-credential quota adapters for Codex, Claude, Antigravity, Kimi,
  and xAI/Grok;
- deterministic local tests that make no provider request.

Automatic multi-account routing or rotation, automatic failover, WebSocket
transport, hosted deployment, and prompt/body logging are outside the current
product surface.

## Runtime and state

The supported runtime is Node.js `>=22.19.0`. The package pins the Pi runtime
dependency to `0.82.1`; upgrades require explicit compatibility proof. It also
pins `undici` to the exact `8.5.0` version already present in Pi's dependency
tree so provider-scoped proxy dispatch does not depend on an implicit nested
package path.

Router state defaults to `~/.local/state/pi-router` and may be overridden with
`PI_ROUTER_STATE_DIR` or `--state-dir`. The state layout is:

```text
<state-dir>/
  accounts/
    default/
      auth.json
    <managed-account>/
      auth.json
  account-catalog.json
  config.yaml
  config.yaml.previous
  models.json
  provider-policy.json
  proxy-api-keys.json
```

`auth.json` is owned by Pi's credential store. Pi Router never copies
credentials from `~/.pi/agent/auth.json` or stores a credential in this
repository. A holder of the management key may explicitly download an exact
isolated-account auth file or import one bounded JSON auth file into a newly
created isolated account. Batch UI actions repeat those per-file operations;
there is no archive endpoint.
`account-catalog.json` contains only stable account/credential ids, bounded
labels, provider/type metadata, and timestamps. `proxy-api-keys.json` stores
only key digests and metadata. Router-owned state files are written with mode
`0600`; account directories use mode `0700`.

## Network and client authentication

The server defaults to `127.0.0.1`. `127.0.0.1`, `::1`, and `localhost` are
accepted without additional authority. A non-loopback listener is accepted
only when `remote-management.allow-remote` is explicitly true in validated
raw configuration.

One non-empty management key is required when serving. It may be supplied by
`remote-management.secret-key` or `PI_ROUTER_MANAGEMENT_KEY`. Every
`/management/api/*` and `/v0/management/*` route requires
`Authorization: Bearer <PI_ROUTER_MANAGEMENT_KEY>`.

All `/v1/*` routes require one enabled router-owned proxy API key. Proxy keys
and the management key are different credential classes: the management key
is never accepted for inference, and a proxy key is never accepted by the
Management API. On first startup with no proxy-key store,
`PI_ROUTER_API_KEY` is accepted only as a migration seed and stored as a
digest. After the store exists, proxy keys are managed through the Management
API and `PI_ROUTER_API_KEY` is not an additional implicit key. Serving fails
closed when no management key or proxy key is available. `/health` is
unauthenticated and returns bounded readiness metadata without provider,
model, path, key, or credential details.

The static operator page is also unauthenticated so a user can enter the
management bearer after it loads. Loading the page does not read models, touch
provider state, or make an authenticated request. The page is served by the
same configured listener; all model discovery and inference requests retain
the separate `/v1/*` proxy-key boundary.

Most Management responses report bounded service, runtime, account, proxy-key
metadata, provider, credential metadata, model-count, quota-capability,
operational event, and release state. The explicit raw configuration and
auth-file routes are exceptions: their purpose is to return or accept secrets
under management-key authority. They never return a proxy API key value,
inference prompt/body, raw upstream body, arbitrary state path, or executable
path. A newly generated or replaced proxy key is returned exactly once in
that mutation response.

Request bodies and authorization headers are not logged. Errors use bounded
OpenAI-style envelopes for OpenAI routes and Anthropic-style envelopes for
`/v1/messages`; neither includes raw upstream bodies or credential values.

Remote model-catalog refresh is disabled by default so startup and
post-login refresh do not depend on unrelated configured providers or catalog
endpoints. `PI_ROUTER_MODEL_NETWORK=1` opts the process into Pi's remote
catalog refresh. This setting does not disable the provider network traffic
required for login, OAuth refresh, or inference.

Provider and model headers declared in raw `config.yaml` and compiled into
router-owned `models.json` are
forwarded by Pi's request runtime. The AgentRouter example sets
`User-Agent: pi-coding-agent`, which identifies the pinned Pi runtime without
injecting the Pi agent system prompt or loading an agent session.

## Operations console

The Web UI source uses React 19 and TypeScript 6 with Vite,
`vite-plugin-singlefile`, Zustand, Axios, React Router `HashRouter`,
CodeMirror 6, i18next, Motion, and SCSS Modules. It targets ES2020 and builds
to one committed, self-contained HTML file. It has no CDN, remote font,
telemetry, or other remote browser dependency. The server provides a
restrictive content security policy with hashes for the build-time inline
script/style and a per-response nonce for CodeMirror runtime styles, disables
framing, and prevents caching. The console uses stable hash routes and exactly
this primary navigation:

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
  System
```

Wide screens use a grouped sidebar. Narrow screens use a labelled,
focus-managed drawer that closes on selection, Escape, or backdrop activation.
Reload, browser back/forward, and copied loopback URLs restore the selected
page. Unknown hashes resolve to Dashboard. The shell includes a skip link,
visible keyboard focus, reduced-motion behavior, named form controls, status
announcements, empty/loading/error states, and confirmation for credential,
raw-configuration, install, and rollback mutations.

The Dashboard reports bounded operational state rather than a decorative
network topology: service/version/uptime, selected account, configured
provider and credential counts across managed accounts, available models,
management connection state, proxy API-key count, recent request/error
activity, quota capability count, configuration activation state, and
update/rollback posture. It manages proxy API-key metadata and creation,
replacement, label, and removal separately from the management key. Verified
update check, install, and rollback remain available from Dashboard without
becoming a separate top-level page.

The bearer stays in current page memory by default. An explicit Remember
choice may persist it in same-origin local storage only inside a reversible,
Pi-specific `enc::v1::` obfuscation envelope; failure to obfuscate fails
closed instead of writing plaintext. The UI states that this is convenience,
not encryption, and System can clear the retained login envelope. Restoring
that envelope only prefills the login form; no authenticated request occurs
until the operator submits it. Theme and language preferences may also be
retained locally. Provider credentials, proxy keys used for one System model
read, auth prompt input, filters, configuration drafts, API results, and
operational events are never persisted. The page does not use session
storage, IndexedDB, cookies, or persistent browser caches. The console does
not provide an inference prompt bench or retain request history;
`/v1/responses` behavior remains available to authenticated API clients.

Logs Viewer polls `GET /management/api/events` incrementally with
operator-controlled auto-refresh, search, result filters, and an option to hide
management traffic. Clearing resets the current browser view only. Pi Router
keeps this route visible for its always-available bounded process event buffer;
it does not claim file logging, raw-log download, or server-side log deletion
without a later typed Management API capability.

Config Panel loads and edits exact raw `config.yaml` source through CodeMirror.
YAML is parsed in the browser with line/column diagnostics and previewed as a
source diff, but the backend reparses and semantically validates the unchanged
source bytes before atomic replacement. Comments and formatting round-trip.
Changing listener, port, remote-management access, or the management secret
requires a dedicated self-lockout confirmation. AI Providers edits the same
raw YAML document with YAML AST operations and offers all three protocol
choices plus a direct browser protocol probe. The browser CSP therefore
allows explicit HTTP/HTTPS `connect-src` destinations while retaining the
management/proxy authentication split.

System composes existing bounded capabilities: service/build posture, explicit
release check, Pi Router documentation links, scoped local-login cleanup, and
an operator-triggered `/v1/models` read using a separately entered proxy API
key held only in memory. It reports sanitized request logging as enabled or
disabled and links to the raw config field that controls it.

## Management API

The Management API provides:

- `GET /management/api/status`, which performs no release-network request and
  returns bounded connection, service/version, runtime, selected-account,
  proxy-key, provider, credential, model, activity, quota-capability,
  configuration, and updater posture;
- `GET /management/api/proxy-keys`, `POST /management/api/proxy-keys`,
  `PATCH /management/api/proxy-keys/:id`,
  `POST /management/api/proxy-keys/:id/replace`, and
  `DELETE /management/api/proxy-keys/:id`, which manage only key metadata and
  generate key values server-side; create/replace return the value once and
  deleting the last enabled key is rejected;
- `GET /management/api/providers`, which returns provider identity, supported
  auth modes, whether each mode has an interactive login, configured source,
  total/available model counts, and a bounded availability state;
- `GET /management/api/credentials`, which returns only stable credential id,
  account id/label, provider id/name, credential label/type, and whether the
  account is selected for inference;
- `DELETE /management/api/credentials/:credential`, which serializes with
  login for that exact account/provider pair and removes only that credential;
- `GET /v0/management/auth-files/download?name=<credential-id>`, which returns
  the exact raw `auth.json` bytes for that credential's isolated account with
  an attachment name;
- `POST /v0/management/auth-files`, which accepts one bounded valid Pi
  credential JSON object and writes its exact bytes to a new isolated account;
- `POST /management/api/auth/sessions`, which creates one bounded `api_key` or
  `oauth` login session for an exact provider in a new isolated account by
  default or an explicitly named existing account;
- `GET /management/api/auth/sessions/:id`,
  `POST /management/api/auth/sessions/:id/respond`, and
  `POST /management/api/auth/sessions/:id/cancel`, which expose only safe
  prompt metadata, auth URLs, device codes, progress, and terminal state;
- `GET /management/api/quota`, which invokes only explicitly registered
  provider quota adapters separately for every exact OAuth credential and
  returns a typed `unsupported` state for every other credential/provider;
- `GET /management/api/events?limit=N`, which returns a newest-first view of
  the bounded sanitized in-memory operational event buffer;
- `GET /v0/management/config.yaml`, which returns exact source bytes with a
  SHA-256 ETag, and `PUT /v0/management/config.yaml`, which distinguishes
  syntax (`400 invalid_yaml`) from semantic (`422 router_config_invalid`)
  failures, preserves the prior raw source, and replaces only after validation;
- `GET /management/api/config`, `POST /management/api/config/preview`,
  `POST /management/api/config/apply`, and
  `POST /management/api/config/restore`, retained as the structured
  compatibility surface for compiled provider files;
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

Auth sessions use unguessable ids, expire after five minutes, are single-use,
and retain at most sixteen active/recent sessions. An account/provider pair
has at most one credential mutation in flight. Cancelling or expiring a
session aborts its runtime interaction and cannot delete a previously valid
credential. Prompt responses are accepted once and are never echoed in a
session response, event, log, or error. After login, the router derives a
bounded label from provider-returned non-secret identity metadata where
available, accepts an explicit operator label, otherwise uses a deterministic
credential-id suffix, and appends a suffix when necessary so two credentials
for one provider are never presented with an ambiguous duplicate label.

Quota is never inferred from request token usage. Codex, Claude, Antigravity,
Kimi, and xAI/Grok use separate fixed-endpoint adapters. Each adapter resolves
only its exact OAuth credential server-side, bounds time and response size,
normalizes provider windows independently, and failure-isolates one
credential from the others. The router does not provide an arbitrary
credential-injecting HTTP request endpoint. Reading quota is an explicit
operator action.

The event buffer retains at most 250 records for the current process and has
no persistent backing. A record may contain only an opaque event id,
timestamp, fixed request class, HTTP status, bounded duration, sanitized
model/provider identity, and bounded error code. It never contains URL query
strings, headers, credentials, prompts, request/response bodies, environment
values, upstream bodies, or filesystem paths.

Raw `config.yaml` is the source of truth for listener host/port,
`remote-management.allow-remote`, `remote-management.secret-key`,
`request-logging`, a string-valued `environment` mapping, and `providers`.
Unknown top-level fields are preserved. Provider definitions accept Pi model
fields, `baseUrl`, `apiKey`, custom headers, `proxyUrl`, `prefix`,
`modelAliases`, and `excludedModels`; their protocol must be
`openai-completions`, `openai-responses`, or `anthropic-messages`. Endpoint
and proxy URLs cannot embed URL credentials, query parameters, or fragments.
The raw source is bounded to 512 KiB and YAML alias expansion is bounded.

Router-only policy is persisted separately from Pi-compatible `models.json`.
Aliases and exclusions affect `/v1/models` and model resolution; an alias
resolves back to the exact original provider/model before dispatch.
Provider-scoped proxy settings are applied through an async-context-scoped
Undici dispatcher and are also passed as reviewed `HTTP_PROXY` and
`HTTPS_PROXY` runtime overrides for transports that consume provider
environment directly. Concurrent providers do not mutate process-global
environment or inherit each other's proxy. A successful raw PUT compiles Pi
provider and router-policy files, writes mode `0600` through same-directory
atomic renames, and reports `reloaded` or `restart_required`. Provider-only and
request-logging changes activate in process; listener, management-key, and
environment changes require restart. Failure leaves the active raw source
unchanged.

The Management API does not expose arbitrary authenticated provider requests,
arbitrary command execution or path selection, inference-account switching,
executable targets, process restart, provider request bodies, inference
history, or raw logs. Raw configuration and credential file disclosure exist
only at the fixed router-owned targets described above.

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

## Chat Completions and Anthropic Messages compatibility

`POST /v1/chat/completions` accepts system/developer, user, assistant, and tool
messages; function tools and assistant tool calls/results; `max_tokens` or
`max_completion_tokens`; and JSON or `data:` SSE output terminated by
`[DONE]`. It returns OpenAI-native completion objects, chunks, finish reasons,
and usage.

`POST /v1/messages` accepts Anthropic system text, user/assistant content
blocks, tool definitions, `tool_use`/`tool_result` round trips, required
positive `max_tokens`, and JSON or typed Anthropic SSE. It returns
Anthropic-native message, content-block, stop-reason, usage, and bounded error
shapes. Both endpoints use the same proxy API-key store, model resolver, Pi
dispatch, provider policy, abort propagation, and sanitized event logging as
`/v1/responses`.

## Model routing

Model names use either:

- `provider/model`, which selects an exact Pi provider and model; or
- `provider/alias`, when one configured alias resolves to one non-excluded
  original model in that provider; or
- `provider/prefix/model-or-alias`, when a provider prefix is configured; or
- an unqualified model ID only when it resolves to exactly one available
  model.

Ambiguous or unknown model names fail without making a provider request.
`GET /v1/models` returns only models for which the active runtime reports
configured auth after exclusions and aliases are applied.

## Verification

Executable proof must cover:

- loopback-default startup, explicit remote-listener authority, mandatory
  management authentication, proxy-key migration, separate inference
  authentication, one-time key disclosure, and last-key removal protection;
- the self-contained operator page, browser security headers, and the
  unauthenticated page load not touching the authenticated model runtime;
- management authentication and bounded status without release networking;
- provider inventory, all three custom-provider protocols, API keys, headers,
  aliases/exclusions/prefix/proxy policy, and multi-account credential
  enumeration;
- expiring, cancellable, single-use auth sessions, isolated same-provider
  accounts, unique labels, and serialized account/provider mutations without
  credential echo;
- fixed Codex, Claude, Antigravity, Kimi, and xAI/Grok quota adapters with
  per-credential normalization, bounded responses, failure isolation, and
  deterministic unsupported states;
- bounded sanitized in-memory events without prompt, body, header, path, or
  credential leakage;
- byte-preserving raw config read/write, syntax/semantic rejection, atomic
  apply, retained previous source, self-lockout confirmation, and activation
  reporting;
- exact raw auth-file export, bounded import into new isolated accounts, batch
  UI orchestration, and one warning per page session;
- all eight stable hash routes, accessible desktop/drawer navigation,
  destructive confirmations, and narrow-screen states;
- vi/en localization without reload, persisted theme selection, opt-in
  obfuscated management-key retention, and scoped local-login cleanup;
- CodeMirror YAML parsing/diff over the raw config contract and
  incremental sanitized-event polling without persistent raw logs;
- deterministic GitHub release selection, version matching, checksums,
  download bounds, Android ELF validation, atomic install, rollback, source
  mode refusal, and concurrent-mutation rejection;
- native Termux binary identity, embedded Management Center freshness, CLI
  smoke behavior, and pinned Pi runtime loading;
- health and model listing without credential leakage;
- request validation and model resolution;
- JSON text responses;
- Chat Completions JSON/SSE messages, tools, finish reasons, and usage;
- Anthropic Messages JSON/typed-SSE content blocks, tools, stop reasons, usage,
  and error shapes;
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
