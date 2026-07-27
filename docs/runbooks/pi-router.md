# Pi Router runbook

## Scope

This runbook covers the optional repository-local `pi-router` source package.
The service is a loopback OpenAI Responses gateway backed by Pi
`ModelRuntime`; it is not a Gauntlet verification authority or a Pi agent
session.

The product contract is [Pi Router](../product/pi-router.md). Runtime
ownership is recorded in
[ADR 0005](../decisions/0005-pi-router-local-provider-gateway.md), and native
packaging/update ownership is recorded in
[ADR 0006](../decisions/0006-package-pi-router-as-a-verified-termux-sea.md).
The browser management boundary is recorded in
[ADR 0007](../decisions/0007-bound-pi-router-operations-console.md), and the
split key, multi-account, quota, and provider-policy boundaries are recorded
in [ADR 0008](../decisions/0008-separate-pi-router-keys-and-isolate-provider-accounts.md).

## Prerequisites

- Source mode: Node.js `>=22.19.0` built for the active Android/Termux
  environment and `npm ci --prefix pi-router --ignore-scripts` completed from
  the repository root.
- Binary mode: the committed `pi-router-android-aarch64` executable plus its
  Termux shared-library dependencies:
  `libc++ openssl c-ares libicu libsqlite zlib libffi`.
- A provider credential entered interactively with `pi-router login`.
- A non-empty `PI_ROUTER_MANAGEMENT_KEY` for the serving process.
- At least one proxy API key persisted by Pi Router. On first startup only,
  `PI_ROUTER_API_KEY` can seed that store.

Do not copy a GNU/Linux `aarch64` Node artifact into Termux. Use the existing
Android/Termux-compatible runtime.

Install and verify the native artifact without replacing source state:

```bash
pkg install libc++ openssl c-ares libicu libsqlite zlib libffi
(cd pi-router/bin && sha256sum --check pi-router-android-aarch64.sha256)
install -Dm755 pi-router/bin/pi-router-android-aarch64 \
  ~/.local/bin/pi-router
pi-router --version
```

## State

The default state root is `~/.local/state/pi-router`:

```text
accounts/<account>/auth.json
account-catalog.json
models.json
provider-policy.json
proxy-api-keys.json
```

Use `--state-dir` or `PI_ROUTER_STATE_DIR` for a different root. Use
`--account` to select the isolated credential store used for inference.
Management login may create additional account stores for the same provider,
but one server process continues to infer through only its selected account;
Pi Router does not rotate accounts.

Before backing up or moving state, stop the serving process. Treat
`auth.json` as a secret: do not print it, commit it, or copy it into Pi's own
state directory. `proxy-api-keys.json` contains digests rather than raw key
values but is still private router state. Account and router-owned state files
use mode `0600`; account directories use mode `0700`.

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

The browser flow supports Pi-owned Codex, Claude, Kimi, and xAI/Grok login.
Antigravity is registered only when both OAuth client settings are present:

```bash
export PI_ROUTER_ANTIGRAVITY_CLIENT_ID=...
export PI_ROUTER_ANTIGRAVITY_CLIENT_SECRET=...
```

Keep those values outside the repository and browser configuration. A browser
login creates a new isolated account by default, derives a bounded label from
provider identity when available, and adds a suffix if the same provider
would otherwise show duplicate labels.

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
read -r -s -p "Management bearer: " PI_ROUTER_MANAGEMENT_KEY
export PI_ROUTER_MANAGEMENT_KEY
read -r -s -p "Initial proxy API key: " PI_ROUTER_API_KEY
export PI_ROUTER_API_KEY
node pi-router/src/cli.js serve --host 127.0.0.1 --port 8318
```

On an empty state root, `PI_ROUTER_API_KEY` is stored as a digest and becomes
the first inference-client key. Once `proxy-api-keys.json` exists, changing
that environment value does not add or replace a key; use Dashboard.

From another shell with a configured proxy key:

```bash
curl http://127.0.0.1:8318/health
curl -H "Authorization: Bearer $PI_ROUTER_API_KEY" \
  http://127.0.0.1:8318/v1/models
```

Expected health output contains only service name, version, and `status:
"ok"`. An unauthenticated `/v1/models` request must return HTTP `401`.

## Management Center

Open the UI from the same loopback listener:

```text
http://127.0.0.1:8318/management.html
```

Enter the serving process's `PI_ROUTER_MANAGEMENT_KEY`. The grouped console
exposes:

- **Dashboard** for connection, server version, available models, separately
  managed proxy API keys, account/activity/config/quota capability, update,
  and rollback posture;
- **AI Providers** for provider/auth-mode/model inventory and validated
  arbitrary OpenAI-compatible provider creation;
- **Auth Files** for metadata-only, account-labelled stored credentials and
  exact confirmed logout;
- **OAuth Login** for expiring, cancellable API-key or OAuth sessions in new
  or explicitly selected isolated accounts;
- **Quota Management** for separate Codex, Claude, Antigravity, Kimi, and
  xAI/Grok OAuth-credential reads plus typed unsupported states;
- **Logs Viewer** for at most 250 sanitized process-memory events;
- **Config Panel** for the reviewed combined provider/model and router policy
  schema with base URLs, safe headers, per-provider proxy, aliases,
  exclusions, validation, diff, stale-write protection, atomic file
  replacement, and restore.

The bearer, login input, filters, drafts, and results stay only in current page
memory; reload the page to clear them. Do not paste a provider credential into
the local bearer field. Stored credential values, inference prompts, submitted
auth responses, request/response bodies, environment values, upstream bodies,
and raw state paths are absent from management responses and logs. Bounded
auth prompt instructions, provider-owned sign-in URLs, and device codes are
visible only during the current login session.

Every `/management/api/*` request requires the management key. Every `/v1/*`
request requires one persisted proxy API key. Neither key class is accepted
at the other boundary.
Status does not contact GitHub or provider quota APIs. Update and quota checks
are explicit actions. Update checks contact only the fixed public repository;
the API never accepts a repository, asset name, download URL, or filesystem
target from browser input. Quota requests run only through reviewed
provider-specific adapters.

For UI source changes, rebuild the committed single HTML artifact and verify
that it is current:

```bash
npm --prefix pi-router run build
npm --prefix pi-router run check
```

## Updates and rollback

The default is manual check and install:

```bash
pi-router update check
pi-router update install VERSION
```

`VERSION` must exactly match the currently discovered stable release.
Installation verifies the release asset size, SHA-256 asset, GitHub digest
when supplied, ELF64 AArch64 identity, and `/system/bin/linker64`. It then
retains the running executable as `<binary>.previous` and atomically replaces
the installed path. Router account state is not part of this mutation.

The running process continues with its already-mapped executable. Stop and
start it using the same interactive shell or supervisor that originally
owned it; Pi Router does not choose a supervisor or restart itself.

To recover the one retained executable:

```bash
pi-router update rollback
```

Restart again to activate the restored bytes. Install and rollback requests
are serialized; HTTP `409` means another executable mutation is still active.
Source mode permits `update check` but refuses install and rollback.

Automatic verified installation is explicit and non-blocking:

```bash
PI_ROUTER_AUTO_UPDATE=1 pi-router serve
```

If GitHub is unavailable, rate-limited, or returns an invalid release, serving
continues and the current executable remains unchanged.

## Native build and GitHub release

Build the artifact only on Android AArch64 with the shared dependencies
installed:

```bash
npm --prefix pi-router run build:binary
npm --prefix pi-router run check:binary
npm --prefix pi-router run test:binary
```

The builder downloads the checksum-pinned Termux Node package, executes that
exact Bionic Node to prepare the SEA blob, and refuses a GLIBC preparation
runtime. Bionic reports `/system/bin/linker64` before the main executable from
`dl_iterate_phdr()`, unlike the GLIBC ordering assumed by upstream `postject`.
The builder therefore applies one signature-checked AArch64 callback patch
that selects the `/data/...` main image. Both the patch and the source digest
are checked by `check:binary`; provenance is recorded in
`docs/provenance/pi-router-termux-build.json`.

An exact `pi-router-vMAJOR.MINOR.PATCH` tag matching `pi-router/package.json`
triggers `.github/workflows/pi-router-release.yml`. The workflow verifies the
committed checksum and full repository gate before publishing the fixed binary
and `.sha256` asset names. Building does not create a tag, push, or release.

## Recovery

- Missing models: verify the selected `--account`, the provider entry in
  `models.json`, and run `pi-router models`. Re-run login if the provider is
  unavailable. If the provider has no static catalog, retry `models` with
  `PI_ROUTER_MODEL_NETWORK=1`.
- `401` from `/v1/*`: use a current Dashboard-managed proxy API key. The
  management key and upstream provider credential are intentionally rejected.
- `401` from `/management/api/*`: use the serving process's exact
  `PI_ROUTER_MANAGEMENT_KEY`; a proxy key is intentionally rejected.
- No proxy keys at startup: set `PI_ROUTER_API_KEY` once only if the store is
  absent, then start the server and manage its lifecycle in Dashboard.
- Unknown model: use the exact `provider/model` returned by `/v1/models`.
- Corrupt custom provider config: if Config Panel reports a valid recovery
  input, use its confirmed restore action. Otherwise stop the service and
  restore the matching `models.json` and `provider-policy.json` state before
  starting again. Credential state is independent.
- Revoke one credential:
  `node pi-router/src/cli.js logout PROVIDER --account ACCOUNT`.
- Update validation failure: keep running the current process; no installed
  bytes or account state changed. Retry only after a fresh `update check`.
- Updated binary fails before its rollback command can start: stop the process
  and run `<binary>.previous --version`. Copy `.previous` to a sibling
  `.recovered`, rename the failed current file to `.failed`, then rename
  `.recovered` to the original installed path and restart. Resolve the exact
  absolute path before these manual renames and keep both `.previous` and
  `.failed` until recovery is confirmed.

Removing an account directory destroys its stored credentials and is not a
Pi Router command. Prefer provider logout; make a protected backup before any manual
filesystem recovery.

## Verification

Focused proof:

```bash
npm --prefix pi-router run build
npm --prefix pi-router run check
npm --prefix pi-router test
npm --prefix pi-router run test:coverage
npm --prefix pi-router run test:binary
```

Repository proof:

```bash
./qa/verify --mode targeted
```

`./qa/verify` remains the sole repository definition-of-pass.
