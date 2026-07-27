# 0010 Enable Pi Router raw management and protocol adapters

Date: 2026-07-27

## Status

Accepted

## Context

ADRs 0007-0009 deliberately limited Pi Router management to a structured
non-secret configuration projection and credential metadata, and limited its
inbound inference surface to OpenAI Responses. The owner now explicitly
accepts a broader CLIProxyAPI-like trust model: possession of the management
key is authority to read and replace the router's fixed raw configuration and
isolated Pi credential files.

The same request requires custom providers across OpenAI Chat Completions,
OpenAI Responses, and Anthropic Messages, plus native inbound adapters for
all three protocols. The management key and proxy API keys must remain
separate despite the broader management authority.

## Decision

- Make `<state-dir>/config.yaml` the router configuration source of truth.
  Preserve exact source bytes on read and successful replacement. Parse and
  semantically validate before a same-directory atomic rename, retain one
  `config.yaml.previous`, and compile Pi-compatible `models.json` plus
  router-only `provider-policy.json`.
- The raw schema owns listener host/port, remote-management allow/secret
  settings, sanitized request logging, string environment values, and provider
  definitions. A non-loopback listener requires an explicit
  `remote-management.allow-remote: true`.
- Expose only fixed authenticated raw targets:
  `GET/PUT /v0/management/config.yaml`,
  `GET /v0/management/auth-files/download?name=<credential-id>`, and
  `POST /v0/management/auth-files`. Do not accept arbitrary paths.
- Import each credential JSON file into a new isolated account so it cannot
  overwrite an existing account. Export the exact containing account
  `auth.json`. Batch import/export is UI orchestration over repeated per-file
  operations, not a new archive format.
- Warn once per page session before credential export. Confirm raw changes
  that can disconnect the current console, including host, port,
  remote-management access, and management-secret changes.
- Permit custom providers to select exactly `openai-completions`,
  `openai-responses`, or `anthropic-messages` and to configure a base URL, API
  key, custom headers, alias, exclusion rules, model prefix, and provider
  proxy. The UI protocol probe sends its protocol-native request directly
  from the browser and never routes that provider secret through Pi Router.
- Add authenticated JSON/SSE inbound adapters at `/v1/chat/completions` and
  `/v1/messages`. Reuse the existing proxy-key store, model resolution,
  provider policy, Pi streaming runtime, abort propagation, and sanitized
  event buffer.
- Keep request logging sanitized and body/header/secret-free. Raw management
  authority does not imply prompt, provider-response, command, arbitrary-path,
  raw-log, or process-control authority.
- Advertise every expanded surface through status capabilities; the UI must
  capability-check raw configuration, credential transfer, provider
  protocols, inference endpoints, and request logging.

This decision supersedes ADRs 0007-0009 only where they prohibit raw
configuration, raw credential transfer, environment/listener editing,
credential-bearing provider fields, direct provider protocol probes, remote
listeners, request-logging mutation, or additional inbound protocols. Their
separate key classes, fixed-path ownership, sanitized logging, one-file UI,
browser retention, accessibility, update, and verification boundaries remain
in force.

## Consequences

Positive:

- comments and formatting survive raw configuration round trips;
- one console can configure all reviewed upstream and inbound protocols;
- auth files can be migrated without manually selecting state paths;
- listener, environment, and logging policy are explicit and recoverable.

Tradeoffs:

- a leaked management key now discloses provider keys, OAuth tokens,
  environment values, and the management secret itself;
- a valid raw edit can intentionally make the current listener unreachable;
- direct browser provider tests require HTTP/HTTPS `connect-src` permission
  and are subject to provider CORS policy;
- `config.yaml`, compiled files, and the embedded UI/binary must remain
  freshness-checked together.

## Recovery

- Invalid YAML or semantics never replace the active source.
- Restore `config.yaml.previous` while the service is stopped after a
  self-lockout or bad activation, preserve mode `0600`, and restart.
- Imported credential files remain in independently named account
  directories and can be removed through the exact credential logout path.
- The repository and native artifact verification lanes remain unchanged;
  Harness metadata is not application evidence.
