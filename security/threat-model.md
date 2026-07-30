# Repository threat model

## Assets

- Repository source, tests, policy and executable verification evidence
- Harness provenance, immutable WorkContext/VerificationReceipt handshake and protected Codex policy
- Sealed security findings, coverage, validation and human triage history

## Trust boundaries

- Untrusted task or pull-request input → repository workspace
- Harness lifecycle context → Gauntlet scope validation
- Project-owned code → Gauntlet verification and security artifact store
- Local workspace → CI final enforcement

## Attacker inputs

- User-controlled repository content and filenames
- Pull-request diffs and dependency manifests
- Knowledge-base documents explicitly selected for ingestion
- Untrusted values reaching shell, deserialization, authorization or file-write boundaries

## Invariants

- qa/verify remains the only executable pass/fail authority
- Harness only supplies context and links receipts; Gauntlet never transitions lifecycle
- No external codex-security CLI, SDK, plugin or network service
- High/critical findings require evidence, validation disposition and complete attack path
- Risk acceptance is human-only, append-only and expires when configured

## Assumptions

- The Git checkout and CI identity are trusted
- The workspace sandbox keeps outbound network disabled by default
- Static discovery can miss vulnerabilities and unsupported surfaces remain explicit proof gaps

<!-- gauntlet-threat-model
{"generated_at": "2026-07-29T17:25:09Z", "input_digest": "fdde5eae2306d7d698f28ed2940222ce80b9816c18c4c62901880cfed4764187", "repository": "codex-gauntlet-termux", "version": "731419f6c009974cd46ae0c80dc36897ae53be93"}
-->
