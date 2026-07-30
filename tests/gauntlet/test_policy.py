from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from scripts.gauntlet_policy import (
    PolicyContext,
    PolicyInput,
    decide,
)


ROOT = Path(__file__).resolve().parents[2]


class SharedPolicyTests(unittest.TestCase):
    def context(
        self,
        *,
        maintenance: bool = False,
        targets: tuple[str, ...] = (),
    ) -> PolicyContext:
        return PolicyContext(
            cwd=ROOT,
            repo_root=ROOT,
            maintenance_enabled=maintenance,
            maintenance_targets=targets,
        )

    def decision(
        self,
        operation: str,
        *,
        text: str = "",
        targets: tuple[str, ...] = (),
        authority_request: bool = False,
        maintenance: bool = False,
        maintenance_targets: tuple[str, ...] = (),
    ):
        return decide(
            PolicyInput(
                operation=operation,
                text=text,
                targets=targets,
                authority_request=authority_request,
            ),
            self.context(
                maintenance=maintenance,
                targets=maintenance_targets,
            ),
        )

    def test_destructive_shell_and_policy_bypass_are_denied(self):
        for command in (
            "rm -rf /",
            "git reset --hard HEAD~1",
            "git clean -xffd",
            "git push origin main --force",
            "codex --dangerously-bypass-hook-trust",
        ):
            with self.subTest(command=command):
                result = self.decision("shell", text=command)
                self.assertEqual("deny", result.action)
                self.assertTrue(result.policy_sensitive)

    def test_protected_targets_cover_relative_absolute_and_traversal_paths(self):
        cases = (
            ".codex/config.toml",
            str(ROOT / ".codex" / "config.toml"),
            "docs/../.codex/hooks/pre_tool_use_policy.py",
            "qa/compatibility.json",
        )
        for target in cases:
            with self.subTest(target=target):
                result = self.decision("write", targets=(target,))
                self.assertEqual("deny", result.action)
                self.assertTrue(result.mutation)
                self.assertTrue(result.protected_targets)

    def test_exact_maintenance_scope_requires_human_authority(self):
        target = ".codex/hooks/common.py"
        result = self.decision(
            "edit",
            targets=(target,),
            maintenance=True,
            maintenance_targets=(target,),
        )
        self.assertEqual("requires_human", result.action)
        self.assertEqual((target,), result.normalized_targets)

        wrong_scope = self.decision(
            "edit",
            targets=(target,),
            maintenance=True,
            maintenance_targets=(".codex/hooks/pre_tool_use_policy.py",),
        )
        self.assertEqual("deny", wrong_scope.action)

    def test_shell_mutation_never_enters_the_maintenance_lane(self):
        result = self.decision(
            "shell",
            text="cat > .codex/hooks/common.py",
            maintenance=True,
            maintenance_targets=(".codex/hooks/common.py",),
        )
        self.assertEqual("deny", result.action)

    def test_windows_shell_mutation_never_enters_the_maintenance_lane(self):
        chmod = self.decision(
            "shell",
            text="chmod 755 qa/verify.ps1",
            maintenance=True,
            maintenance_targets=("qa/verify.ps1",),
        )
        denied = self.decision(
            "shell",
            text="Set-Content -LiteralPath qa/verify.ps1 -Value x",
            maintenance=True,
            maintenance_targets=("qa/verify.ps1",),
        )
        self.assertEqual("deny", chmod.action)
        self.assertEqual("deny", denied.action)

    def test_hard_protected_paths_remain_denied(self):
        target = ".harness-core/manifest.json"
        result = self.decision(
            "write",
            targets=(target,),
            maintenance=True,
            maintenance_targets=(target,),
        )
        self.assertEqual("deny", result.action)

    def test_maintenance_cannot_weaken_codex_baseline(self):
        target = ".codex/config.toml"
        result = self.decision(
            "write",
            text='sandbox_mode = "danger-full-access"',
            targets=(target,),
            maintenance=True,
            maintenance_targets=(target,),
        )
        self.assertEqual("deny", result.action)

    def test_read_only_mentions_do_not_become_false_mutations(self):
        result = self.decision(
            "shell",
            text="rg -n '.codex/config.toml' docs",
        )
        self.assertEqual("allow", result.action)
        self.assertFalse(result.mutation)

    def test_read_only_search_can_quote_destructive_commands(self):
        for command in (
            "rg -n 'rm -rf /' docs",
            "grep -R 'git reset --hard' docs",
        ):
            with self.subTest(command=command):
                result = self.decision("shell", text=command)
                self.assertEqual("allow", result.action)
                self.assertFalse(result.mutation)

        stdout_only = self.decision(
            "shell",
            text="printf '%s\\n' 'sandbox_workspace_write.network_access = true'",
        )
        self.assertEqual("allow", stdout_only.action)

    def test_protected_write_redirection_has_stable_explanation(self):
        result = self.decision(
            "shell",
            text="printf x > .codex/config.toml",
        )
        self.assertEqual("deny", result.action)
        self.assertEqual("CG.POLICY.PROTECTED_WRITE", result.reason_code)
        explanation = result.explanation()
        for field in ("rule=", "target=", "reason=", "remediation="):
            self.assertIn(field, explanation)

    def test_external_scanner_invocation_is_denied_but_docs_search_is_allowed(self):
        denied = self.decision(
            "shell",
            text="npx @openai/codex-security scan",
        )
        allowed = self.decision(
            "shell",
            text="rg -n 'codex-security' docs",
        )
        self.assertEqual("CG.POLICY.EXTERNAL_SCANNER", denied.reason_code)
        self.assertEqual("deny", denied.action)
        self.assertEqual("allow", allowed.action)

    def test_protected_prose_in_an_unprotected_patch_is_not_a_target(self):
        result = self.decision(
            "patch",
            text="+The protected example is .codex/config.toml.",
            targets=("docs/example.md",),
        )
        self.assertEqual("allow", result.action)
        self.assertFalse(result.protected_targets)

    def test_permission_request_for_protected_shell_scope_is_denied(self):
        result = self.decision(
            "shell",
            text="cat .codex/config.toml",
            authority_request=True,
        )
        self.assertEqual("deny", result.action)

    def test_successful_ordinary_mutations_are_policy_sensitive(self):
        edit = self.decision("edit", targets=("README.md",))
        redirect = self.decision("shell", text="printf x > scratch.txt")
        self.assertEqual("allow", edit.action)
        self.assertTrue(edit.mutation)
        self.assertTrue(edit.policy_sensitive)
        self.assertEqual("allow", redirect.action)
        self.assertTrue(redirect.mutation)

    def test_cli_uses_the_same_decision_contract(self):
        payload = {
            "input": {
                "operation": "write",
                "text": "replacement",
                "targets": [".codex/hooks/pre_tool_use_policy.py"],
            },
            "context": {
                "cwd": str(ROOT),
                "repo_root": str(ROOT),
                "maintenance_enabled": False,
                "maintenance_targets": [],
            },
        }
        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "gauntlet_policy.py"), "--json"],
            input=json.dumps(payload),
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(0, proc.returncode, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual("deny", result["action"])
        self.assertEqual(
            [".codex/hooks/pre_tool_use_policy.py"],
            result["normalized_targets"],
        )
        self.assertLessEqual(len(result["reason"]), 240)

    def test_codex_adapters_delegate_to_the_shared_core(self):
        common = (ROOT / ".codex" / "hooks" / "common.py").read_text()
        pre_tool = (ROOT / ".codex" / "hooks" / "pre_tool_use_policy.py").read_text()
        permission = (
            ROOT / ".codex" / "hooks" / "permission_request_policy.py"
        ).read_text()
        self.assertIn("from scripts.gauntlet_policy import", common)
        self.assertIn("def policy_decision(", common)
        self.assertIn("policy_decision(event)", pre_tool)
        self.assertIn("policy_decision(event)", permission)


if __name__ == "__main__":
    unittest.main()
