from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from qa.classify_changes import (
    _generic_security_records,
    _python_security_records,
    classification_payload,
    classify_records,
)


class ClassificationTests(unittest.TestCase):
    def test_benign_filenames_do_not_create_security_class(self) -> None:
        records = classify_records(
            ["src/profile.py", "lib/executor.py", "docs/response-format.md"]
        )
        self.assertNotIn(
            "security-sensitive",
            {record.className for record in records},
        )

    def test_python_ast_distinguishes_calls_from_string_literals(self) -> None:
        literal = _python_security_records("literal.py", 'TEXT = "eval(user)"\n')
        dynamic = _python_security_records("dynamic.py", "eval(user_input)\n")
        shell = _python_security_records(
            "shell.py",
            "import subprocess\nsubprocess.run(cmd, shell=True)\n",
        )
        self.assertEqual([], literal)
        self.assertIn("CG.CLASS.DYNAMIC_EXEC", {item.ruleId for item in dynamic})
        self.assertIn("CG.CLASS.SHELL_TRUE", {item.ruleId for item in shell})

    def test_generic_method_exec_is_not_shell_exec(self) -> None:
        records = _generic_security_records(
            "client.ts",
            "const match = expression.exec(value);\n",
        )
        self.assertEqual([], records)

    def test_security_and_complexity_surfaces_remain_independent(self) -> None:
        records = classify_records(["src/auth/validator.py"])
        classes = {record.className for record in records}
        self.assertEqual({"pure-logic", "security-sensitive"}, classes)

    def test_windows_harness_and_state_have_explicit_non_security_classes(self) -> None:
        records = classify_records(
            [
                "scripts/bin/harness.exe",
                ".harness/changesets/example.changeset.jsonl",
            ]
        )
        classes = {record.className for record in records}
        self.assertEqual({"harness-core", "harness-state"}, classes)

    def test_unsafe_changed_path_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsafe changed path"):
            classify_records(["../escape.py"])

    def test_payload_and_record_digest_are_deterministic(self) -> None:
        paths = ["src/math.py", "README.md"]
        first = classification_payload(paths)
        second = classification_payload(paths)
        self.assertEqual(first, second)
        self.assertRegex(first["recordsDigest"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
