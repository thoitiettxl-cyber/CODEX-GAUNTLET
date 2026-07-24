#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import json
import subprocess
from common import read_event, repo_root


def main() -> int:
    event = read_event()
    if event.get("stop_hook_active"):
        print(json.dumps({"continue": True}))
        return 0

    root = repo_root(event)
    proc = subprocess.run(
        [str(root / "qa" / "verify"), "--mode", "stop"],
        cwd=root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if proc.returncode == 0:
        print(json.dumps({"continue": True}))
        return 0

    output = proc.stdout[-3500:].strip()
    reason = "Canonical verification failed. Fix the failures, then retry completion."
    if output:
        reason += "\n\n" + output
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
