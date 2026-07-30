# Codex Gauntlet v6 — Handshake, Precision & Security Intelligence

> **Tài liệu đặc tả hoàn chỉnh, độc lập**
>
> Codex Gauntlet v6 kết hợp Repository Harness, Codex execution policy, executable verification và Security Intelligence trong một kiến trúc duy nhất nhưng không nhập nhằng quyền hạn.
>
> V6 không yêu cầu người đọc phải có tài liệu v3, v4 hoặc v5. Mọi invariant, contract, workflow, ownership boundary, gate, acceptance scenario và Definition of Done cần thiết đều được định nghĩa trong tài liệu này.

---

## 0. Trạng thái và phạm vi

Codex Gauntlet v6 là kiến trúc repository-centered dành cho Codex làm việc trong một repository có:

- repository truth và durable planning trong Git;
- Repository Harness quản lý context, lifecycle và khả năng resume;
- Codex Gauntlet quản lý mutation policy, verification và security gates;
- CI là authority cuối cùng quyết định repository state có mergeable hay không;
- Security Intelligence chạy nội bộ, offline-first, không phụ thuộc external scanner;
- cơ chế giảm noise chính thức, có metric và acceptance corpus.

V6 là một **strict superset về capability** của nền tảng Gauntlet core, nhưng không được làm thay đổi hành vi tốt của ordinary workflow. Một thay đổi không nhạy cảm phải tiếp tục có authorization, verification cost và user interaction tương đương baseline core.

V6 không phải:

- agent framework mới;
- model/provider abstraction;
- service orchestration platform;
- security product độc lập;
- package manager cho Codex;
- control plane thứ hai cạnh `./qa/verify`;
- cơ chế thay thế CI;
- lý do để mọi task nhỏ phải tạo story hoặc durable plan.

---

# 1. Mục tiêu

Codex Gauntlet v6 phải đạt đồng thời:

1. Codex tìm đúng repository truth với context nhỏ nhất cần thiết.
2. Công việc dài hạn có durable memory trong Git và resume an toàn.
3. Công việc bounded không bị ép vào story/plan nặng.
4. Harness và Gauntlet không trở thành hai control plane cạnh tranh.
5. Harness quyết định work item có runnable hay không, không quyết định application pass/fail.
6. Gauntlet quyết định mutation có được phép và executable proof có pass hay không.
7. CI quyết định final repository state có mergeable hay không.
8. `./qa/verify` là verification authority duy nhất.
9. Mọi policy decision, classification và extra gate đều explainable bằng rule ID, target và reason.
10. Read-only operation không bị block chỉ vì query hoặc output chứa tên command/path nhạy cảm.
11. Security-sensitive classification không bị đồng nhất với complexity classification.
12. Ordinary change không chạy security pipeline nặng.
13. Security-sensitive change được scan theo scope chính xác và có evidence.
14. Finding high/critical có validation disposition và attack path đầy đủ.
15. Không claim reproduction khi chỉ có static signal.
16. Khi thiếu build/runtime, pipeline ghi proof gap thay vì giả vờ pass.
17. Finding có identity ổn định qua nhiều lần scan.
18. Triage/waiver là human-only, append-only, có reason, approver và expiry.
19. Harness update không được âm thầm thay đổi `.codex/`, `qa/` hoặc security policy.
20. CI chạy từ checked-in, pinned, provenance-verified state; không fetch “latest”.
21. Security pipeline chạy offline theo mặc định và không gọi external scanning service.
22. Toàn bộ behavior delta so với core baseline phải được replay-test.
23. Noise, latency, false-block và empty-scan rate phải được đo.
24. Cùng target digest và policy version có thể reuse artifact an toàn.
25. Chỉ trạng thái **Repository CI verified** mới đủ điều kiện merge.

---

# 2. Tương thích và fail-closed

“Phù hợp Codex” trong v6 có nghĩa:

- chỉ dựa trên primitive Codex đã được compatibility baseline chấp nhận;
- compatibility baseline được lưu machine-readable;
- project trust và hook trust được xác minh;
- không giả định hook bắt được mọi execution path;
- hook chỉ là defense in depth, không phải security boundary hoàn chỉnh;
- không dựa bắt buộc vào experimental Rules;
- không bypass sandbox hoặc hook trust;
- có self-test phát hiện behavior thay đổi;
- compatibility check không đạt thì fail closed;
- không claim “Gauntlet fully active” nếu một trust domain chưa được xác minh.

V6 không pin một tên nhánh mutable như `main`. Mọi Harness core hoặc dependency được chấp nhận phải dùng:

- immutable version/tag;
- immutable commit SHA;
- checksum hoặc provenance manifest;
- compatibility review;
- integration suite tương ứng.

---

# 3. Ba authority

## 3.1 Repository Harness

Harness trả lời:

```text
Should this work run now?
```

Harness sở hữu:

- intake;
- task hierarchy;
- dependency readiness;
- lifecycle;
- runnable selection;
- durable recovery context;
- linked execution plan;
- receipt reference sau verification.

Harness không sở hữu application pass/fail, security severity, Codex tool authorization, test threshold, CI mergeability hoặc waiver quyết định bởi agent.

## 3.2 Codex Gauntlet

Gauntlet trả lời:

```text
May this operation run?
Did the selected executable proof pass?
```

Gauntlet sở hữu:

- sandbox và approval policy;
- PreToolUse/PostToolUse/Stop policy;
- change classifier;
- gate selection;
- focused proof;
- Security Intelligence;
- `./qa/verify`;
- VerificationReceipt;
- final-diff policy audit.

Gauntlet không sở hữu product intent, Harness lifecycle, story dependency graph, human risk acceptance hoặc CI platform result.

## 3.3 CI

CI trả lời:

```text
Is the final repository state independently verified and mergeable?
```

CI phải chạy clean checkout, dùng checked-in policy, xác minh provenance, gọi `./qa/verify`, publish diagnostics và trả required status check.

## 3.4 Công thức “done”

Bounded task:

```text
Gauntlet policy allowed
AND selected local verification passed
AND required CI passed
```

Complex work:

```text
Harness runnable
AND Gauntlet policy allowed
AND ./qa/verify passed
AND VerificationReceipt hợp lệ
AND Harness completion transition tham chiếu receipt
AND required CI passed
```

Không thành phần nào được tự thay thế thành phần khác.

---

# 4. Invariant bất biến

1. Repository là system of record.
2. `AGENTS.md` là compact entry map, không phải monolithic manual.
3. `docs/WORKFLOW.md` là canonical human-readable workflow.
4. `./qa/verify` là executable verification authority duy nhất.
5. Harness không định nghĩa application pass/fail.
6. Security Intelligence chỉ tạo artifact; không tự quyết định repository done.
7. Gauntlet không tự tạo hoặc transition Harness story.
8. Harness không tự kích hoạt full Gauntlet verification từ `status`, `doctor` hoặc read-only operation.
9. Complexity classification và security classification là hai quyết định độc lập.
10. CI và hooks không update Harness.
11. Hooks không rollback side effect đã xảy ra.
12. Human-only action không được agent auto-approve.
13. Protected ownership path chỉ thay đổi qua maintenance lane tương ứng.
14. Không có `harness verify`, `security verify` hoặc external scanner làm definition-of-done song song.
15. Regex hoặc lexical match chỉ là candidate signal, không phải vulnerability đã xác nhận.
16. Read-only operation được phân loại từ operation semantics, không từ từ khóa trong query.
17. Mọi extra gate phải có rule ID và reason.
18. Mọi security finding reportable phải có validation closure.
19. High/critical phải được neo vào threat model và attack path.
20. Empty scan không đồng nghĩa repository an toàn.
21. Pipeline pass không được mô tả vượt quá phạm vi evidence thực tế.
22. Cùng commit phải chạy cùng pinned Harness/policy state.
23. Compatibility failure phải fail closed.
24. Chỉ CI verified mới mergeable.

---

# 5. Kiến trúc 9 layer

| Layer | Owner | Artifact chính | Vai trò |
|---|---|---|---|
| 1 | Harness + project | `AGENTS.md` | Compact repository entry map |
| 2 | Harness + project | `docs/` | Repository knowledge, workflow, plans, decisions |
| 3 | Harness | `.agents/skills/onboard-*` | Brownfield discovery và onboarding |
| 4 | Gauntlet | verify/security skills | Explicit Codex workflows |
| 5 | Gauntlet | `.codex/` | Sandbox, hooks, approval policy |
| 6 | Gauntlet | `qa/` | Canonical verification engine |
| 7 | Harness | `.harness-core/` + executable | Provenance và safe maintenance |
| 8 | Repository | CI | Independent final enforcement |
| 9 | Gauntlet | `gauntlet/security/*`, `qa/security/` | Precise, threat-model-grounded Security Intelligence |

```text
Harness lifecycle decision
        ↓ WorkContext
Gauntlet policy + verification decision
        ↓ VerificationReceipt
CI mergeability decision
```

---

# 6. Ownership boundary

## 6.1 Harness-owned

```text
AGENTS.md                         # Harness-managed section only
docs/WORKFLOW.md
docs/HARNESS.md
docs/templates/
docs/plans/
.agents/skills/onboard-repository/
.agents/skills/audit-onboarding-proposal/
scripts/bin/harness*
.harness-core/
```

Harness-managed files phải có provenance. Local customization dùng merge-safe boundary; overlapping conflict phải dừng để con người quyết định.

## 6.2 Gauntlet-owned core

```text
.codex/
qa/
.agents/skills/verify-suite/
.agents/skills/spec-check/
.agents/skills/mutation-audit/
docs/quality/CODEX-GAUNTLET.md
.github/workflows/codex-gauntlet.yml
```

## 6.3 Gauntlet-owned Security Intelligence

```text
gauntlet/security/
qa/security/
.agents/skills/threat-model/
.agents/skills/security-diff-scan/
.agents/skills/validate-finding/
.agents/skills/attack-path-review/
.agents/skills/triage-finding/
docs/quality/SECURITY-GATE.md
security/threat-model.md
```

## 6.4 Project-owned

```text
README.md
docs/product/
docs/ARCHITECTURE.md
docs/decisions/
SECURITY.md
application code
tests
dependency manifests
deployment/infrastructure files
```

## 6.5 Generated artifacts

```text
artifacts/verification/receipts/     # immutable by run
qa/security/reports/                 # append-only sealed artifacts
artifacts/metrics/                   # generated operational metrics
```

Generated artifact không được sửa tay để làm gate pass.

---

# 7. Cấu trúc repository mục tiêu

```text
repo/
├── AGENTS.md
├── README.md
├── .codex/
│   ├── config.toml
│   ├── hooks.json
│   └── hooks/
│       ├── pre_tool_use_policy.py
│       ├── permission_request_policy.py
│       ├── post_tool_use_feedback.py
│       └── stop_gate.py
├── .agents/skills/
│   ├── onboard-repository/
│   ├── audit-onboarding-proposal/
│   ├── verify-suite/
│   ├── spec-check/
│   ├── mutation-audit/
│   ├── threat-model/
│   ├── security-diff-scan/
│   ├── validate-finding/
│   ├── attack-path-review/
│   └── triage-finding/
├── .harness-core/
│   ├── manifest.json
│   └── provenance/
├── docs/
│   ├── README.md
│   ├── WORKFLOW.md
│   ├── HARNESS.md
│   ├── ARCHITECTURE.md
│   ├── product/
│   ├── decisions/
│   ├── plans/{active,completed}/
│   ├── templates/exec-plan.md
│   └── quality/{CODEX-GAUNTLET.md,SECURITY-GATE.md}
├── security/threat-model.md
├── gauntlet/security/
│   ├── targets/
│   ├── kb/
│   ├── threat_model/
│   ├── discovery/
│   ├── validation/
│   ├── attack_path/
│   ├── contracts/
│   ├── history/
│   └── export/
├── scripts/bin/harness
├── qa/
│   ├── verify
│   ├── classify_changes.py
│   ├── gate_selection.py
│   ├── check_harness.py
│   ├── policy_audit.py
│   ├── compatibility.json
│   ├── verify-matrix.yaml
│   ├── thresholds.json
│   ├── run-{unit,integration,acceptance,coverage,mutation}.sh
│   ├── selftest/
│   ├── fixtures/{policy-replay,known-benign,known-vulnerable}/
│   └── security/
│       ├── thresholds.json
│       ├── gates.py
│       ├── run_pipeline.py
│       ├── schemas/
│       └── reports/
├── artifacts/{verification/receipts,metrics}/
└── .github/workflows/codex-gauntlet.yml
```

---

# 8. Repository authority hierarchy

```text
Explicit user intent
        ↓
Current product contract
        ↓
Architecture + durable decisions
        ↓
Active execution plan
        ↓
Code + tests + schemas + qa/verify + runtime evidence
        ↓
Completed plans / historical evidence
```

`CODEX-GAUNTLET.md` quy định cách Codex được phép làm việc, không thay đổi product intent. `SECURITY-GATE.md` quy định security evidence, không tự tạo product requirement.

---

# 9. `AGENTS.md` là compact entrypoint

Root `AGENTS.md` chỉ cần trỏ đến:

```text
docs/WORKFLOW.md
docs/product/
docs/ARCHITECTURE.md
docs/decisions/
docs/quality/CODEX-GAUNTLET.md
docs/quality/SECURITY-GATE.md
security/threat-model.md
./qa/verify
```

Invariant tối thiểu:

- repository là system of record;
- đọc context nhỏ nhất cần thiết;
- bounded work không bắt buộc durable plan;
- complex work dùng `docs/plans/active/`;
- consequential ambiguity phải dừng trước mutation;
- không claim completion khi mandatory verification chưa pass;
- final diff phải review;
- `./qa/verify` là authority duy nhất;
- Harness và Gauntlet giao tiếp qua immutable contracts;
- security-sensitive không đồng nghĩa complex.

Không nhồi test matrix, thresholds, deny regex, hook schema, CI implementation hoặc updater internals vào `AGENTS.md`.

---

# 10. Hai classifier độc lập

## 10.1 Complexity classifier — Harness-owned

Trả lời:

```text
Does this work need durable orchestration?
```

Class:

```text
read_only
bounded
complex
maintenance
```

Complex khi công việc qua nhiều session, có dependency sequence, nhiều contributor, recovery quan trọng, cần linked decisions hoặc final diff không đủ để resume.

## 10.2 Change/security classifier — Gauntlet-owned

Trả lời:

```text
Which executable gates are required for this concrete diff?
```

Class có thể đồng thời tồn tại:

```text
docs_only
pure_logic
api_contract
migration_schema
dependency
security_sensitive
gauntlet_policy
harness_core
unknown_mixed
```

Security-sensitive có thể bounded. Complex có thể không security-sensitive.

Tuyệt đối không:

```text
security-sensitive → auto-create Harness story
complex → auto-run full security scan
```

---

# 11. Harness–Gauntlet handshake

## 11.1 Nguyên tắc

```text
Harness → WorkContext
Gauntlet → VerificationReceipt
```

Harness không gọi lại Gauntlet sau mỗi lifecycle event. Gauntlet không transition Harness lifecycle.

## 11.2 `WorkContext`

```ts
interface WorkContext {
  schemaVersion: string;
  runId: string;
  storyId?: string;
  repository: {
    rootDigest: string;
    baseRevision: string;
    headRevision?: string;
  };
  scope: {
    changedPaths: string[];
    requestedMode: "read_only" | "targeted" | "stop" | "ci" | "audit";
  };
  harness: {
    complexityClass: "read_only" | "bounded" | "complex" | "maintenance";
    runnable: boolean;
    dependencyStateDigest?: string;
    linkedPlan?: string;
  };
  hints?: { declaredChangeClasses?: string[] };
  issuedAt: string;
  issuer: "repository-harness";
  digest: string;
}
```

Quy tắc:

- WorkContext là integrity-protected input hint, không phải bằng chứng pass.
- Gauntlet validate revision, path, digest và repository root.
- Declared class chỉ là hint; Gauntlet vẫn là authority gate selection.
- `runnable=false` ngăn complex work bắt đầu, không biến thành Gauntlet policy rule.
- Read-only request không cần ghi lifecycle state.
- Bounded task có thể không có `storyId`.

## 11.3 `VerificationReceipt`

```ts
interface VerificationReceipt {
  schemaVersion: string;
  receiptId: string;
  runId?: string;
  storyId?: string;
  repository: {
    revision: string;
    dirtyStateDigest?: string;
  };
  target: {
    targetDigest: string;
    paths: string[];
    mode: "targeted" | "stop" | "ci" | "audit";
  };
  policy: {
    policyVersion: string;
    classifierVersion: string;
    selectedGates: string[];
    classificationRecords: string[];
  };
  result: "pass" | "fail" | "incomplete";
  evidenceRefs: string[];
  securityReportId?: string;
  proofGaps: string[];
  startedAt: string;
  completedAt: string;
  digest: string;
}
```

Quy tắc:

- Chỉ `./qa/verify` tạo receipt.
- Receipt pass phải tham chiếu executable evidence.
- Harness chỉ link receipt; không diễn giải lại test result.
- Revision, dirty digest, policy version hoặc target digest đổi thì receipt invalid.
- Receipt không phải waiver.
- Receipt incomplete không transition story thành complete.

## 11.4 Anti-cycle

Không hợp lệ:

```text
harness status
→ full Gauntlet scan
→ lifecycle transition
→ Gauntlet scan lại
```

```text
Gauntlet security-sensitive
→ create Harness story
→ transition story
→ Stop hook
→ scan lại
```

Hợp lệ:

```text
Harness emits WorkContext
→ Gauntlet validates and executes
→ qa/verify emits VerificationReceipt
→ explicit Harness completion references receipt
```

---

# 12. Durable planning

## Read-only

```text
inspect → report
```

Không ghi Harness state. Không heavy verification.

## Bounded

```text
inspect → edit → focused proof → ./qa/verify --mode targeted → report
```

Không bắt buộc story hoặc plan.

## Complex

Tạo `docs/plans/active/<plan>.md` với outcome, scope, context, dependencies, approach, progress, decisions, risks, recovery, validation và linked contract IDs.

Chỉ sau executable validation và explicit lifecycle transition mới chuyển sang `docs/plans/completed/`.

Không tạo mặc định SQLite story database, trace-scoring database, proposal database hoặc parallel definition-of-pass.

---

# 13. Sandbox baseline và approval

Baseline:

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "user"

[sandbox_workspace_write]
network_access = false
```

Mục tiêu:

- ordinary task không sửa policy assets;
- network không bật mặc định;
- legitimate escalation đi qua user approval;
- prohibited escalation bị deny;
- maintenance lane tách biệt.

Không auto-allow Harness mutation, `.codex/**`, policy-critical `qa/**`, network, write ngoài workspace, danger-full-access, hook trust bypass hoặc waiver/triage approval.

---

# 14. Hook architecture v6

V6 giữ bốn hook core:

```text
PreToolUse
PermissionRequest
PostToolUse
Stop
```

Hook chỉ là defense in depth. Sandbox bảo vệ path, hook chặn sớm, policy audit kiểm final diff và CI enforce độc lập.

## 14.1 Normalized operation

```ts
interface NormalizedOperation {
  toolKind: "shell" | "write" | "edit" | "patch" | "mcp" | "local_function" | "read";
  operation: string;
  argv?: string[];
  cwd?: string;
  targets: Array<{
    path?: string;
    uri?: string;
    access: "read" | "write" | "execute" | "network";
  }>;
  redirections?: Array<{
    path: string;
    mode: "read" | "write" | "append";
  }>;
  sideEffect: "none" | "possible" | "definite";
}
```

Không classify từ free-text query, command output, documentation text, filename substring không boundary hoặc dangerous token chỉ xuất hiện trong read-only search pattern.

## 14.2 `PolicyDecision`

```ts
interface PolicyDecision {
  decision: "allow" | "deny" | "requires_human";
  ruleId: string;
  normalizedTarget?: string;
  reason: string;
  remediation?: string;
  selectedGates?: string[];
}
```

Mọi deny/requires-human có stable rule ID, target, concrete reason và cách khắc phục.

## 14.3 PreToolUse

Deny/escalate:

- destructive Git/filesystem;
- secret modification;
- direct `.codex/**` mutation;
- direct policy-critical `qa/**` mutation;
- direct `.harness-core/**` edit;
- direct managed-skill edit;
- direct sealed-report edit;
- direct triage edit thiếu human metadata;
- threshold lowering để pass;
- hook/sandbox bypass;
- external security scanner install/invoke;
- validation PoC yêu cầu network;
- write ngoài normalized workspace;
- shell command có untrusted interpolation vào shell execution.

Read-only command phải allow khi không có write redirection, mutation subcommand hoặc side effect, dù pattern chứa protected path/dangerous token.

## 14.4 PermissionRequest

```text
prohibited escalation → deny
legitimate escalation → no auto-allow → normal user approval
```

## 14.5 PostToolUse

Chỉ syntax, formatter, local lint, affected-module hint, suspicious side-effect signal và classifier cache invalidation.

Không full suite, mutation testing, full security, Harness update hoặc rollback.

## 14.6 Stop

Stop chỉ gọi:

```text
./qa/verify --mode stop
```

`qa/verify` tự gate-select từ actual diff. Stop không mặc định chạy full repository security, full mutation, full CI profile hoặc structural suite không đổi. Phải có re-entry guard như `stop_hook_active`.

---

# 15. Precise change classification

## 15.1 Input

Classifier dùng:

- normalized changed paths;
- path segments, không raw substring;
- extension;
- semantic diff;
- parsed language constructs khi hỗ trợ;
- dependency manifest delta;
- operation type;
- threat-model boundary mapping;
- policy version.

## 15.2 Output

```ts
interface ClassificationRecord {
  className: string;
  ruleId: string;
  path: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  selectedGates: string[];
}
```

Ví dụ hợp lệ:

```text
class=security-sensitive
rule=untrusted-file-write
path=src/upload_handler.py
evidence=[user_input→join→write]
selected_gates=[unit,integration,security-fast]
```

Không hợp lệ:

```text
class=security-sensitive
reason=filename contains "profile"
```

## 15.3 Gate cơ bản

| Change class | Required gate |
|---|---|
| read-only | không heavy verification |
| docs-only | docs validation |
| pure logic | affected unit + coverage |
| API/contract | unit + integration + acceptance + coverage |
| migration/schema | unit + integration + migration + acceptance |
| dependency | build + relevant tests + dependency audit |
| security-sensitive | precise security tier + functional gates |
| `.codex/**` | Gauntlet selftest + full relevant |
| `qa/**` | selftest + policy audit + full relevant |
| Gauntlet skill | skill contract + discovery selftest |
| Harness core | integrity + integration + full relevant |
| `.harness-core/**` | provenance/update-integrity audit |
| threat-model source | freshness evaluation |
| unknown/mixed | conservative full relevant gates |

Unknown không skip.

Các tên `profile.py`, `response-format.md`, `executor.py`, `exec_result` hoặc `apply_patch_notes.md` không tự tạo security class.

---

# 16. Tiered verification

## 16.1 Canonical commands

```text
./qa/verify --mode targeted
./qa/verify --mode stop
./qa/verify --mode ci
./qa/verify --mode audit
```

Không tạo authority khác.

## 16.2 Trigger matrix

| Event | Behavior |
|---|---|
| Read-only inspect | không heavy verification |
| Intake | classification nhẹ |
| Tool mutation | policy decision |
| Bounded proof | targeted affected gates |
| Stop ordinary diff | core fast gates |
| Stop sensitive diff | core fast + target + freshness + fast discovery |
| Story completion | fresh targeted/final receipt |
| PR CI ordinary diff | diff-scoped functional gates, không full security |
| PR CI sensitive diff | diff-scoped full security closure |
| Scheduled/release | repository-wide audit |
| Harness maintenance | maintenance transaction + integration suite |

Gate selection phải deterministic, machine-readable, explainable, cache-aware, conservative khi unknown và không bị lifecycle metadata thay thế.

## 16.3 Security profiles

```text
security-fast
  = target normalization
  + meaningful threat-model freshness
  + language-aware candidate discovery
  + no deep validation

security-full-diff
  = fast
  + validation closure
  + attack-path calibration
  + contract sealing
  + diff-scoped coverage
  + gate

security-audit-repository
  = repository-wide target
  + full pipeline
  + unsupported-language inventory
  + proof-gap report
  + history compare
```

---

# 17. Single verification authority

`./qa/verify` là nơi duy nhất đọc classification, chọn gate, gọi Harness integrity read-only, chạy functional/security gates, phát hành receipt và trả exit code.

Không có:

```text
harness verify
security verify
gauntlet-security scan   # public authority
external-scanner pass
```

`qa/security/run_pipeline.py` là internal implementation component dưới `qa/verify`, không có lifecycle riêng và không định nghĩa done.

`harness doctor` chỉ chứng minh Harness integrity. Security report chỉ chứng minh scope scan đã chạy. Cả hai không tự chứng minh application hoặc repository an toàn.

---

# 18. Security Intelligence clean-room

Bắt buộc:

- chỉ dùng behavior requirements, không copy code/prompt external;
- namespace `gauntlet/security/*`;
- không cài/import/subprocess external security CLI/SDK/plugin;
- không external auth/session;
- không fetch findings từ service ngoài;
- no-network mặc định;
- không workbench state dir riêng;
- không public security control plane;
- pass/fail vẫn qua `./qa/verify`.

Security Intelligence tạo normalized targets, threat model, candidates, validation records, attack paths, coverage, findings, history và exports. Nó không tự quyết định mergeability.

---

# 19. Bảy security capability

## 19.1 Repository-scoped threat model

```ts
interface ThreatModelRecord {
  repository: string;
  sourceRevision: string;
  inputDigest: string;
  policyVersion: string;
  assets: string[];
  trustBoundaries: string[];
  attackerInputs: string[];
  invariants: string[];
  assumptions: string[];
  generatedAt: string;
}
```

Threat model stale khi security-relevant source digest, trust-boundary config, parser/schema version hoặc coverage boundary đổi. Không stale chỉ vì plan, completed-plan, triage hoặc docs không liên quan đổi. `sourceRevision` là provenance; `inputDigest` là freshness authority.

## 19.2 Scope resolver

```ts
type ScanScope =
  | { kind: "repository"; mode: "standard" | "deep" }
  | { kind: "paths"; paths: string[]; mode: "standard" | "deep" }
  | { kind: "diff"; base: string; head: string; mode: "standard" | "deep" }
  | { kind: "working_tree"; base: string; mode: "standard" | "deep" };
```

Reject paths+diff, working-tree có head, invalid ref, path/symlink escape và empty ambiguous scope.

```ts
interface NormalizedTarget {
  kind: string;
  repositoryDigest: string;
  baseRevision?: string;
  headRevision?: string;
  paths: string[];
  mode: "standard" | "deep";
  targetDigest: string;
}
```

## 19.3 Knowledge-base ingestion

Whitelist `.txt`, `.md`, `.pdf`, `.docx`.

Bắt buộc reject symlink/traversal, có size và decompression cap, validate archive entries, invalid UTF-8/malformed/empty extraction fail rõ ràng, cache theo content hash và cleanup staging. KB phải thực sự được dùng trong model/discovery.

## 19.4 Finding contract

```ts
interface SecurityFinding {
  findingId: string;
  occurrenceId: string;
  ruleId: string;
  title: string;
  severity: {
    level: "critical" | "high" | "medium" | "low" | "informational";
    rationale: string;
  };
  confidence: { level: "high" | "medium" | "low" };
  locations: Array<{ path: string; startLine: number; endLine?: number }>;
  rootCause: {
    summary: string;
    anchorDigest: string;
    evidenceRefs: string[];
  };
  validation: ValidationRecord;
  attackPath?: AttackPathRecord;
  remediation?: string;
  state: "open" | "triaged" | "resolved";
  provenance: { source: "gauntlet-security"; scanId: string };
}
```

`findingId` ổn định theo root cause; `occurrenceId` theo concrete occurrence/revision. Location phải relative, normalized, trong repo, không traversal hoặc symlink escape.

## 19.5 Validation engine

```ts
interface ValidationRecord {
  disposition: "reportable" | "suppressed" | "not_applicable" | "deferred";
  method: "reproduction" | "focused_test" | "trace" | "static_only";
  evidenceRefs: string[];
  proofGap?: string;
  validatedAt: string;
}
```

Mọi candidate vào contract có disposition. `static_only` chưa reproduce phải có proof gap. Focused proof local, bounded, no-network. Thiếu runtime thì deferred/static-only; không suppress vì validator lỗi.

## 19.6 Attack path và severity

```ts
interface AttackPathRecord {
  entrypoint: string;
  boundaryCrossings: string[];
  controls: string[];
  sink: string;
  preconditions: string[];
  impactSurface: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  counterevidence: string[];
}
```

High/critical chỉ hợp lệ khi có entrypoint → boundary → controls → sink → impact. Dangerous function name đơn lẻ không đủ. Severity rationale phải giải thích attacker capability, preconditions, control bypass, reachability, impact, confidence và proof gaps.

## 19.7 History, triage, compare, export

```ts
interface FindingTriage {
  findingId: string;
  action: "false_positive" | "accepted_risk" | "wont_fix" | "resolved";
  reason: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
  previousRecordDigest?: string;
  recordDigest: string;
}
```

Triage append-only, human-only, reason/approver bắt buộc, expiry enforced. Agent không tự triage; sửa record cũ fail audit.

```ts
interface ScanDelta {
  fixed: string[];
  persistent: string[];
  newlyObserved: string[];
  unmatched: string[];
}
```

Export JSON, CSV, SARIF và Markdown; SARIF phải schema-valid.

---

# 20. Discovery engine

Ưu tiên AST/parser, semantic token, data/control-flow approximation, manifest/framework-aware rule và threat-model boundary mapping. Regex chỉ là prefilter/fallback/candidate generation, không tự tạo reportable high finding.

Known-vulnerable corpus tối thiểu:

- dynamic code execution;
- shell injection;
- unsafe deserialization;
- untrusted path traversal;
- authorization bypass;
- unsafe secret handling;
- dangerous file upload/write;
- network boundary misuse;
- vulnerable dependency fixture.

Known-benign corpus tối thiểu:

- `.exec()` không có shell semantics;
- string literal chứa `eval(`;
- documentation nhắc scanner;
- fixture mô tả protected path;
- filename profile/response/executor;
- comment chứa dangerous API;
- read-only grep `.codex`;
- sanitized subprocess argv với `shell=false`.

Coverage phải ghi files considered, parsed, fallback-scanned, unsupported, skipped generated/vendor và untested attack surfaces. Unsupported không được chuyển thành clean.

---

# 21. Security contracts và sealing

Mỗi scan tạo:

```text
qa/security/reports/<scan-id>/
├── scan-manifest.json
├── findings.json
├── coverage.json
├── validation.json
├── report.md
└── results.sarif
```

```ts
interface ScanManifest {
  schemaVersion: string;
  scanId: string;
  targetDigest: string;
  policyVersion: string;
  threatModelDigest: string;
  knowledgeBaseDigest?: string;
  startedAt: string;
  completedAt: string;
  artifactDigests: Record<string, string>;
  status: "complete" | "incomplete" | "failed";
}
```

Sau khi complete, artifacts immutable. Digest mismatch/manual edit fail. Rerun tạo scan mới. Triage ở append-only stream riêng. Incomplete scan không dùng làm pass evidence.

---

# 22. Security gates

`qa/security/gates.py` kiểm tra:

1. Target/revision khớp verification request.
2. Threat model hợp lệ và fresh theo meaningful input digest.
3. Mọi candidate có disposition.
4. Static-only chưa reproduce có proof gap.
5. High/critical có full attack path.
6. Severity rationale có impact, likelihood và counterevidence review.
7. Finding/location schema hợp lệ.
8. Không path traversal/symlink escape.
9. Không open finding trên threshold nếu không có valid human triage.
10. Triage chưa hết hạn.
11. Coverage phân biệt considered/scanned/unsupported.
12. Artifact seal hợp lệ.
13. SARIF hợp lệ nếu publish.
14. Không external scanner provenance.
15. Không network evidence ngoài policy.
16. Report target digest khớp receipt.

Bất kỳ điều kiện mandatory fail thì `./qa/verify` fail, không exception ngầm.

---

# 23. Target digest, cache và dedupe

`targetDigest` gồm repository identity, revision/dirty digest, normalized paths, diff digest, mode, classifier/policy version, threat-model digest, KB digest khi dùng và toolchain adapter version.

Có thể reuse khi digest/policy giống, artifact seal valid, không mutation mới, không expiry effect và model không stale.

Không reuse khi dirty state/path/policy/dependency/threat-model đổi, artifact incomplete, report external hoặc waiver hết hạn.

Harness có thể ghi lifecycle event mới tham chiếu receipt cũ khi digest còn hợp lệ; event không làm thay đổi evidence.

---

# 24. Noise budget

Noise budget là requirement chính thức.

## 24.1 Invariant

1. Zero false block trên read-only corpus.
2. Zero unexplained regression trên ordinary core workflow.
3. Mọi extra gate có rule ID, target và reason.
4. Known-benign gold set luôn sạch.
5. Known-vulnerable gold set đạt mandatory recall.
6. Không đánh đồng pipeline success với repository safety.
7. Ordinary diff không sinh empty security report không cần thiết.
8. Không thêm user interaction cho ordinary diff nếu policy không đổi.
9. Stop latency có budget riêng.
10. PR CI diff-scoped; repository-wide chỉ scheduled/release/explicit audit.

## 24.2 Metrics

| Metric | Ý nghĩa |
|---|---|
| `read_only_false_block_rate` | false deny trên read-only corpus |
| `ordinary_workflow_regression_rate` | behavior delta không được phê duyệt |
| `classifier_false_positive_rate` | benign diff bị security-sensitive |
| `classifier_false_negative_rate` | vulnerable fixture bị bỏ sót |
| `security_empty_scan_rate` | scan nặng nhưng không meaningful scope |
| `stop_p50_ms` / `stop_p95_ms` | Stop latency |
| `ci_security_p50_ms` / `ci_security_p95_ms` | security CI latency |
| `gate_count_by_change_class` | số gate theo diff class |
| `threat_model_freshness_rate` | model freshness |
| `validation_completeness_rate` | candidate có disposition |
| `evidence_backed_high_severity_rate` | high/critical có evidence/proof gap |
| `stable_id_churn` | ID churn khi root cause không đổi |
| `history_match_precision` | dedupe/history precision |
| `sarif_export_validity` | SARIF validity |
| `unsupported_surface_rate` | phạm vi scanner không hỗ trợ |

Threshold lưu machine-readable, không hard-code trong `AGENTS.md`.

Release fail nếu read-only false block > 0, ordinary workflow có unexplained gate, benign corpus sinh reportable finding, classifier chỉ dựa substring, Stop luôn full security, docs-only PR luôn repository-wide hoặc report che giấu unsupported/proof gap.

---

# 25. Policy replay và gold corpus

`qa/fixtures/policy-replay/` chứa event đã redacted: read, search, diff, shell inspect, safe write, protected write, maintenance request, network request và security PoC attempt.

```ts
interface ReplayExpectation {
  decision: "allow" | "deny" | "requires_human";
  ruleId: string;
  selectedGates?: string[];
}
```

Mọi behavior delta phải có decision record, scenario, reason và migration note.

Gold corpus:

```text
qa/fixtures/known-benign/
qa/fixtures/known-vulnerable/
```

Unsupported language được report, không giả định clean.

---

# 26. Protected-path policy

## 26.1 Ordinary task — hard protected

```text
.codex/**
qa/** policy-critical files
.harness-core/**
.agents/skills/onboard-repository/**
.agents/skills/audit-onboarding-proposal/**
.agents/skills/verify-suite/**
.agents/skills/spec-check/**
.agents/skills/mutation-audit/**
.agents/skills/threat-model/**
.agents/skills/security-diff-scan/**
.agents/skills/validate-finding/**
.agents/skills/attack-path-review/**
.agents/skills/triage-finding/**
gauntlet/security/**
qa/security/**
qa/security/reports/**
```

## 26.2 Maintenance exceptions

- Harness-owned: official Harness maintenance.
- Gauntlet-owned: explicit Gauntlet maintenance.
- Security rule/schema: explicit security maintenance + full corpus.
- Sealed report: không sửa, rerun tạo artifact mới.
- Triage: human-only append transaction.

## 26.3 Sensitive legitimate project paths

Không blanket block lockfiles, migrations, manifests, infrastructure, deployment, auth, crypto hoặc upload code. Classifier nâng gate tương ứng.

---

# 27. Harness compatibility và provenance

`qa/compatibility.json` tối thiểu:

```json
{
  "schema_version": "1",
  "codex": {
    "baseline": "<approved-machine-readable-baseline>"
  },
  "repository_harness": {
    "tested_core_version": "<immutable-version>",
    "tested_commit": "<immutable-sha>",
    "artifact_sha256": "<checksum>",
    "production_ready": true
  },
  "gauntlet": {
    "policy_version": "6",
    "security_contract_version": "6"
  }
}
```

`qa/check_harness.py` kiểm executable thật, shim state, manifest, version/SHA/checksum, doctor, interrupted update, merge stage, skill inventory, ownership overlap và proof trước baseline raise.

Metadata tự khai báo không đủ. Provenance phải liên kết đến artifact thật đã materialize và verified.

---

# 28. Harness maintenance lane

Read-only:

```text
scripts/bin/harness status
scripts/bin/harness doctor
scripts/bin/harness update --dry-run
```

Dry-run cần network thì request approval, không bật global network.

Apply transaction:

```text
1. git status sạch
2. harness status
3. harness doctor
4. harness update --dry-run
5. review candidate + provenance
6. explicit maintenance authorization
7. harness update
8. conflict resolution nếu có
9. harness doctor
10. integration suite
11. ./qa/verify --mode ci
12. CI pass
13. mới cập nhật compatibility baseline
```

Conflict:

```text
Harness stops
→ BASE / LOCAL / UPSTREAM / RESOLVED retained
→ Codex giải thích semantic difference
→ human chọn direction
→ chỉ edit RESOLVED
→ update --continue --dry-run
→ human review
→ update --continue
```

Không auto-update session start/before task/Stop, không CI fetch latest, không curl mutable branch, không overwrite Gauntlet path và không tự nâng baseline.

---

# 29. Trust bootstrap

Ba trust domain:

## Codex trust

1. Project trusted.
2. `.codex/config.toml` loaded.
3. Hook definitions loaded.
4. Exact hook hashes trusted.
5. Root instruction chain loaded.
6. Nested precedence selftest pass.

## Harness integrity

7. Executable/version/checksum valid.
8. `.harness-core` provenance valid.
9. No pending update.
10. `harness doctor` pass.
11. Expected skills present.
12. Ownership manifest không overlap Gauntlet.

## Gauntlet/security integrity

13. Policy version valid.
14. `qa/verify` authority path intact.
15. Security schema/rule inventory valid.
16. Sealed store không tamper.
17. Gold corpus compatible.
18. No external security dependency.

Bất kỳ domain mandatory fail:

```text
Gauntlet state = NOT FULLY ACTIVE
```

---

# 30. CI v6

## 30.1 Pull request

```text
clean checkout
→ setup toolchain
→ verify provenance
→ determine base/head
→ build/validate WorkContext
→ ./qa/verify --mode ci
   → classify diff
   → ordinary: functional diff gates
   → sensitive: security-full-diff
→ policy audit
→ publish receipt + diagnostics
→ required status check
```

PR CI không repository-wide scan mặc định.

## 30.2 Scheduled/release

```text
clean checkout
→ provenance checks
→ ./qa/verify --mode audit
→ repository-wide Security Intelligence
→ coverage/proof-gap inventory
→ history compare
→ policy audit
→ publish diagnostics
```

## 30.3 CI fail nếu

- Harness provenance/compatibility sai;
- unresolved update;
- `.codex` tamper;
- `qa/verify` bypass;
- threshold lower trái policy;
- test bị delete/skip để né gate;
- secret committed;
- external security dependency;
- sealed report bị sửa;
- invalid/expired triage;
- high/critical thiếu attack path;
- validation closure thiếu;
- coverage che unsupported surfaces;
- workflow bỏ canonical verify;
- ownership overlap;
- mandatory vulnerable fixture bị bỏ qua.

Publish receipt, classification, gate list, test logs, scan manifest, findings, coverage, proof gaps, SARIF, audit report và noise/latency metrics.

---

# 31. Policy audit

`qa/policy_audit.py` kiểm:

## Core

- protected mutation;
- hook/approval bypass;
- destructive policy;
- threshold lowering;
- secret;
- test deletion/skip;
- authority duplication;
- CI bypass.

## Harness

- direct `.harness-core` edit;
- provenance mismatch;
- unsupported version;
- manual managed-skill edit;
- interrupted update;
- ownership overlap;
- baseline raised without proof;
- mutable control plane introduced without decision.

## Security

- external scanner dependency;
- second security CLI;
- sealed report edit;
- triage thiếu reason/approver;
- expired waiver active;
- network PoC;
- schema weakening;
- severity threshold lowering;
- “validated” không evidence;
- coverage laundering;
- manual finding injection;
- unsupported language hidden;
- threat-model digest bypass.

---

# 32. Skills

Harness explicit-only:

```text
$onboard-repository
$audit-onboarding-proposal
```

Onboarding pass 1 read-only; pass 2 chỉ apply proposal user chọn.

Core Gauntlet:

```text
$verify-suite
$spec-check
$mutation-audit
```

`mutation-audit` implicit invocation disabled.

Security:

```text
$threat-model
$security-diff-scan
$validate-finding
$attack-path-review
$triage-finding
```

Security skills explicit-only ngoài internal gate orchestration; triage luôn human approval; duplicate name fail; skill không transition Harness lifecycle.

---

# 33. Acceptance suite v6

Executable suite phải ánh xạ chính xác với danh sách dưới đây.

## Nhóm C — Core behavior (C01–C18)

1. **C01 Compact entrypoint:** root `AGENTS.md` trỏ canonical docs, không duplicate policy.
2. **C02 Nested precedence:** nested instructions đúng chain.
3. **C03 Bounded task:** không story/plan bắt buộc.
4. **C04 Complex task:** active plan, recovery và receipt trước completion.
5. **C05 Read-only:** không Harness write, không heavy verify.
6. **C06 Single authority:** không executable pass/fail ngoài `qa/verify`.
7. **C07 Stop gate:** chỉ `qa/verify --mode stop`, có guard.
8. **C08 CI authority:** chỉ required CI pass mới mergeable.
9. **C09 Unknown:** unknown/mixed không skip.
10. **C10 Sandbox:** protected policy paths read-only trong ordinary task.
11. **C11 Legitimate sensitive project path:** migration/lockfile không blanket deny.
12. **C12 Permission:** prohibited deny, legitimate user approval.
13. **C13 PostToolUse bounded:** không full suite/rollback.
14. **C14 Policy audit:** final tamper bị phát hiện.
15. **C15 Threshold centralization:** không duplicate thresholds.
16. **C16 No experimental dependency:** core pass khi optional Rules bỏ.
17. **C17 Proof honesty:** thiếu project command → proof gap.
18. **C18 Final diff:** receipt tham chiếu reviewed digest.

## Nhóm H — Harness handshake (H01–H16)

1. **H01 Provenance:** version/SHA/checksum/doctor hợp lệ.
2. **H02 Skill coexistence:** không duplicate name.
3. **H03 WorkContext validation:** invalid revision/path/digest reject.
4. **H04 Bounded no story:** `storyId` optional.
5. **H05 Not runnable:** complex work không bắt đầu.
6. **H06 Receipt generation:** chỉ `qa/verify` tạo.
7. **H07 Receipt invalidation:** mutation/policy đổi invalid.
8. **H08 Harness links only:** không tự tính pass.
9. **H09 No lifecycle mutation:** Gauntlet không create/transition story.
10. **H10 Status read-only:** không scan.
11. **H11 Doctor integrity only:** không application proof.
12. **H12 Digest reuse:** lifecycle event không rescan.
13. **H13 Maintenance authorization:** apply cần explicit intent.
14. **H14 Conflict:** human semantic decision.
15. **H15 Ownership collision:** overlap Gauntlet fail closed.
16. **H16 CI hermeticity:** không fetch latest.

## Nhóm P — Precision và noise (P01–P16)

1. **P01 Read-only dangerous token:** grep protected token không deny.
2. **P02 Read-only shell:** status/diff/search không false block.
3. **P03 Write redirection:** protected redirection được detect.
4. **P04 Filename substring:** profile/executor/response không sensitive.
5. **P05 String literal:** `eval(` literal không finding.
6. **P06 Benign exec:** `.exec()` không shell không báo.
7. **P07 Explainable deny:** rule/target/reason/remediation.
8. **P08 Explainable gate:** classification record cho extra gate.
9. **P09 Replay:** ordinary baseline giữ expected decision.
10. **P10 Deliberate delta:** có decision record/fixture.
11. **P11 Stop cost:** ordinary Stop không full security.
12. **P12 PR scope:** ordinary PR không repository-wide.
13. **P13 Empty report:** không sealed report vô nghĩa.
14. **P14 Benign corpus:** zero reportable finding.
15. **P15 Vulnerable corpus:** mandatory fixtures được bắt.
16. **P16 Coverage honesty:** unsupported/proof gap rõ.

## Nhóm S — Security contracts (S01–S18)

1. **S01 Conflicting target:** paths+diff reject.
2. **S02 Working-tree head:** reject.
3. **S03 Traversal:** target/location traversal reject.
4. **S04 KB symlink:** reject.
5. **S05 Malformed/empty docs:** fail rõ ràng.
6. **S06 Meaningful freshness:** relevant boundary source đổi → stale.
7. **S07 Noise-resistant freshness:** unrelated plan/triage đổi → không stale.
8. **S08 Stable finding ID:** root cause giữ ID.
9. **S09 Occurrence ID:** concrete occurrence đổi đúng.
10. **S10 Missing disposition:** gate fail.
11. **S11 Static proof gap:** thiếu gap fail.
12. **S12 High attack path:** thiếu thành phần fail.
13. **S13 Counterevidence:** calibrated downgrade có rationale.
14. **S14 Missing runtime:** không claim reproduction.
15. **S15 Human triage:** reason/approvedBy bắt buộc.
16. **S16 Expired waiver:** active lại và block.
17. **S17 SARIF:** schema-valid.
18. **S18 External scanner:** hook/CI chặn.

## Nhóm O — Operational integrity (O01–O12)

1. **O01 Reproducibility:** clean checkout cho cùng result.
2. **O02 Shim rejection:** unverified shim không production-ready.
3. **O03 Seal:** manual report edit bị phát hiện.
4. **O04 Policy invalidation:** cache/receipt invalid khi policy đổi.
5. **O05 Scheduled audit:** qua `qa/verify --mode audit`.
6. **O06 PR diff scan:** chỉ normalized diff + needed context.
7. **O07 Network off:** validation không gọi ngoài.
8. **O08 Termux/offline:** không giả định Docker/systemd/network.
9. **O09 Unsupported toolchain:** proof gap, không fabricated pass.
10. **O10 Metrics:** latency/gate/false-block/coverage emitted.
11. **O11 Documentation parity:** docs và executable check count đồng bộ.
12. **O12 Mergeability:** chỉ CI status hợp lệ mới mergeable.

Tổng:

```text
18 Core + 16 Handshake + 16 Precision + 18 Security + 12 Operational
= 80 scenarios
```

Không release khi mandatory scenario đỏ.

---

# 34. Implementation roadmap

## Phase 0 — Freeze baseline

Snapshot core behavior, replay corpus, deliberate deltas, verification matrix và Harness provenance.

Exit: `baseline reproducible`.

## Phase 1 — Handshake contracts

Implement WorkContext, VerificationReceipt, target digest, anti-cycle và receipt linkage.

Exit: H03–H12 pass.

## Phase 2 — Hook precision

Normalized operation, shell/redirection analysis, rule IDs, reason/remediation và read-only corpus.

Exit: P01–P09 pass; read-only false block = 0.

## Phase 3 — Classifier precision

Segment-aware paths, semantic diff, language-aware constructs, gate records và gold corpus.

Exit: P04–P16 pass.

## Phase 4 — Tiered verification

Targeted/stop/ci/audit, diff-scoped PR security, scheduled repository audit và digest cache.

Exit: ordinary diff giữ core cost profile.

## Phase 5 — Security contracts

Target resolver, meaningful freshness, finding/coverage/validation/manifest schema và sealing.

Exit: S01–S12 pass.

## Phase 6 — Security intelligence

KB ingestion, language-aware discovery, focused validation, attack path và counterevidence.

Exit: benign clean; vulnerable detected.

## Phase 7 — History, triage, export

Stable IDs, append-only triage, expiry, compare, CSV/SARIF.

Exit: S13–S17 pass.

## Phase 8 — Harness production integrity

Materialize official executable, verify checksum, ownership collision và maintenance transaction.

Exit: H01, H13–H16 pass; `production_ready=true`.

## Phase 9 — Operational metrics

Latency, gate count, false-block, precision/recall, empty scan, unsupported surface và docs parity.

Exit: O01–O12 pass.

## Phase 10 — Adversarial release

Chạy 80 scenario trên clean Linux CI, local offline, Termux-compatible supported scope, no-build fixture, multi-language fixture, protected-path attacks và stale/expired/tampered artifacts.

Exit: all mandatory scenarios green.

---

# 35. Definition of Done v6

## Core và authority

- [ ] Repository là system of record.
- [ ] `AGENTS.md` compact; `docs/WORKFLOW.md` canonical.
- [ ] `./qa/verify` là authority duy nhất; CI là final authority.
- [ ] Không second security CLI/control plane.
- [ ] Bounded không bị ép story; complex có plan/recovery.

## Handshake

- [ ] WorkContext được validate.
- [ ] Receipt chỉ do `qa/verify` tạo và có executable evidence.
- [ ] Receipt invalidation theo revision/digest/policy hoạt động.
- [ ] Harness chỉ link receipt.
- [ ] Gauntlet không mutation lifecycle.
- [ ] Không circular activation.
- [ ] Target digest reuse đúng.

## Policy precision

- [ ] Policy dựa normalized operation/target.
- [ ] Read-only false-block = 0 trên canonical corpus.
- [ ] Không classify từ free-text query/unbounded substring.
- [ ] Mọi deny/approval có rule/target/reason/remediation.
- [ ] Ordinary replay không unexplained regression.
- [ ] Deliberate delta có decision record.

## Verification tiers

- [ ] Targeted nhẹ; ordinary Stop không full security.
- [ ] Sensitive Stop chỉ fast security.
- [ ] Ordinary PR không full security.
- [ ] Sensitive PR diff-scoped full closure.
- [ ] Scheduled/release repository-wide audit.
- [ ] Gate selection deterministic/explainable.
- [ ] Unknown fail conservative.

## Security Intelligence

- [ ] Đủ 9 package native; không external scanner; no-network.
- [ ] Threat model dùng meaningful input digest.
- [ ] Scope resolver và KB safety pass.
- [ ] Discovery language-aware; regex không tự high.
- [ ] Stable finding/occurrence IDs.
- [ ] Mọi candidate có disposition; static-only có proof gap.
- [ ] High/critical có full attack path và counterevidence.
- [ ] Coverage trung thực.
- [ ] Sealed report immutable.
- [ ] Human triage append-only, reason/approver/expiry.
- [ ] JSON/CSV/SARIF valid.
- [ ] Cache không reuse stale evidence.

## Harness và trust

- [ ] Official Harness executable materialized.
- [ ] Version/SHA/checksum/provenance valid; doctor pass.
- [ ] Không pending update/conflict/ownership overlap.
- [ ] CI không fetch latest.
- [ ] Baseline chỉ nâng sau integration pass.
- [ ] Codex/hook trust verified.
- [ ] Failure fail closed.

## Noise và vận hành

- [ ] Benign corpus sạch; vulnerable corpus đạt recall.
- [ ] Noise/latency/empty-scan/unsupported metrics publish.
- [ ] Termux/offline có scoped proof.
- [ ] Thiếu runtime tạo proof gap.
- [ ] Docs và check count đồng bộ.
- [ ] 80 scenarios pass.
- [ ] `./qa/verify --mode ci` pass final state.
- [ ] Required CI green.

---

# 36. Những điều Codex tuyệt đối không được làm

Không:

- tự update Harness trong ordinary task;
- tự bật network;
- bypass hook trust/sandbox;
- tự quyết định semantic conflict;
- edit `.harness-core`, managed skills hoặc sealed reports trực tiếp;
- tạo finding bằng tay;
- tự triage/waive;
- coi Harness metadata/doctor là application proof;
- coi Stop là CI hoặc hook là complete boundary;
- tạo `harness verify`/public `security verify`;
- cài/gọi external scanner;
- coi regex match là validated vulnerability;
- claim reproduction không evidence;
- ẩn unsupported language;
- gọi pipeline pass là repository safe tuyệt đối;
- full repository scan cho mọi ordinary PR;
- đánh đồng sensitive với complex;
- tự tạo Harness story từ Gauntlet;
- để Harness status kích hoạt Gauntlet;
- duplicate/lower thresholds;
- delete/skip tests để né gate;
- curl mutable branch trong CI;
- tự nâng approved Harness version;
- pin metadata “trên giấy” mà không verify executable thật.

---

# 37. Luồng vận hành cuối cùng

## Read-only

```text
User read-only request
→ load compact context
→ optional Harness read-only context
→ policy sees sideEffect=none
→ inspect/search/diff
→ report
```

## Bounded ordinary

```text
User task
→ Harness complexity=bounded
→ optional WorkContext, no story required
→ Gauntlet validates scope
→ PreToolUse per mutation
→ implementation
→ focused proof
→ ./qa/verify --mode targeted
→ VerificationReceipt
→ PR CI
→ Repository CI verified
```

## Bounded security-sensitive

```text
User task
→ Harness complexity=bounded
→ Gauntlet classifies sensitive with rule/evidence
→ mutation policy
→ implementation
→ focused proof
→ Stop: security-fast
→ local receipt
→ PR CI: security-full-diff
→ security gate + policy audit
→ Repository CI verified
```

Không auto-create story.

## Complex

```text
User task
→ Harness complex
→ active plan + dependencies
→ runnable WorkContext
→ Gauntlet validates
→ per-operation policy
→ implementation/milestones
→ final ./qa/verify
→ final VerificationReceipt
→ explicit Harness completion links receipt
→ PR CI
→ Repository CI verified
```

## Scheduled/release audit

```text
Scheduled/release
→ clean checkout
→ provenance
→ ./qa/verify --mode audit
→ repository-wide target
→ threat model + KB
→ discovery + validation + attack paths
→ sealed contracts + history + coverage/proof gaps
→ policy audit
→ audit result
```

## Harness maintenance

```text
Explicit maintenance intent
→ clean git state
→ status + doctor
→ update --dry-run
→ provenance review
→ human approval
→ update
→ human conflict resolution nếu cần
→ doctor + integration
→ ./qa/verify --mode ci
→ CI
→ compatibility baseline update
```

---

# 38. Kết luận kiến trúc

```text
Repository Harness
    = SHOULD this work run now?
      + WHERE durable context lives
      + HOW complex work survives sessions

Codex Gauntlet Core
    = MAY this operation run?
      + WHICH executable gates apply?
      + DID selected proof pass?

Security Intelligence
    = WHICH concrete changes carry security risk?
      + WHAT evidence supports each finding?
      + HOW risk is validated, calibrated and tracked?
      + WHERE coverage and proof gaps remain?

CI
    = IS the final checked-in repository state independently verified?
```

V6 chỉ cho phép handshake:

```text
WorkContext
    ↓
Policy + Implementation + qa/verify
    ↓
VerificationReceipt
    ↓
Explicit lifecycle linkage
    ↓
CI verification
```

Không có vòng kích hoạt ngược. Không chia sẻ quyền pass/fail. Không dùng metadata thay executable evidence.

```text
Agent work complete
        ↓
Harness context complete
        ↓
Local Gauntlet verified
        ↓
Security evidence sealed khi áp dụng
        ↓
VerificationReceipt valid
        ↓
Repository CI verified
```

Chỉ **Repository CI verified** mới đủ điều kiện merge.

Đây là kiến trúc mục tiêu của **Codex Gauntlet v6 — Handshake, Precision & Security Intelligence**.
