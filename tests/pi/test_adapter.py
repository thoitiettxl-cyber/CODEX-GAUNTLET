from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.continuity.support import TERMUX_TMP, ContinuityFixture


ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / ".pi" / "extensions" / "gauntlet"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


class PiAdapterContractTests(unittest.TestCase):
    def text(self, name: str) -> str:
        return (ADAPTER / name).read_text(encoding="utf-8")

    def test_dependency_free_auto_discovered_layout(self):
        expected = {"index.ts", "policy.ts", "verification.ts"}
        self.assertEqual(
            expected,
            {path.name for path in ADAPTER.iterdir() if path.is_file()},
        )
        for forbidden in (
            ROOT / ".pi" / "SYSTEM.md",
            ROOT / ".pi" / "APPEND_SYSTEM.md",
            ROOT / ".pi" / "settings.json",
            ROOT / ".pi" / "package.json",
            ROOT / ".pi" / "package-lock.json",
            ROOT / ".pi" / "npm",
            ROOT / ".pi" / "skills",
        ):
            self.assertFalse(forbidden.exists(), forbidden)

    def test_index_wires_prompt_policy_results_and_settlement(self):
        source = self.text("index.ts")
        verification = self.text("verification.ts")
        for marker in (
            'pi.on("before_agent_start"',
            'pi.on("tool_call"',
            'pi.on("tool_result"',
            'pi.on("agent_settled"',
            'pi.on("input"',
            "ctx.mode !== \"tui\"",
            "ctx.ui.confirm",
        ):
            self.assertIn(marker, source)
        self.assertIn("pi.appendEntry", verification)
        self.assertIn("defense in depth", source)
        self.assertIn("not a sandbox", source)
        self.assertIn("event.systemPrompt", source)

    def test_index_maps_pi_session_lifecycle_to_shared_continuity(self):
        source = self.text("index.ts")
        for marker in (
            'pi.on("session_start"',
            'pi.on("session_before_compact"',
            'pi.on("session_compact"',
            'pi.on("session_shutdown"',
            '"SessionStart"',
            '"PreCompact"',
            '"PostCompact"',
            '"SessionEnd"',
            '"lifecycle"',
            '`pi:${nativeSessionId}`',
            'deliverAs: "steer"',
            "pendingRecovery",
            "ctx.sessionManager.getEntries().length",
        ):
            self.assertIn(marker, source)
        self.assertIn("triggerTurn: false", source)
        self.assertIn("event.willRetry", source)
        self.assertNotIn("branchEntries", source)

    def test_policy_adapter_delegates_to_shared_core_and_fails_closed(self):
        source = self.text("policy.ts")
        self.assertIn('"scripts"', source)
        self.assertIn('"gauntlet_policy.py"', source)
        self.assertIn('"bash"', source)
        self.assertIn('"edit"', source)
        self.assertIn('"write"', source)
        self.assertIn('sourceInfo?.source === "builtin"', source)
        self.assertIn('action: "deny"', source)
        self.assertNotIn("npm", source.lower())

    def test_verification_is_mutation_aware_bounded_and_loop_guarded(self):
        source = self.text("verification.ts")
        for marker in (
            "./qa/verify --mode stop",
            '"--mode", "stop"',
            "agent_settled",
            "inFlight",
            "mutationEpoch",
            "failureSignature",
            "repairFollowUpSent",
            "MAX_CAPTURE",
            'deliverAs: "followUp"',
            "triggerTurn: true",
        ):
            self.assertIn(marker, source)

    def test_compatibility_declares_pi_auxiliary_surface(self):
        compatibility = json.loads(
            (ROOT / "qa" / "compatibility.json").read_text(encoding="utf-8")
        )
        pi = compatibility["pi"]
        self.assertEqual("0.82.1", pi["tested_version"])
        self.assertEqual("auxiliary-only", pi["authority"])
        self.assertFalse(pi["sandbox"])
        self.assertFalse(pi["verification_authority"])


@unittest.skipIf(
    os.environ.get("CODEX_GAUNTLET_CROSS_PLATFORM") == "1",
    "the installed Android Pi runtime is absent from cross-platform CI",
)
class PiRuntimeContinuityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pi = shutil.which("pi")
        if not self.pi:
            self.fail("installed Pi runtime is required on Termux")
        self.fixture = ContinuityFixture()
        self.temporary = tempfile.TemporaryDirectory(
            prefix="pi-continuity-runtime-", dir=TERMUX_TMP
        )
        self.temp_root = Path(self.temporary.name)
        self.agent_dir = self.temp_root / "agent"
        self.session_dir = self.temp_root / "sessions"
        self.agent_dir.mkdir()
        self.session_dir.mkdir()
        self.session_file = self.temp_root / "probe.jsonl"
        shutil.copyfile(
            FIXTURES / "continuity-probe-settings.json",
            self.agent_dir / "settings.json",
        )
        shutil.copyfile(
            FIXTURES / "continuity-probe-session.jsonl",
            self.session_file,
        )
        self.native_session_id = "termux006-runtime-probe"
        self.continuity_session_id = f"pi:{self.native_session_id}"
        self.fixture.checkpoint(
            session_id=self.continuity_session_id,
            boundary="Pi runtime probe checkpoint is durable.",
            next_action="Resume the same Pi session and verify this recovery packet.",
            completed=["runtime-neutral lifecycle bridge"],
            pending=["Pi resume proof"],
            effects=["temporary Pi session only"],
            verification={"focused": "pass", "runtime_probe": "pending"},
        )
        self.environment = {
            **self.fixture.environment,
            "PI_CODING_AGENT_DIR": str(self.agent_dir),
            "PI_GAUNTLET_CONTINUITY_PROBE": "1",
            "PI_OFFLINE": "1",
            "PI_TELEMETRY": "0",
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()
        self.fixture.close()

    @staticmethod
    def operation_records(output: str) -> list[dict]:
        records = []
        for line in output.splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and isinstance(value.get("operation"), str):
                records.append(value)
        return records

    def run_pi(self, command: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                self.pi,
                "--approve",
                "--offline",
                "--session",
                str(self.session_file),
                "--session-dir",
                str(self.session_dir),
                "--mode",
                "json",
                command,
            ],
            cwd=ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
        )

    def test_installed_pi_compacts_and_resumes_the_shared_checkpoint(self):
        version = subprocess.run(
            [self.pi, "--version"],
            cwd=ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(0, version.returncode, version.stderr)
        self.assertEqual("0.82.1", version.stdout.strip())

        compacted = self.run_pi("/gauntlet-continuity-probe compact")
        self.assertEqual(0, compacted.returncode, compacted.stderr)
        compact_records = self.operation_records(compacted.stdout)
        native_compaction = next(
            record
            for record in compact_records
            if record["operation"] == "pi.continuity-compaction-probe"
        )
        self.assertEqual("manual", native_compaction["reason"])
        self.assertIn(
            "Pi runtime probe checkpoint is durable.",
            native_compaction["continuity"]["recovery_message"],
        )
        self.assertIn('"type":"compaction"', self.session_file.read_text())

        resumed = self.run_pi("/gauntlet-continuity-probe status")
        self.assertEqual(0, resumed.returncode, resumed.stderr)
        resume_record = next(
            record
            for record in self.operation_records(resumed.stdout)
            if record["operation"] == "pi.continuity-resume-probe"
        )
        recovery = resume_record["continuity"]["recovery_message"]
        self.assertIn("Continuity recovery (SessionStart/resume)", recovery)
        self.assertIn("runtime-neutral lifecycle bridge", recovery)
        self.assertIn("Pi resume proof", recovery)
        self.assertIn('"focused":"pass"', recovery)
        self.assertIn(
            "Resume the same Pi session and verify this recovery packet.",
            recovery,
        )


if __name__ == "__main__":
    unittest.main()
