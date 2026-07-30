#!/usr/bin/env python
from __future__ import annotations

from common import (
    deny_pretool,
    policy_decision,
    read_event,
)


def main() -> int:
    event = read_event()
    decision = policy_decision(event)
    if decision.action == "deny":
        deny_pretool(decision.explanation())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
