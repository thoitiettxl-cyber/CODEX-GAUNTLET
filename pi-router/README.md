# pi-router

`pi-router` exposes Pi's provider runtime as a loopback OpenAI Responses API.
This lets current Codex clients use Pi-supported API-key and OAuth providers
through `wire_api = "responses"` without running a Pi agent session.

The MVP supports one credential per provider in each named account. Named
accounts are isolated stores selected explicitly at startup; automatic
multi-account rotation and failover are not implemented.

## Install

Node.js `>=22.19.0` is required.

```bash
npm ci --prefix pi-router --ignore-scripts
```

The package pins `@earendil-works/pi-coding-agent` to `0.82.1`.

That release's published npm shrinkwrap currently contains
`brace-expansion@5.0.7`, which npm flags under
[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg).
The router does not expose glob-pattern input, and npm cannot override this
nested shrinkwrap independently. Do not run a blind dependency upgrade;
update the Pi pin only with the runtime compatibility proof described in the
product contract.

## Configure AgentRouter

Copy the example to the router-owned state directory:

```bash
mkdir -p ~/.local/state/pi-router
cp pi-router/examples/models.agentrouter.json ~/.local/state/pi-router/models.json
node pi-router/src/cli.js login agentrouter --type api_key
```

The login prompt does not echo the API key. The resulting credential is
written by Pi's credential store under
`~/.local/state/pi-router/accounts/default/auth.json`; `pi-router` does not
reuse `~/.pi/agent/auth.json`.

The checked-in example is a single AgentRouter provider with the six
live-tested model IDs. Claude models override the provider default with
`anthropic-messages`; GPT, GLM, and Kimi use `openai-completions`. The
provider-level `User-Agent: pi-coding-agent` identifies the pinned Pi request
runtime without adding a Pi agent prompt, session, or tool loop. AgentRouter
rejects bare custom-runtime requests without this client profile.

The AgentRouter model list can change independently. Remove model IDs not
enabled for the account and add new IDs only after checking their upstream
protocol and Pi compatibility settings. The endpoint and Pi API types follow
AgentRouter's [current Pi guide](https://docs.agentrouter.org/pi.html).

Pi Router disables Pi's remote model-catalog refresh by default. This keeps
login and startup bounded for static custom-provider configurations such as
AgentRouter; provider authentication and inference still use their required
network flows. Set `PI_ROUTER_MODEL_NETWORK=1` only when a provider needs
remote catalog discovery.

## Serve

Set a separate local bearer token, then start the service:

```bash
read -r -s -p "Local pi-router bearer token: " PI_ROUTER_API_KEY
export PI_ROUTER_API_KEY
node pi-router/src/cli.js serve
```

The default address is `http://127.0.0.1:8318`. Only `127.0.0.1` and `::1`
are accepted.

Useful checks:

```bash
curl http://127.0.0.1:8318/health
curl -H "Authorization: Bearer $PI_ROUTER_API_KEY" \
  http://127.0.0.1:8318/v1/models
```

## Live AgentRouter acceptance

The opt-in live test uses the checked-in example, keeps the upstream credential
in memory, starts the gateway on an ephemeral loopback port, and exercises
JSON text for every configured model, SSE for each upstream API type, and a
two-request strict function-tool round trip for every model:

```bash
read -r -s -p "AgentRouter API key: " AGENTROUTER_API_KEY
export AGENTROUTER_API_KEY
npm --prefix pi-router run test:live:agentrouter
unset AGENTROUTER_API_KEY
```

This command makes real provider requests and may consume quota. It is never
part of `./qa/verify`. Set `PI_ROUTER_LIVE_MODELS` to a comma-separated subset
or `PI_ROUTER_LIVE_TIMEOUT_MS` to change the per-request timeout.

## Connect Codex

Add a custom provider to Codex configuration:

```toml
model = "agentrouter/gpt-5.5"
model_provider = "pi-router"

[model_providers.pi-router]
name = "Pi Router"
base_url = "http://127.0.0.1:8318/v1"
env_key = "PI_ROUTER_API_KEY"
wire_api = "responses"
```

The local client token and the upstream provider credential are deliberately
separate. Do not put either value in this repository.

## Commands

```text
pi-router serve [--host HOST] [--port PORT] [--account NAME] [--state-dir PATH]
pi-router login PROVIDER [--type api_key|oauth] [--account NAME] [--state-dir PATH]
pi-router logout PROVIDER [--account NAME] [--state-dir PATH]
pi-router models [--account NAME] [--state-dir PATH]
```

See the [runbook](../docs/runbooks/pi-router.md) for state, recovery, and
verification details.
