# Security Intelligence gate

Security Intelligence is a clean-room, internal and offline layer. It produces
target, threat-model, finding, validation, attack-path, coverage, history, and
export artifacts. Only `qa/verify.ps1` decides pass/fail.

## Profiles

- `security-fast`: normalized target, meaningful threat-model freshness and candidate discovery.
- `security-full-diff`: fast profile plus validation closure, attack-path calibration, sealing and diff-scoped gate.
- `security-audit-repository`: repository-wide full pipeline, unsupported-language inventory, proof gaps and history comparison.

## Contracts

A complete scan seals `scan-manifest.json`, `findings.json`, `coverage.json`, `validation.json`, `report.md` and `results.sarif`. Manual mutation or digest mismatch fails. An empty finding list is only evidence about the explicit scanned target, never a claim that the repository is safe.

Every candidate has a disposition. Static-only evidence requires a proof gap. High/critical findings require a complete attack path, impact/likelihood rationale and counterevidence review. Open findings at or above the machine-readable threshold block unless a valid, non-expired human triage record exists.

Thresholds live only in `qa/security/thresholds.json`.

## Agent configuration and skill hygiene

The internal `gauntlet/security/config_audit/` domain audits only Git-visible,
repository-owned surfaces:

- `.codex/config.toml` and `.codex/hooks.json`;
- optional repository MCP declarations at `.codex/mcp.json`, `.mcp.json`, or
  `mcp.json`;
- `.agents/skills/*/SKILL.md` and matching `agents/openai.yaml` metadata.

It uses Python standard-library JSON, TOML, lexical YAML-frontmatter, argv, URL,
and path parsing. It never loads an external scanner, follows a configuration
symlink, calls an MCP server, reads user-global credentials, or uses network.
Secret findings retain only rule, path, line, and redacted semantic anchors;
the matched value is never placed in candidates, coverage, reports, or logs.

The domain detects malformed or weakened Codex policy, missing mutation-hook
coverage, shell-evaluated or escaping hook commands, literal secrets, remote or
unpinned MCP execution, inconsistent skill metadata, duplicate skill purpose,
oversized entrypoints, broken references, and executable bypass/install
instructions. Lexical signals remain candidates and receive the same
validation/proof-gap and attack-path treatment as all other findings.

Repository audits inspect the complete fixed inventory. Diff/working-tree
scans inspect only changed agent surfaces, except changes to the auditor or its
gate contract trigger a bounded full-baseline recheck. Unrelated ordinary
changes record the domain as `not-applicable` rather than pretending it ran.

Every fast artifact and full sealed report carries
`coverage.agentConfigurationAudit`. Full gates require schema version, scope,
completion, deterministic counts, redacted evidence, and explicit
`externalScanner=false`/`networkUsed=false`; its candidate count must match the
materialized agent findings. Skill hygiene is audit-only and never auto-fixes
the hard-protected `.agents/skills/**` tree.
