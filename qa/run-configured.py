#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("gate")
    ns = parser.parse_args()
    config = json.loads((ROOT / "qa" / "project-commands.json").read_text())
    commands = config.get("commands", {}).get(ns.gate)
    if commands is None:
        print(f"FAIL: unknown gate '{ns.gate}'", file=sys.stderr)
        return 2
    if not commands:
        if config.get("application_present"):
            print(f"FAIL: application gate '{ns.gate}' has no executable command configured.", file=sys.stderr)
            return 3
        print(f"SKIP: no application surface declared; '{ns.gate}' has no consumer command.")
        return 0
    for index, command in enumerate(commands, 1):
        print(f"[{ns.gate} {index}/{len(commands)}] {command}")
        result = subprocess.run(command, cwd=ROOT, shell=True)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
