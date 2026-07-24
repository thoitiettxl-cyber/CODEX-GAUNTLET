#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
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


def orchestration_probe():
    temp_root = os.environ.get('PREFIX', '/data/data/com.termux/files/usr') + '/tmp'
    lock_path = ROOT/'.harness/epoch-transition/writer.lock'
    nested_writer = False
    if lock_path.exists():
        with lock_path.open('rb') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(lock, fcntl.LOCK_UN)
            except BlockingIOError:
                nested_writer = True
    with tempfile.TemporaryDirectory(prefix='gauntlet-orchestration-', dir=temp_root) as tmp:
        db_path = str(Path(tmp) / 'harness.db')
        env = {**os.environ, 'HARNESS_DB_PATH': db_path}
        env.pop('HARNESS_RUN_ID', None)
        if nested_writer:
            # story complete holds the repository writer lock while running proof.
            # Re-entering rebuild through the same lock would deadlock, so nested
            # proof validates the already runtime-tested replay source instead.
            changeset = ROOT/'.harness/changesets/20260724-orchestration-first.changeset.jsonl'
            try:
                operations = [
                    json.loads(line) for line in changeset.read_text().splitlines()
                    if line.strip()
                ]
            except (OSError, json.JSONDecodeError):
                operations = []
            rebuild_ok = (
                operations[:1] != [] and
                operations[0].get('op') == 'changeset.header' and
                any(
                    op.get('op') == 'story.add' and op.get('id') == 'TERMUX-001'
                    for op in operations
                )
            )
        else:
            init = subprocess.run(
                [str(ROOT/'scripts/termux-control'), 'orchestrator', 'init'],
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, env=env
            )
            graph = subprocess.run(
                [str(ROOT/'scripts/termux-control'), 'orchestrator', 'query', 'work-graph', '--json'],
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, env=env
            )
            try:
                stories = json.loads(graph.stdout)['result']['stories']
            except (KeyError, TypeError, json.JSONDecodeError):
                stories = []
            rebuild_ok = (
                init.returncode == 0 and graph.returncode == 0 and
                any(story.get('id') == 'TERMUX-001' for story in stories)
            )
        guard = subprocess.run(
            [
                str(ROOT/'scripts/termux-control'), 'orchestrator', 'story',
                'update', '--id', 'TERMUX-001', '--status', 'planned', '--json'
            ],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, env=env
        )
        help_value_guard = subprocess.run(
            [
                str(ROOT/'scripts/termux-control'), 'orchestrator', 'story',
                'update', '--id', 'help', '--status', 'planned', '--json'
            ],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, env=env
        )
        discovery = subprocess.run(
            [str(ROOT/'scripts/termux-control'), 'orchestrator', 'story', '--help'],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, env=env
        )
        run_id_guard_ok = (
            guard.returncode == 2 and
            'set a stable HARNESS_RUN_ID' in guard.stderr
        )
        help_value_guard_ok = (
            help_value_guard.returncode == 2 and
            'set a stable HARNESS_RUN_ID' in help_value_guard.stderr
        )
        discovery_ok = discovery.returncode == 0 and 'Usage:' in discovery.stdout
        return rebuild_ok, run_id_guard_ok, discovery_ok, help_value_guard_ok


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
    _, hard_reset, _ = hook('.codex/hooks/pre_tool_use_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
        'tool_input': {'command': 'git reset --hard HEAD~1'}
    })
    _, protected, _ = hook('.codex/hooks/pre_tool_use_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
        'tool_input': {'command': 'cat > .codex/config.toml'}
    })
    protected_patch_event = {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'apply_patch',
        'tool_input': {
            'patch': '*** Begin Patch\n*** Update File: .codex/config.toml\n*** End Patch\n'
        }
    }
    ordinary_env = {
        'CODEX_GAUNTLET_MAINTENANCE': '0',
        'CODEX_GAUNTLET_MAINTENANCE_TARGETS': '',
    }
    _, ordinary_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py', protected_patch_event, ordinary_env
    )
    exact_env = {
        'CODEX_GAUNTLET_MAINTENANCE': '1',
        'CODEX_GAUNTLET_MAINTENANCE_TARGETS': '.codex/config.toml',
    }
    _, exact_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py', protected_patch_event, exact_env
    )
    absolute_patch_event = {
        **protected_patch_event,
        'tool_input': {
            'patch': (
                '*** Begin Patch\n'
                f'*** Update File: {ROOT / ".codex/config.toml"}\n'
                '*** End Patch\n'
            )
        },
    }
    _, absolute_ordinary_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py', absolute_patch_event, ordinary_env
    )
    _, absolute_exact_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py', absolute_patch_event, exact_env
    )
    _, traversal_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py',
        {
            **protected_patch_event,
            'tool_input': {
                'patch': (
                    '*** Begin Patch\n'
                    '*** Update File: docs/../.codex/config.toml\n'
                    '*** End Patch\n'
                )
            },
        },
        ordinary_env,
    )
    _, weakened_config_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py',
        {
            **protected_patch_event,
            'tool_input': {
                'patch': (
                    '*** Begin Patch\n'
                    '*** Update File: .codex/config.toml\n'
                    '@@\n'
                    '+sandbox_mode = "danger-full-access"\n'
                    '*** End Patch\n'
                )
            },
        },
        exact_env,
    )
    write_event = {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'Write',
        'tool_input': {
            'file_path': str(ROOT / '.codex/config.toml'),
            'content': 'hooks = true',
        },
    }
    _, ordinary_write, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py', write_event, ordinary_env
    )
    _, exact_write, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py', write_event, exact_env
    )
    _, wrong_scope_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py',
        protected_patch_event,
        {
            'CODEX_GAUNTLET_MAINTENANCE': '1',
            'CODEX_GAUNTLET_MAINTENANCE_TARGETS': '.codex/hooks.json',
        },
    )
    _, hard_protected_patch, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py',
        {
            'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'apply_patch',
            'tool_input': {
                'patch': (
                    '*** Begin Patch\n'
                    '*** Update File: .harness-core/manifest.json\n'
                    '*** End Patch\n'
                )
            },
        },
        {
            'CODEX_GAUNTLET_MAINTENANCE': '1',
            'CODEX_GAUNTLET_MAINTENANCE_TARGETS': '.harness-core/manifest.json',
        },
    )
    _, prose_only, _ = hook(
        '.codex/hooks/pre_tool_use_policy.py',
        {
            'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'apply_patch',
            'tool_input': {
                'patch': (
                    '*** Begin Patch\n'
                    '*** Update File: docs/example.md\n'
                    '@@\n'
                    '+The protected example is .codex/config.toml.\n'
                    '*** End Patch\n'
                )
            },
        },
        ordinary_env,
    )
    _, network_enable, network_stderr = hook('.codex/hooks/pre_tool_use_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
        'tool_input': {'command': 'echo sandbox_workspace_write.network_access = true'}
    })
    _, permission, _ = hook('.codex/hooks/permission_request_policy.py', {
        'cwd': str(ROOT), 'hook_event_name': 'PermissionRequest', 'tool_name': 'Bash',
        'tool_input': {'command': 'codex --dangerously-bypass-hook-trust'}
    })
    permission_event = {
        **protected_patch_event,
        'hook_event_name': 'PermissionRequest',
    }
    _, ordinary_permission, _ = hook(
        '.codex/hooks/permission_request_policy.py', permission_event, ordinary_env
    )
    _, scoped_permission, _ = hook(
        '.codex/hooks/permission_request_policy.py', permission_event, exact_env
    )

    rebuild_ok, run_id_guard_ok, discovery_ok, help_value_guard_ok = orchestration_probe()

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
        'G20': ('untracked changes classified', 'git", "ls-files", "--others", "--exclude-standard' in text('qa/classify_changes.py')),
        'G21': ('multiple change classes split', 'sep="\\n"' in text('qa/verify') and '"\\\\n".join' not in text('qa/verify')),
        'G22': ('hard reset denied', hard_reset.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G23': ('ordinary protected patch denied', ordinary_patch.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G24': ('exact scoped maintenance patch permitted', exact_patch == {}),
        'G25': ('non-allowlisted maintenance patch denied', wrong_scope_patch.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G26': ('hard-protected patch remains denied', hard_protected_patch.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G27': ('protected prose does not create a false target', prose_only == {}),
        'G28': ('network enable denied without hook failure', network_stderr == '' and network_enable.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G29': ('ordinary protected permission request denied', ordinary_permission.get('hookSpecificOutput',{}).get('decision',{}).get('behavior') == 'deny'),
        'G30': ('scoped permission remains with the user', scoped_permission == {}),
        'G31': ('absolute protected patch denied', absolute_ordinary_patch.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G32': ('absolute target respects exact maintenance scope', absolute_exact_patch == {}),
        'G33': ('maintenance cannot weaken sandbox policy', weakened_config_patch.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G34': ('traversal target remains protected', traversal_patch.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G35': ('ordinary Write to protected target denied', ordinary_write.get('hookSpecificOutput',{}).get('permissionDecision') == 'deny'),
        'G36': ('exact scoped Write remains user-authorized', exact_write == {}),
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
        'H17': ('complete Harness payload checked', 'EXPECTED_CORE_PATHS' in text('qa/check_harness.py') and 'EXPECTED_CLI_PATHS' in text('qa/check_harness.py') and '"git", "apply", "--numstat"' in text('qa/check_harness.py')),
        'H18': ('orchestration state rebuilds from semantic changesets', rebuild_ok),
        'H19': ('orchestration mutations require stable run id', run_id_guard_ok),
        'H20': ('orchestration discovery stays read-only', discovery_ok),
        'H21': ('help values cannot bypass orchestration run id', help_value_guard_ok),
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
