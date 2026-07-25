from __future__ import annotations

import json
import unittest
from pathlib import Path

from scripts.rtk_control import classify_command, load_toml, privacy_config_healthy


ROOT = Path(__file__).resolve().parents[2]


class PolicyTests(unittest.TestCase):
    def test_synthetic_command_shapes_match_accuracy_policy(self) -> None:
        fixture = json.loads(
            (ROOT / "tests" / "rtk" / "fixtures" / "command-policy.json").read_text()
        )
        for case in fixture["cases"]:
            with self.subTest(command=case["command"]):
                actual = classify_command(case["command"])
                self.assertEqual(case["posture"], actual["posture"])
                self.assertEqual(case["reason"], actual["reason"])
                if "suggested" in case:
                    self.assertEqual(case["suggested"], actual["suggested"])

    def test_canonical_config_enforces_privacy_and_bounded_recovery(self) -> None:
        config = load_toml(ROOT / "config" / "rtk" / "config.toml")
        self.assertTrue(privacy_config_healthy(config))
        self.assertEqual("/dev/null", config["tracking"]["database_path"])
        self.assertFalse(config["telemetry"]["consent_given"])

    def test_unknown_and_already_wrapped_commands_stay_raw(self) -> None:
        self.assertEqual("raw_required", classify_command("rtk cargo test")["posture"])
        self.assertEqual("raw_required", classify_command("custom-build")["posture"])


if __name__ == "__main__":
    unittest.main()
