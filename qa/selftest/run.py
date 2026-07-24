#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def hook(path: str, event: dict, env=None):
    proc = subprocess.run(
        [sys.executable, str(ROOT / path)],
        input=json.dumps(event), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=ROOT, env={**os.environ, **(env or {})}
    )
    data = json.loads(proc.stdout) if proc.stdout.strip() else {}
    return proc.returncode, data, proc.stderr


def checks():
    config = text('.codex/config.toml')
    hooks_json = json.loads(text('.codex/hooks.json'))
    hook_commands = [
        h['command']
        for groups in hooks_json['hooks'].values()
        for group in groups
        for h in group['hooks']
    ]
    agents = text('AGENTS.md')
    workflow = text('docs/WORKFLOW.md')
    harness_doc = text('docs/HARNESS.md')
    architecture = text('docs/ARCHITECTURE.md')
    quality = text('docs/quality/CODEX-GAUNTLET.md')
    ci = text('.github/workflows/codex-gauntlet.yml')
    matrix = text('qa/verify-matrix.yaml')

    skill_paths = sorted((ROOT / '.agents/skills').glob('*/SKILL.md'))
    skill_names = []
    for path in skill_paths:
        m = re.search(r'^name:\s*(.+)$', path.read_text(), re.M)
        skill_names.append(m.group(1).strip() if m else '')

    rc, destructive, _ = hook('.codex/hooks/pre_tool_use_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
        'tool_input': {'command': 'rm -rf /'}
    })
    _, protected, _ = hook('.codex/hooks/pre_tool_use_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
        'tool_input': {'command': 'cat > .codex/config.toml'}
    })
    _, permission, _ = hook('.codex/hooks/permission_request_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PermissionRequest', 'tool_name': 'Bash',
        'tool_input': {'command': 'codex --dangerously-bypass-hook-trust'}
    })

    return {
        'G01': ('sandbox baseline', 'sandbox_mode = "workspace-write"' in config and 'approval_policy = "on-request"' in config),
        'G02': ('four core hooks', {'PreToolUse','PermissionRequest','PostToolUse','Stop'} <= set(hooks_json['hooks'])),
        'G03': ('command handlers only', all(h.get('type') == 'command' for groups in hooks_json['hooks'].values() for g in groups for h in g['hooks'])),
        'G04': ('destructive command denied', destructive.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G05': ('protected path denied', protected.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G06': ('permission hook never auto-allows prohibited request', permission.get('hookSpecificOutput',{}).get('decision',{}).get('behavior') == 'deny'),
        'G07': ('Stop delegates to qa/verify', './qa/verify --mode stop' in quality and 'qa" / "verify' in text('.codex/hooks/stop_gate.py')),
        'G08': ('Stop recursion guard', 'stop_hook_active' in text('.codex/hooks/stop_gate.py')),
        'G09': ('network disabled', 'network_access = false' in config),
        'G10': ('user reviews approvals', 'approvals_reviewer = "user"' in config),
        'G11': ('qa/verify executable', os.access(ROOT/'qa/verify', os.X_OK)),
        'G12': ('CI canonical command', './qa/verify --mode ci' in ci),
        'G13': ('CI no remote Harness update', not re.search(r'\b(curl|wget)\b.*(latest|repository-harness)', ci, re.I)),
        'G14': ('central thresholds file', (ROOT/'qa/thresholds.json').exists()),
        'G15': ('unknown is conservative', 'unknown-mixed: [conservative-full-relevant]' in matrix),
        'G16': ('policy audit present', (ROOT/'qa/policy_audit.py').exists()),
        'G17': ('hook trust documented', 'hook trust' in quality.lower()),
        'G18': ('Rules optional', '.codex/rules' not in config and 'rules' not in hooks_json),
        'G19': ('Termux hook interpreters', all(command.startswith('/data/data/com.termux/files/usr/bin/python3 ') for command in hook_commands)),
        'H01': ('Harness provenance', (ROOT/'.harness-core/manifest.json').exists()),
        'H02': ('skill coexistence and unique names', set(skill_names) == {'onboard-repository','audit-onboarding-proposal','verify-suite','spec-check','mutation-audit'} and len(skill_names)==len(set(skill_names))),
        'H03': ('compact AGENTS entrypoint', len(agents.splitlines()) < 45 and 'docs/WORKFLOW.md' in agents and './qa/verify' in agents),
        'H04': ('bounded task stays light', 'does not require a durable plan' in workflow),
        'H05': ('durable task structure', (ROOT/'docs/plans/active').is_dir() and (ROOT/'docs/plans/completed').is_dir() and (ROOT/'docs/templates/exec-plan.md').exists()),
        'H06': ('onboarding pass one read-only', 'Pass 1 — read-only' in text('.agents/skills/onboard-repository/SKILL.md')),
        'H07': ('onboarding exact approval', 'exact proposal items' in text('.agents/skills/onboard-repository/SKILL.md')),
        'H08': ('ordinary Harness tampering protected', '.harness-core/' in text('.codex/hooks/common.py')),
        'H09': ('explicit Harness maintenance authorization', 'CODEX_GAUNTLET_MAINTENANCE' in text('scripts/build-harness-termux')),
        'H10': ('merge conflict requires human direction', 'semantic merge conflicts without human direction' in harness_doc),
        'H11': ('ownership collision fails', 'overlaps protected Gauntlet path' in text('qa/check_harness.py')),
        'H12': ('update regression gates', 'G + H self-tests' in harness_doc and './qa/verify --mode stop' in harness_doc),
        'H13': ('CI hermeticity', 'never downloads the latest Harness' in text('README.md') and 'curl' not in ci),
        'H14': ('single verification authority', 'single_authority: ./qa/verify' in matrix and 'There is no `harness verify`' in quality),
        'H15': ('nested instruction precedence acknowledged', 'smallest authoritative context' in agents and 'Authority order' in workflow),
        'H16': ('Codex directories protected', '.codex/**' in quality and '.agents/skills' in quality),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--group', choices=['all','gauntlet','integration','acceptance'], default='all')
    ns = parser.parse_args()
    selected = checks()
    if ns.group == 'gauntlet':
        selected = {k:v for k,v in selected.items() if k.startswith('G')}
    elif ns.group in ('integration','acceptance'):
        selected = {k:v for k,v in selected.items() if k.startswith('H')}
    failures = []
    for key, (label, ok) in selected.items():
        print(f"{'PASS' if ok else 'FAIL'} {key} — {label}")
        if not ok:
            failures.append(key)
    print(f"\n{len(selected)-len(failures)}/{len(selected)} checks passed")
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
