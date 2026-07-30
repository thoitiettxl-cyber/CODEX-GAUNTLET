# Add internal agent-configuration security and deterministic skill hygiene

Harness story: `TERMUX-017`

## Outcome

Extend the existing offline Security Intelligence and canonical QA pipeline so
the repository detects unsafe agent configuration and deterministic skill
hygiene regressions without importing ECC, AgentShield, an external scanner,
an auto-learning memory layer, or another control plane.

## Current context

- The v6 security pipeline scans Git-visible application/repository content,
  but it does not model agent configuration as a distinct audited domain.
- `.codex/hooks.json`, `.codex/config.toml`, project hook commands, and managed
  skill metadata are security-relevant inputs already owned by the repository.
- Current self-tests check selected skill invariants, but there is no single
  deterministic report for duplicate purpose, malformed metadata, missing
  required sections, oversized entrypoints, or unsafe instruction content.
- `gauntlet/security/` and `qa/security/` are protected Gauntlet surfaces;
  `.agents/skills/**` is hard-protected and must remain read-only for this work.
- `./qa/verify` remains the only pass/fail authority. Security components may
  emit findings and coverage but may not create a parallel verification CLI.

## Scope

- Add an internal, dependency-free configuration audit for repository-owned
  Codex hook/config and skill metadata surfaces.
- Detect evidence-backed classes such as literal secret material, unsafe hook
  execution shapes, prohibited sandbox/approval weakening, path escape or
  unpinned external execution, malformed config, and excessive/ambiguous hook
  scope. Lexical candidates alone must not be presented as confirmed exploits.
- Add deterministic skill hygiene checks over Git-visible
  `.agents/skills/*/SKILL.md` and `agents/openai.yaml`: stable discovery,
  required structure/metadata, duplicate name or purpose signals, bounded
  entrypoint size, referenced-resource integrity, and unsafe instruction
  patterns with explicit rule IDs and locations.
- Integrate both audits into the existing tiered Security Intelligence path
  and canonical verifier evidence. Fast mode performs bounded checks; full
  mode emits sealed report data and the existing gate evaluates it.
- Add focused fixtures/tests and update the security contract, threat-model
  inputs, policy audit, and scenario count only where executable coverage
  requires it.

## Non-goals

- Installing, vendoring, or invoking ECC, `ecc-agentshield`, npm packages, or
  any external security service.
- Modifying managed `.agents/skills/**` content as part of the audit.
- SessionStart instinct injection, automatic learning, memory mutation,
  confidence/expiry stores, multi-agent delegation, marketplace support, or a
  second verification/control plane.
- Scanning user-global credentials, live MCP services, Android app data, or
  paths outside the repository.
- Treating an empty report as proof that the repository or host is secure.

## Approach

1. Define normalized, stable audit contracts and a fixed Git-visible target
   inventory for agent configuration and managed skill metadata.
2. Implement the dependency-free audit beneath `gauntlet/security/`, with
   structured rule IDs, severity, evidence, coverage, and deterministic order.
3. Wire results into the existing fast/full security pipeline and sealed
   report/gate path; do not add a new top-level command authority.
4. Add benign/vulnerable fixtures and protected QA tests for false-positive,
   traversal, malformed-input, secret-redaction, and determinism behavior.
5. Update the security contract and meaningful threat-model sources, then run
   focused proof and canonical targeted/CI/audit verification as required.

## Planned protected targets

The maintenance process may edit only the following exact protected paths;
the list must be narrowed if implementation proves a target unnecessary:

- `gauntlet/security/config_audit/__init__.py`
- `gauntlet/security/config_audit/audit.py`
- `gauntlet/security/config_audit/rules.py`
- `gauntlet/security/run.py`
- `gauntlet/security/contracts/__init__.py`
- `qa/security/gates.py`
- `qa/tests/security_config/__init__.py`
- `qa/tests/security_config/test_config_audit.py`
- `qa/policy_audit.py`
- `security/threat-model.md`
- `security/threat-model-sources.json`

No `.agents/skills/**`, `.codex/**`, `.harness-core/**`, live/root target, or
credential file is authorized for mutation.

## Progress

- [x] Verify the current repository architecture, protected-path policy,
  security pipeline, canonical verifier, skill layout, and Codex config shape.
- [x] Confirm the accepted product direction and explicit non-goals.
- [x] Record and activate the dedicated Harness story and runnable WorkContext.
- [x] Implement normalized configuration and skill-hygiene audit contracts.
- [x] Integrate the audits into existing fast/full Security Intelligence.
- [x] Add adversarial fixtures and focused tests.
- [x] Update security documentation and meaningful threat-model state.
- [x] Run focused, targeted, CI/audit, receipt, diff, and lifecycle proof.

## Last safe boundary

The implementation and pre-lifecycle proof are complete on clean starting commit
`61e6319662803d702394ef8dab1aaefe9fa8f884` and remains within all 15 paths in
the immutable targeted/CI/audit WorkContexts. The internal audit now covers a
fixed Git-visible inventory, standard-library config parsing, redacted secret
evidence, hook/MCP command and path integrity, bounded deterministic skill
hygiene, nested sealed coverage, and canonical gate enforcement. It audits the
current 2 configuration files and 20 metadata files for 10 managed skills with
zero baseline candidates.

Focused QA passes 48/48 tests, including 11 new adversarial methods; policy
audit and diff checks pass. Final targeted, CI, and repository-audit runs each
produced a current story-linked receipt with zero candidates and zero proof
gaps. The repository audit inspected all 2 config and 20 managed skill metadata
files with no malformed, skipped-symlink, or unsupported surface. Threat-model digest
`9ef85a528018dcb5921bafcfdad6db5f5472ce6bb2a83fce4658883f4543efe2` is
current. Final raw diff and scope review found no change outside the 15 declared
paths and no mutation beneath `.agents/skills/**`, `.codex/**`, or
`.harness-core/**`. Harness linked this completed plan and all four proof flags,
then atomic `story complete TERMUX-017 --json` ran fresh CI successfully and
transitioned the story to `implemented`. Detailed trace 48 meets the high-risk
lane requirement. No implementation or lifecycle work remains.

The mandatory plan-sealed CI run occurs after this final durable-plan update;
its generated receipt remains under `artifacts/verification/receipts/` and is
reported at handoff instead of being copied back into this file, which would
invalidate that same final-state receipt.

## Decisions

- Reuse the internal Security Intelligence and its sealed report/gate path.
- Make skill hygiene deterministic and read-only; do not auto-fix or mutate
  managed skills.
- Keep all scanning repository-scoped, offline, dependency-free, and free of
  secret values in diagnostics.
- Preserve the single `./qa/verify` authority and the one-way
  WorkContext-to-VerificationReceipt lifecycle.
- Treat malformed bounded parser shapes as explicit candidates; do not attempt
  general YAML execution or silently reinterpret unsupported metadata.
- Recheck the full small agent inventory only for repository audits, direct
  agent-surface changes, or changes to the auditor/gate contract; unrelated
  diffs record `not-applicable` coverage.

## Risks

- Secret-pattern checks can leak the matched value unless diagnostics retain
  only redacted evidence and location metadata.
- Broad lexical rules can false-block legitimate hook or skill documentation.
- Parsing TOML/JSON/YAML without new dependencies requires bounded supported
  shapes and explicit unsupported/malformed coverage.
- Editing protected security/QA surfaces can invalidate policy and threat-model
  digests until final evidence is regenerated.
- The unrelated `TERMUX-014` story remains in progress and must not be changed.

## Recovery

- Preserve the clean starting commit and review every changed path against the
  exact maintenance allowlist.
- Before acceptance, recover by reverting only the explicit `TERMUX-017` file
  changes; do not reset, clean, or restore unrelated work.
- If Harness mutation times out, query story/changeset state before retrying.
- If verification fails, leave `TERMUX-017` in progress, record the failing
  evidence and last safe diff, and do not force lifecycle completion.

## External side effects

- Harness lifecycle writes use stable run ID
  `agent-config-security-20260730` and emit semantic changeset operations.
- No network fetch, package installation, root action, deployment, publish,
  live MCP call, credential read, or external message is authorized.

## Validation

- Focused unit tests for target normalization, parsing, rule precision,
  redaction, deterministic ordering/digests, and benign/vulnerable fixtures.
- Existing policy replay and v6 C/H/P/S/O acceptance suite.
- `python3 qa/policy_audit.py`.
- `./qa/verify --mode targeted` with the story WorkContext.
- `./qa/verify --mode ci` and repository-scoped `./qa/verify --mode audit` when
  the final classification and threat-model contract require them.
- Validate the sealed story-linked VerificationReceipt, review raw `git diff`
  and `git status`, move this plan to `completed/`, complete `TERMUX-017`, and
  run mandatory final verification once more.

Evidence before the final immutable rerun:

- Baseline `python3 -m unittest discover -s qa/tests -p 'test_*.py' -v` —
  37/37 pass before implementation.
- Focused `python3 -m unittest -v
  qa.tests.security_config.test_config_audit` — 11/11 pass after raw review.
- Current QA discovery — 48/48 pass; `python3 qa/policy_audit.py` and
  `git diff --check` pass.
- Pre-hardening canonical targeted receipt
  `vr-bc36ce15e2e1f6320c8dca4a0913a07b`, CI receipt
  `vr-f46ce41e0ed92f2ffc8b2f3cb557ce8a`, and audit receipt
  `vr-6888e9faedb32d8fc7a403d7b02b483c` all validated against `TERMUX-017` at
  their snapshots with zero proof gaps. They are historical evidence only;
  fresh final-state receipts remain required.

Final pre-lifecycle evidence:

- `./qa/verify --mode targeted --work-context
  .harness/work-context/agent-config-security-20260730.json` — pass,
  receipt `vr-34d2ae9df65665f04a6b5d007e64f08e` validated for `TERMUX-017`.
- `./qa/verify --mode ci --work-context
  .harness/work-context/agent-config-security-20260730-ci.json` — pass with
  security-full-diff candidate count 0 and proof-gap count 0, receipt
  `vr-aea3fc40689367dda1791c7214b3f7f3` validated for `TERMUX-017`.
- `./qa/verify --mode audit --work-context
  .harness/work-context/agent-config-security-20260730-audit.json` — pass with
  repository scan `20260730T024757Z-61e6319662-02cf09ee01`, candidate count 0,
  proof-gap count 0, and receipt `vr-f5f294e3263859b490f7843b9ec4217f`
  validated for `TERMUX-017`.
- Repository audit agent coverage — `scope=repository`, 22/22 files audited,
  2 config files, 20 metadata files, 10 skills, redaction enabled, no network
  or external scanner, and no malformed/unsupported/symlink-skipped files.
- Raw `git diff`, untracked-file body, 15-path WorkContext scope, threat-model
  freshness, `git status`, and `git diff --check` were reviewed before this
  lifecycle-only plan move.
- `story complete TERMUX-017 --json` — pass; fresh CI emitted receipt
  `vr-fcefafd4016236c9aad7d3a8345de309` and Harness transitioned the story to
  `implemented` without closing unrelated backlog work.
- Trace 48 links intake 25 and `TERMUX-017`, records the exact scope, decisions,
  validation and bounded friction, and achieves the required detailed tier.
- A first post-lifecycle `./qa/verify --mode ci` pass emitted receipt
  `vr-88e500121dae536a9542bfe76cb28e90`; the mandatory plan-sealed CI run follows
  this last documentation update and is the final executable state authority.
