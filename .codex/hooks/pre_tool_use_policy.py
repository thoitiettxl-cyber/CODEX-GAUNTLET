#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import os
import re
from common import command_text, deny_pretool, is_mutating, protected_target, read_event

DANGEROUS = [
    r"\brm\s+-[^\n]*r[^\n]*f\s+/(?:\s|$)",
    r"\bmkfs(?:\.|\s)",
    r"\bdd\s+if=",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+clean\s+-[^\n]*[xX]",
    r"\bgit\s+push\s+[^\n]*(?:--force|-f\b)",
    r"--dangerously-bypass-hook-trust",
    r"\bdanger-full-access\b",
]


def main() -> int:
    event = read_event()
    text = command_text(event)
    lowered = text.lower()

    for pattern in DANGEROUS:
        if re.search(pattern, text, re.IGNORECASE):
            deny_pretool(f"Blocked destructive or policy-bypass operation: {pattern}")
            return 0

    if "scripts/bin/harness update" in lowered:
        if os.environ.get("CODEX_GAUNTLET_MAINTENANCE") != "1":
            deny_pretool("Harness update is a separate maintenance lane. Set explicit operator authorization before requesting approval.")
            return 0
        return 0

    target = protected_target(text)
    if target and is_mutating(text):
        deny_pretool(f"Direct mutation of protected path '{target}' is not allowed in an ordinary task.")
        return 0

    if re.search(r"sandbox_workspace_write\.network_access\s*=\s*true", text, re.IGNORECASE):
        deny_pretool("Global network access may not be enabled by an ordinary task.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
