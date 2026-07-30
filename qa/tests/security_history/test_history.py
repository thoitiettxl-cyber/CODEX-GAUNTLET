from __future__ import annotations

import unittest

from gauntlet.security.history import compare_scans, validate_triage


class SecurityHistoryTests(unittest.TestCase):
    def test_compare(self) -> None:
        self.assertEqual(
            compare_scans([{"findingId": "a"}, {"findingId": "b"}], [{"findingId": "b"}, {"findingId": "c"}]),
            {"fixed": ["a"], "persistent": ["b"], "new": ["c"]},
        )

    def test_agent_cannot_approve_triage(self) -> None:
        record = {"findingId": "gf-12345678", "action": "accepted_risk", "reason": "fixture", "approvedBy": "codex", "approvedAt": "2026-07-29T00:00:00Z"}
        self.assertTrue(validate_triage(record))


if __name__ == "__main__":
    unittest.main()
