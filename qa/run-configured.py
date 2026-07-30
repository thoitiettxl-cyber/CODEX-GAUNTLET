#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def command_argv(command: str) -> list[str]:
    tokens = shlex.split(command)
    if not tokens:
        raise ValueError("configured command is empty")

    if "&&" in tokens:
        if tokens.count("&&") != 1:
            raise ValueError("configured command has multiple shell control operators")
        split = tokens.index("&&")
        prelude, tokens = tokens[:split], tokens[split + 1 :]
        if prelude[:2] != ["mkdir", "-p"] or len(prelude) < 3 or not tokens:
            raise ValueError("only a leading 'mkdir -p ... &&' prelude is supported")
        for value in prelude[2:]:
            candidate = (ROOT / os.path.expandvars(value)).resolve()
            try:
                relative = candidate.relative_to(ROOT)
            except ValueError as exc:
                raise ValueError("configured output directory escapes repository") from exc
            if not relative.as_posix().startswith(".qa-artifacts/"):
                raise ValueError("configured output directory must be under .qa-artifacts/")
            candidate.mkdir(parents=True, exist_ok=True)

    return [os.path.expandvars(token) for token in tokens]


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
        try:
            argv = command_argv(command)
            result = subprocess.run(argv, cwd=ROOT)
        except (OSError, ValueError) as exc:
            print(f"FAIL: invalid configured command: {exc}", file=sys.stderr)
            return 4
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
