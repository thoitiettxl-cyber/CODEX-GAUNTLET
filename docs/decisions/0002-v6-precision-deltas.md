# ADR 0002 — V6 precision deltas

## Decision

Codex Gauntlet v6 replaces free-text/substring policy matching with normalized operation, target and redirection analysis. It also separates Harness complexity from Gauntlet security classification and makes security verification tiered.

## Deliberate behavior deltas

- Read-only search text may mention destructive commands, protected paths or external scanners without being denied.
- Protected write redirections are denied with a stable rule ID, concrete target, reason and remediation.
- Filenames such as `profile.py`, `executor.py` and `response-format.md` do not create a security class by name alone.
- Ordinary PR verification does not run full security; sensitive PRs use diff-scoped closure and scheduled/release audits use repository scope.
- The maintenance lane permits one exact shell exception for restoring a
  canonical executable bit (`chmod` on an allowlisted target); ordinary shell
  mutation remains denied.

## Migration

Policy replay fixtures in `qa/fixtures/policy-replay/` define the compatibility corpus. Any later behavior delta requires another ADR and an updated fixture.
