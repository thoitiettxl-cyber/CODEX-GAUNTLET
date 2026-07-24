#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import os
import re
from common import (
    command_text,
    deny_pretool,
    is_mutating,
    maintenance_mutation_authorized,
    mutation_targets,
    protected_target,
    read_event,
)

DANGEROUS_COMMAND = [
    r"\brm\s+-[^\n]*r[^\n]*f\s+/(?:\s|$)",
    r"\bmkfs(?:\.|\s)",
    r"\bdd\s+if=",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+clean\s+-[^\n]*[xX]",
    r"\bgit\s+push\s+[^\n]*(?:--force|-f\b)",
    r"--dangerously-bypass-hook-trust",
    r"\bdanger-full-access\b",
]


def weakens_codex_config(event: dict, text: str) -> bool:
    tool_name = str(event.get("tool_name") or "").lower()
    config_mutation = ".codex/config.toml" in mutation_targets(event)
    if tool_name != "bash" and not config_mutation:
        return False
    prohibited = (
        r"sandbox_mode\s*=\s*[\"']danger-full-access[\"']",
        r"approval_policy\s*=\s*[\"']never[\"']",
        r"sandbox_workspace_write\.network_access\s*=\s*true",
        r"\bnetwork_access\s*=\s*true",
    )
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in prohibited)


def main() -> int:
    event = read_event()
    text = command_text(event)
    lowered = text.lower()
    tool_name = str(event.get("tool_name") or "").lower()

    if tool_name == "bash":
        for pattern in DANGEROUS_COMMAND:
            if re.search(pattern, text, re.IGNORECASE):
                deny_pretool(f"Blocked destructive or policy-bypass operation: {pattern}")
                return 0

    if weakens_codex_config(event, text):
        deny_pretool("Codex sandbox, approval, or network policy may not be weakened.")
        return 0

    if "scripts/bin/harness update" in lowered:
        if os.environ.get("CODEX_GAUNTLET_MAINTENANCE") != "1":
            deny_pretool("Harness update is a separate maintenance lane. Set explicit operator authorization before requesting approval.")
            return 0
        return 0

    target = protected_target(event)
    mutation_requested = tool_name in {"apply_patch", "edit", "write"} or is_mutating(text)
    if target and mutation_requested:
        if maintenance_mutation_authorized(event):
            return 0
        deny_pretool(f"Direct mutation of protected path '{target}' is not allowed in an ordinary task.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
