# Pi Router runbook

## Scope

This runbook covers the optional repository-local `pi-router` source package.
The service is a loopback OpenAI Responses gateway backed by Pi
`ModelRuntime`; it is not a Gauntlet verification authority or a Pi agent
session.

The product contract is [Pi Router MVP](../product/pi-router.md), and the
architecture decision is
[ADR 0005](../decisions/0005-pi-router-local-provider-gateway.md).

## Prerequisites

- Node.js `>=22.19.0` built for the active Android/Termux environment.
- `npm ci --prefix pi-router --ignore-scripts` completed from the repository
  root.
- A provider credential entered interactively with `pi-router login`.
- A separate non-empty `PI_ROUTER_API_KEY` in the serving process and each
  client process.

Do not copy a GNU/Linux `aarch64` Node artifact into Termux. Use the existing
Android/Termux-compatible runtime.

## State

The default state root is `~/.local/state/pi-router`:

```text
accounts/<account>/auth.json
models.json
```

Use `--state-dir` or `PI_ROUTER_STATE_DIR` for a different root. Use
`--account` to select an isolated credential store. One server process uses
one account; the MVP does not rotate accounts.

Before backing up or moving state, stop the serving process. Treat
`auth.json` as a secret: do not print it, commit it, or copy it into Pi's own
state directory.

## Setup and login

For AgentRouter:

```bash
mkdir -p ~/.local/state/pi-router
cp pi-router/examples/models.agentrouter.json ~/.local/state/pi-router/models.json
node pi-router/src/cli.js login agentrouter --type api_key
node pi-router/src/cli.js models
```

The checked-in example uses one provider credential with per-model protocol
overrides: the Claude model uses `anthropic-messages` at the endpoint root,
while GPT, GLM, and Kimi inherit `openai-completions` at `/v1`. Keep its
`User-Agent: pi-coding-agent` provider header; raw Pi `ModelRuntime` requests
without the Pi client profile are rejected by AgentRouter. The Claude entry
also declares `supportsStrictTools` so Responses `strict: true` function tools
are sent instead of failing before the provider request.

For a Pi built-in OAuth provider:

```bash
node pi-router/src/cli.js login PROVIDER --type oauth
node pi-router/src/cli.js models
```

Follow the URL, device-code, or manual-code prompt emitted by the provider.
Never pass an API key on the command line.

Pi Router keeps remote model-catalog refresh offline by default. For a
provider whose models must be discovered remotely, opt in for that process:

```bash
PI_ROUTER_MODEL_NETWORK=1 node pi-router/src/cli.js models
```

Do not enable catalog networking merely for a static `models.json`; upstream
login, OAuth refresh, and inference networking do not require this opt-in.

## Live AgentRouter acceptance

This is optional credentialed evidence and is not part of the deterministic
repository gate:

```bash
read -r -s -p "AgentRouter API key: " AGENTROUTER_API_KEY
export AGENTROUTER_API_KEY
npm --prefix pi-router run test:live:agentrouter
unset AGENTROUTER_API_KEY
```

The command does not use or create `auth.json`. It loads the checked-in example,
installs the key as a Pi runtime-only override, binds an ephemeral loopback
server, and checks:

- local health, bearer authentication, and model discovery;
- Responses JSON text for every selected model;
- Responses SSE lifecycle for each configured upstream API type;
- a strict function-tool call and result round trip for every selected model.

It makes real upstream requests and can consume quota. The default per-request
timeout is 180 seconds. Use `PI_ROUTER_LIVE_MODELS` for a comma-separated model
subset and `PI_ROUTER_LIVE_TIMEOUT_MS` for a different positive timeout.

## Start and probe

```bash
read -r -s -p "Local pi-router bearer token: " PI_ROUTER_API_KEY
export PI_ROUTER_API_KEY
node pi-router/src/cli.js serve --host 127.0.0.1 --port 8318
```

From another shell with the same local client token:

```bash
curl http://127.0.0.1:8318/health
curl -H "Authorization: Bearer $PI_ROUTER_API_KEY" \
  http://127.0.0.1:8318/v1/models
```

Expected health output contains only service name, version, and `status:
"ok"`. An unauthenticated `/v1/models` request must return HTTP `401`.

## Recovery

- Missing models: verify the selected `--account`, the provider entry in
  `models.json`, and run `pi-router models`. Re-run login if the provider is
  unavailable. If the provider has no static catalog, retry `models` with
  `PI_ROUTER_MODEL_NETWORK=1`.
- `401` from `pi-router`: ensure the client and serving process use the same
  `PI_ROUTER_API_KEY`. This token is unrelated to the upstream provider key.
- Unknown model: use the exact `provider/model` returned by `/v1/models`.
- Corrupt custom model config: stop the service, restore the previous
  `models.json`, and start again. Credential state is independent.
- Revoke one credential:
  `node pi-router/src/cli.js logout PROVIDER --account ACCOUNT`.

Removing an account directory destroys its stored credentials and is not an
MVP command. Prefer provider logout; make a protected backup before any manual
filesystem recovery.

## Verification

Focused proof:

```bash
npm --prefix pi-router run check
npm --prefix pi-router test
npm --prefix pi-router run test:coverage
```

Repository proof:

```bash
./qa/verify --mode targeted
```

`./qa/verify` remains the sole repository definition-of-pass.
