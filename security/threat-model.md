# Repository threat model

## Assets

- Repository source, tests, policy and executable verification evidence
- Harness provenance, immutable WorkContext/VerificationReceipt handshake and protected Codex policy
- Sealed security findings, coverage, validation and human triage history
- Pinned Windows PE artifacts, native PowerShell controller and local continuity state

## Trust boundaries

- Untrusted task or pull-request input → native Windows repository workspace
- Codex hook event → Python policy and continuity adapters
- Harness lifecycle context → Gauntlet scope validation
- Pinned release/source provenance → executed Windows PE artifacts
- Project-owned code → Gauntlet verification and security artifact store
- Local Windows workspace → Windows CI final enforcement

## Attacker inputs

- User-controlled repository content and filenames
- Pull-request diffs and dependency manifests
- Knowledge-base documents explicitly selected for ingestion
- Untrusted values reaching shell, deserialization, authorization or file-write boundaries
- PowerShell command text and repository-relative or absolute Windows paths

## Invariants

- qa/verify.ps1 remains the only executable pass/fail authority
- Harness only supplies context and links receipts; Gauntlet never transitions lifecycle
- No external codex-security CLI, SDK, plugin or network service
- Only native Windows PowerShell, resolved Windows Python and pinned PE artifacts execute
- High/critical findings require evidence, validation disposition and complete attack path
- Risk acceptance is human-only, append-only and expires when configured

## Assumptions

- The Git checkout and CI identity are trusted
- The workspace sandbox keeps outbound network disabled by default
- The Windows user account, local Python installation and operating-system ACLs are trusted
- Static discovery can miss vulnerabilities and unsupported surfaces remain explicit proof gaps

<!-- gauntlet-threat-model
{"generated_at": "2026-07-30T08:31:24Z", "input_digest": "3a2fabf55ae543f36ae990e90aa924b3630dcc4b605771baa8f6d2a875b0a4a1", "repository": "codex-gauntlet-termux", "version": "62833bf8b664e5288b7fa81fa48101d1de91fe6f"}
-->
