#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

from common import (
    deny_permission,
    policy_decision,
    read_event,
)


def main() -> int:
    event = read_event()
    decision = policy_decision(event)
    if decision.action == "deny":
        deny_permission(decision.explanation())
    # No decision: normal user approval remains authoritative.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
