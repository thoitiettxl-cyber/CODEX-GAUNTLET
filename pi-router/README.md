# pi-router

`pi-router` exposes Pi's provider runtime as a loopback OpenAI Responses API.
This lets current Codex clients use Pi-supported API-key and OAuth providers
through `wire_api = "responses"` without running a Pi agent session.

Each named account keeps one credential per provider in an isolated Pi store.
The Management Center can create and label multiple accounts for the same
provider and query each OAuth credential's quota independently. Inference
stays on the account selected explicitly at startup; automatic rotation and
failover are not implemented.

## Install from source

Node.js `>=22.19.0` is required.

```bash
npm ci --prefix pi-router --ignore-scripts
```

The package pins `@earendil-works/pi-coding-agent` to `0.82.1` and promotes
the same `undici@8.5.0` already used by that runtime for provider-scoped proxy
dispatch.

That release's published npm shrinkwrap currently contains
`brace-expansion@5.0.7`, which npm flags under
[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg).
The router does not expose glob-pattern input, and npm cannot override this
nested shrinkwrap independently. Do not run a blind dependency upgrade;
update the Pi pin only with the runtime compatibility proof described in the
product contract.

## Install the Termux binary

The committed `bin/pi-router-android-aarch64` artifact is a native Android
AArch64 Node SEA. It contains the router, pinned Pi runtime, and exact
single-file Management Center; it is not a GNU/Linux AArch64 executable.

Install the shared libraries declared by the pinned Termux Node base, then
copy the verified artifact to a user-owned executable location:

```bash
pkg install libc++ openssl c-ares libicu libsqlite zlib libffi
(cd pi-router/bin && sha256sum --check pi-router-android-aarch64.sha256)
install -Dm755 pi-router/bin/pi-router-android-aarch64 \
  ~/.local/bin/pi-router
pi-router --version
```

The build identity and source digest are recorded in
[`docs/provenance/pi-router-termux-build.json`](../docs/provenance/pi-router-termux-build.json).

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

The checked-in example is a single AgentRouter provider with the five
enabled model IDs. The Claude model overrides the provider default with
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

Set separate management and inference credentials, then start the service:

```bash
read -r -s -p "Management bearer: " PI_ROUTER_MANAGEMENT_KEY
export PI_ROUTER_MANAGEMENT_KEY
read -r -s -p "Initial proxy API key: " PI_ROUTER_API_KEY
export PI_ROUTER_API_KEY
node pi-router/src/cli.js serve
```

`PI_ROUTER_API_KEY` is a one-time migration/initialization seed. Its digest is
stored in `proxy-api-keys.json` when that store does not exist; after that,
the environment value is not an implicit extra key. Create, label, replace,
and remove proxy keys from Dashboard. The last proxy key cannot be removed.

The default address is `http://127.0.0.1:8318`. Only `127.0.0.1` and `::1`
are accepted.

Open the self-contained Management Center:

```text
http://127.0.0.1:8318/management.html
```

Enter `PI_ROUTER_MANAGEMENT_KEY`; proxy API keys are deliberately rejected by
the Management API. The console has seven stable hash-routed pages:
**Dashboard**, **AI Providers**, **Auth Files**, **OAuth Login**, **Quota
Management**, **Logs Viewer**, and **Config Panel**. Dashboard reports
connection state, server version, available-model count, and separately
manages proxy API keys. It also owns explicit stable-release check, verified
install, and rollback actions without adding another top-level page.

Credential lists are metadata-only. API-key and OAuth login use bounded,
expiring browser sessions; prompt responses are submitted once and never
echoed. Codex, Claude, Kimi, and xAI/Grok use Pi-owned OAuth/device flows.
Antigravity is available when `PI_ROUTER_ANTIGRAVITY_CLIENT_ID` and
`PI_ROUTER_ANTIGRAVITY_CLIENT_SECRET` are supplied to the serving process.
Identity-derived labels and isolated account stores keep same-provider
credentials distinct.

Quota reads use fixed, bounded adapters for Codex, Claude, Antigravity, Kimi,
and xAI/Grok and return one result per OAuth credential. Logs are sanitized,
capped at 250 process-memory records, and never contain prompts, bodies,
headers, credentials, environment values, or paths. Config Panel combines the
reviewed non-secret Pi provider model schema with router-owned proxy, alias,
and exclusion policy. AI Providers can add arbitrary OpenAI Responses or Chat
Completions compatible provider IDs with base URL, safe headers, proxy, model
alias, and exclusion patterns; credentials are entered separately.

The UI has no external browser assets and does not persist the bearer, login
input, filters, config drafts, or API results. Reloading clears page memory.
The HTML itself is unauthenticated, while every `/v1/*` and
`/management/api/*` request retains the normal bearer requirement.

Useful checks:

```bash
curl http://127.0.0.1:8318/health
curl -H "Authorization: Bearer $PI_ROUTER_API_KEY" \
  http://127.0.0.1:8318/v1/models
curl -H "Authorization: Bearer $PI_ROUTER_MANAGEMENT_KEY" \
  http://127.0.0.1:8318/management/api/status
curl -H "Authorization: Bearer $PI_ROUTER_MANAGEMENT_KEY" \
  http://127.0.0.1:8318/management/api/providers
```

Source mode may check releases but refuses install and rollback so it can
never replace the Node interpreter. The packaged binary supports:

```bash
pi-router update check
pi-router update install VERSION
pi-router update rollback
```

An installed or rolled-back executable activates after the serving process is
restarted. Automatic verified installation is opt-in:

```bash
PI_ROUTER_AUTO_UPDATE=1 pi-router serve
```

Automatic update work runs in the background and a GitHub or validation
failure never prevents the loopback service from starting.

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
env_key = "PI_ROUTER_PROXY_KEY"
wire_api = "responses"
```

Set `PI_ROUTER_PROXY_KEY` in the Codex client process to one value generated
or migration-seeded by Pi Router. The proxy key, management key, and upstream
provider credential are three deliberately separate credential classes. Do
not put any of them in this repository.

## Commands

```text
pi-router serve [--host HOST] [--port PORT] [--account NAME] [--state-dir PATH]
pi-router login PROVIDER [--type api_key|oauth] [--account NAME] [--state-dir PATH]
pi-router logout PROVIDER [--account NAME] [--state-dir PATH]
pi-router models [--account NAME] [--state-dir PATH]
pi-router status [--account NAME] [--state-dir PATH]
pi-router update check
pi-router update install VERSION
pi-router update rollback
pi-router --version
```

See the [runbook](../docs/runbooks/pi-router.md) for state, recovery, and
verification details.

## Build the Web UI

React and TypeScript source lives under `web/src/`. Build the single-file,
offline artifact after UI changes:

```bash
npm --prefix pi-router run build
```

The committed output is `web/dist/index.html`. The package `check` script
type-checks the source and fails when that artifact is stale.

## Build and release the Termux binary

Binary builds must run natively on Android AArch64. The build downloads and
checksum-verifies the pinned Termux `nodejs` package, prepares the SEA blob
with that exact Bionic executable, applies the verified Bionic image-selection
compatibility patch, and records fresh provenance:

```bash
npm --prefix pi-router run build:binary
npm --prefix pi-router run check:binary
npm --prefix pi-router run test:binary
```

`test:binary` starts the actual executable and probes its CLI, Pi model
runtime, embedded UI, and authenticated Management API. The shared libraries
listed in the binary installation section must be installed.

Pushing an exact `pi-router-vMAJOR.MINOR.PATCH` tag triggers
`.github/workflows/pi-router-release.yml`. The workflow reruns the canonical
repository gate and publishes only:

```text
pi-router-android-aarch64
pi-router-android-aarch64.sha256
```

Creating or pushing the tag is an explicit release action; the build command
does not publish anything.
