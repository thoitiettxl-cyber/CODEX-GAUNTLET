from __future__ import annotations

import json
import sys
from typing import Any

from .lifecycle import handle_lifecycle, read_lifecycle_event


def handle_event(event: dict[str, Any]) -> dict[str, Any]:
    """Translate a Codex hook envelope to the shared continuity lifecycle."""

    return handle_lifecycle(event).codex_hook_result()


def run_hook(stdin: Any = sys.stdin, stdout: Any = sys.stdout) -> int:
    result = handle_event(read_lifecycle_event(stdin))
    if result:
        stdout.write(
            json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
        )
    return 0
