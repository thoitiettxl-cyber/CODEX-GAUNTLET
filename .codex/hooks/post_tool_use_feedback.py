#!/usr/bin/env python
from __future__ import annotations

import json
import subprocess
from common import read_event, repo_root


def main() -> int:
    event = read_event()
    root = repo_root(event)
    try:
        changed = subprocess.check_output(
            ["git", "diff", "--name-only"], cwd=root, text=True, stderr=subprocess.DEVNULL
        ).splitlines()
    except Exception:
        changed = []

    suspicious = [p for p in changed if p.startswith((".codex/", ".harness-core/", "qa/"))]
    if suspicious:
        print(json.dumps({
            "systemMessage": "Policy-sensitive files changed; run focused checks and canonical qa/verify.ps1 before completion."
        }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
