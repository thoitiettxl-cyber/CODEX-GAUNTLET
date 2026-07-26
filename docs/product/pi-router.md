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
