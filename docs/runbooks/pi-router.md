# Pi Router runbook

## Scope

This runbook covers the optional repository-local `pi-router` source package.
The service is a loopback OpenAI Responses gateway backed by Pi
`ModelRuntime`; it is not a Gauntlet verification authority or a Pi agent
session.

The product contract is [Pi Router MVP](../product/pi-router.md). Runtime
ownership is recorded in
[ADR 0005](../decisions/0005-pi-router-local-provider-gateway.md), and native
packaging/update ownership is recorded in
[ADR 0006](../decisions/0006-package-pi-router-as-a-verified-termux-sea.md).

## Prerequisites

- Source mode: Node.js `>=22.19.0` built for the active Android/Termux
  environment and `npm ci --prefix pi-router --ignore-scripts` completed from
  the repository root.
- Binary mode: the committed `pi-router-android-aarch64` executable plus its
  Termux shared-library dependencies:
  `libc++ openssl c-ares libicu libsqlite zlib libffi`.
- A provider credential entered interactively with `pi-router login`.
- A separate non-empty `PI_ROUTER_API_KEY` in the serving process and each
  client process.

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

## Management Center

Open the UI from the same loopback listener:

```text
http://127.0.0.1:8318/management.html
```

Enter the serving process's `PI_ROUTER_API_KEY`. **Overview** reports bounded
runtime, selected-account, model, and update posture. **Probe** selects one of
the discovered models and sends a template or raw JSON request. Streaming mode
shows the ordered Responses SSE lifecycle; Escape or **Cancel** disconnects
the browser request and aborts the provider signal. **Copy curl** always emits
`$PI_ROUTER_API_KEY` instead of the bearer entered in the page. **Updates**
checks stable releases and, only in the packaged binary, installs the exact
candidate displayed by the page or restores the retained previous binary.

The page does not perform provider login, logout, account changes, or
`models.json` edits. Use the CLI for those operations. It also keeps the
bearer, prompts, request bodies, and responses only in current page memory;
reload the page to clear them. Do not paste a provider credential into the
local bearer field.

Every `/management/api/*` request uses the same bearer boundary as `/v1/*`.
Status does not contact GitHub. Update checks contact only the fixed public
repository; the API never accepts a repository, asset name, download URL, or
filesystem target from browser input.

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
- `401` from `pi-router`: ensure the client and serving process use the same
  `PI_ROUTER_API_KEY`. This token is unrelated to the upstream provider key.
- Unknown model: use the exact `provider/model` returned by `/v1/models`.
- Corrupt custom model config: stop the service, restore the previous
  `models.json`, and start again. Credential state is independent.
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

Removing an account directory destroys its stored credentials and is not an
MVP command. Prefer provider logout; make a protected backup before any manual
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
