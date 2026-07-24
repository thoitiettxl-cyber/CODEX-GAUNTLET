#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git_paths(base: str | None) -> list[str]:
    commands = []
    if base:
        commands.append(["git", "diff", "--name-only", f"{base}...HEAD"])
    commands += [
        ["git", "diff", "--name-only", "HEAD"],
        ["git", "diff", "--name-only", "--cached"],
    ]
    paths = set()
    for command in commands:
        try:
            out = subprocess.check_output(command, cwd=ROOT, text=True, stderr=subprocess.DEVNULL)
            paths.update(p for p in out.splitlines() if p)
        except subprocess.CalledProcessError:
            pass
    return sorted(paths)


def classify(paths: list[str]) -> list[str]:
    if not paths:
        return ["unknown-mixed"]
    classes = set()
    for path in paths:
        p = path.replace("\\", "/")
        if p.startswith(".codex/"):
            classes.add("codex")
        elif p.startswith("qa/"):
            classes.add("qa")
        elif p.startswith(".harness-core/"):
            classes.add("harness-provenance")
        elif p.startswith(".agents/skills/onboard-") or p.startswith(".agents/skills/audit-onboarding-") or p == "scripts/bin/harness":
            classes.add("harness-managed-core")
        elif p.startswith(".agents/skills/"):
            classes.add("gauntlet-skill")
        elif p == "docs/WORKFLOW.md":
            classes.add("workflow")
        elif p == "AGENTS.md":
            classes.add("agents-entrypoint")
        elif any(token in p.lower() for token in ("auth", "permission", "secret", "crypto", "security")):
            classes.add("security-critical")
        elif any(token in p.lower() for token in ("migration", "schema", "ddl")):
            classes.add("migration-schema")
        elif p.endswith(("package-lock.json", "poetry.lock", "Cargo.lock", "go.sum", "requirements.txt")):
            classes.add("dependency")
        elif p.startswith("docs/") or p.endswith(".md"):
            classes.add("docs-only")
        elif "/api/" in f"/{p}" or "contract" in p.lower():
            classes.add("api-contract")
        elif p.endswith((".py", ".rs", ".go", ".js", ".ts", ".java", ".kt")):
            classes.add("pure-logic")
        else:
            classes.add("unknown-mixed")
    if len(classes) > 1 and "docs-only" in classes:
        classes.remove("docs-only")
    return sorted(classes or {"unknown-mixed"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*")
    parser.add_argument("--base")
    parser.add_argument("--json", action="store_true")
    ns = parser.parse_args()
    paths = ns.paths or git_paths(ns.base)
    result = {"paths": paths, "classes": classify(paths)}
    print(json.dumps(result, indent=2) if ns.json else "\n".join(result["classes"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
