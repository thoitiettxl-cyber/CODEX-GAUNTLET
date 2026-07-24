#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import os
from common import (
    command_text,
    deny_permission,
    maintenance_mutation_authorized,
    mutation_targets,
    protected_target,
    read_event,
)


def main() -> int:
    event = read_event()
    text = command_text(event)
    lowered = text.lower()
    tool_name = str(event.get("tool_name") or "").lower()

    prohibited = (
        "danger-full-access",
        "--dangerously-bypass-hook-trust",
        "sandbox_workspace_write.network_access = true",
    )
    config_mutation = ".codex/config.toml" in mutation_targets(event)
    if (
        tool_name == "bash"
        and any(item in lowered for item in prohibited)
    ) or (
        config_mutation
        and any(item in lowered for item in prohibited)
    ):
        deny_permission("This escalation is prohibited by the repository security baseline.")
        return 0

    if "scripts/bin/harness update" in lowered and os.environ.get("CODEX_GAUNTLET_MAINTENANCE") != "1":
        deny_permission("Harness mutation requires explicit maintenance authorization.")
        return 0

    target = protected_target(event)
    if target and not maintenance_mutation_authorized(event):
        deny_permission(
            f"Escalated mutation of protected path '{target}' is denied outside exact maintenance scope."
        )
        return 0

    # No decision: normal user approval remains authoritative.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
