from __future__ import annotations

import unittest

from qa.classify_changes import classify_records
from qa.gate_selection import select_gates


def records(paths: list[str]) -> list[dict]:
    return [item.__dict__ for item in classify_records(paths)]


class GateSelectionTests(unittest.TestCase):
    def test_ordinary_ci_avoids_security_repository_scan(self) -> None:
        selection = select_gates(records(["src/math.py"]), "ci")
        self.assertIsNone(selection.securityProfile)
        self.assertNotIn("security", selection.gates)
        self.assertIn("harness-integrity", selection.gates)
        self.assertIn("selftest", selection.gates)
        self.assertIn("policy-audit", selection.gates)

    def test_sensitive_profiles_are_tiered(self) -> None:
        sensitive = records(["src/auth/validator.py"])
        self.assertEqual(
            "security-fast",
            select_gates(sensitive, "targeted").securityProfile,
        )
        self.assertEqual(
            "security-fast",
            select_gates(sensitive, "stop").securityProfile,
        )
        self.assertEqual(
            "security-full-diff",
            select_gates(sensitive, "ci").securityProfile,
        )

    def test_audit_is_repository_scoped_even_for_ordinary_change(self) -> None:
        selection = select_gates(records(["src/math.py"]), "audit")
        self.assertEqual("security-audit-repository", selection.securityProfile)
        self.assertIn("security", selection.gates)

    def test_unknown_is_conservative(self) -> None:
        selection = select_gates(records(["unclassified.asset"]), "targeted")
        self.assertTrue(selection.conservative)
        for gate in (
            "docs",
            "build",
            "unit",
            "integration",
            "acceptance",
            "coverage",
            "policy-audit",
        ):
            self.assertIn(gate, selection.gates)

    def test_windows_harness_change_does_not_become_security_sensitive(self) -> None:
        selection = select_gates(
            records(["scripts/bin/harness.exe"]),
            "stop",
        )
        self.assertIsNone(selection.securityProfile)
        self.assertIn("harness-integrity", selection.gates)
        self.assertIn("integration", selection.gates)

    def test_reasons_preserve_rule_path_class_and_evidence(self) -> None:
        selection = select_gates(records(["src/auth/validator.py"]), "ci")
        self.assertTrue(selection.reasons)
        for reason in selection.reasons:
            self.assertTrue(reason["ruleId"])
            self.assertTrue(reason["path"])
            self.assertTrue(reason["className"])
            self.assertIsInstance(reason["evidence"], list)


if __name__ == "__main__":
    unittest.main()
