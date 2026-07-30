# Security Intelligence gate

Security Intelligence is a clean-room, internal and offline layer. It produces target, threat-model, finding, validation, attack-path, coverage, history and export artifacts. Only `./qa/verify` decides pass/fail.

## Profiles

- `security-fast`: normalized target, meaningful threat-model freshness and candidate discovery.
- `security-full-diff`: fast profile plus validation closure, attack-path calibration, sealing and diff-scoped gate.
- `security-audit-repository`: repository-wide full pipeline, unsupported-language inventory, proof gaps and history comparison.

## Contracts

A complete scan seals `scan-manifest.json`, `findings.json`, `coverage.json`, `validation.json`, `report.md` and `results.sarif`. Manual mutation or digest mismatch fails. An empty finding list is only evidence about the explicit scanned target, never a claim that the repository is safe.

Every candidate has a disposition. Static-only evidence requires a proof gap. High/critical findings require a complete attack path, impact/likelihood rationale and counterevidence review. Open findings at or above the machine-readable threshold block unless a valid, non-expired human triage record exists.

Thresholds live only in `qa/security/thresholds.json`.
