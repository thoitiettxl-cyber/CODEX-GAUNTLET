# Repository threat model

## Assets

- Repository source, tests, policy and executable verification evidence
- Harness provenance, immutable WorkContext/VerificationReceipt handshake and protected Codex policy
- Sealed security findings, coverage, validation and human triage history
- Repository-owned hook, MCP and managed skill configuration that can influence agent execution

## Trust boundaries

- Untrusted task or pull-request input → repository workspace
- Harness lifecycle context → Gauntlet scope validation
- Project-owned code → Gauntlet verification and security artifact store
- Git-visible agent configuration and skill metadata → Codex hook or skill activation
- Local workspace → CI final enforcement

## Attacker inputs

- User-controlled repository content and filenames
- Pull-request diffs and dependency manifests
- Knowledge-base documents explicitly selected for ingestion
- Untrusted values reaching shell, deserialization, authorization or file-write boundaries
- Pull-request changes to hook commands, MCP transports, Codex policy and managed skill instructions

## Invariants

- qa/verify remains the only executable pass/fail authority
- Harness only supplies context and links receipts; Gauntlet never transitions lifecycle
- No external codex-security CLI, SDK, plugin or network service
- Agent configuration audit stays internal, offline, redacted and subordinate to qa/verify
- Managed skill hygiene is read-only and never auto-mutates or injects session context
- High/critical findings require evidence, validation disposition and complete attack path
- Risk acceptance is human-only, append-only and expires when configured

## Assumptions

- The Git checkout and CI identity are trusted
- The workspace sandbox keeps outbound network disabled by default
- Static discovery can miss vulnerabilities and unsupported surfaces remain explicit proof gaps
- JSON, TOML and bounded skill metadata stay within the documented parser shapes

<!-- gauntlet-threat-model
{"generated_at": "2026-07-30T02:44:33Z", "input_digest": "9ef85a528018dcb5921bafcfdad6db5f5472ce6bb2a83fce4658883f4543efe2", "repository": "codex-gauntlet-termux", "version": "61e6319662803d702394ef8dab1aaefe9fa8f884"}
-->
