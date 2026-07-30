#!/usr/bin/env python
"""Harness-owned adapter for the one-way Codex Gauntlet v6 handshake.

This adapter may read Harness state, emit a WorkContext, and validate a
Gauntlet receipt. It deliberately has no lifecycle mutation command.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from gauntlet.handshake import (  # noqa: E402
    create_work_context,
    load_work_graph,
    normalize_repo_path,
    validate_receipt,
    validate_work_context,
    work_graph_story,
)
from qa.classify_changes import git_paths  # noqa: E402


def _active_or_runnable(story: dict[str, Any]) -> bool:
    return story.get("runnable") is True or story.get("status") in {
        "in_progress",
        "changed",
    }


def _write_immutable(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    path.chmod(0o444)


def _resolve_receipt(path_value: str) -> tuple[Path, dict[str, Any]]:
    rel = normalize_repo_path(ROOT, path_value, require_exists=True)
    path = ROOT / rel
    payload = json.loads(path.read_text(encoding="utf-8"))
    if set(payload) == {"receipt"}:
        rel = normalize_repo_path(
            ROOT,
            str(payload["receipt"]),
            require_exists=True,
        )
        path = ROOT / rel
        payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("VerificationReceipt JSON must be an object")
    return path, payload


def emit_context(ns: argparse.Namespace) -> int:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", ns.run_id):
        raise ValueError("run ID is not safe for a WorkContext filename")

    graph: dict[str, Any] | None = None
    story: dict[str, Any] | None = None
    if ns.story:
        graph = load_work_graph(ROOT)
        story = work_graph_story(graph, ns.story)
        if not _active_or_runnable(story):
            raise ValueError(
                f"Harness story is neither active nor runnable: {ns.story}"
            )
    if ns.complexity == "complex" and story is None:
        raise ValueError("complex WorkContext requires a Harness story")

    paths = ns.path or git_paths(ns.base)
    linked_plan = story.get("contract_doc") if story else None
    context = create_work_context(
        ROOT,
        run_id=ns.run_id,
        requested_mode=ns.mode,
        complexity_class=ns.complexity,
        runnable=_active_or_runnable(story) if story else ns.complexity != "complex",
        changed_paths=paths,
        base_revision=ns.base,
        head_revision="HEAD",
        story_id=ns.story,
        linked_plan=linked_plan,
        declared_change_classes=ns.declared_class,
        work_graph_revision=graph.get("revision") if graph else None,
    )
    validate_work_context(ROOT, context, requested_mode=ns.mode)

    output_value = ns.output or f".harness/work-context/{ns.run_id}.json"
    output_rel = normalize_repo_path(ROOT, output_value, require_exists=False)
    if not output_rel.startswith(".harness/work-context/"):
        raise ValueError("WorkContext output must be under .harness/work-context/")
    output = ROOT / output_rel
    _write_immutable(output, context)
    print(json.dumps({"workContext": output_rel, "digest": context["digest"]}))
    return 0


def check_receipt(ns: argparse.Namespace) -> int:
    receipt_path, receipt = _resolve_receipt(ns.receipt)
    errors = validate_receipt(ROOT, receipt, current=True)
    if receipt.get("result") != "pass":
        errors.append("VerificationReceipt result is not pass")

    if ns.story:
        graph = load_work_graph(ROOT)
        try:
            story = work_graph_story(graph, ns.story)
        except ValueError as exc:
            errors.append(str(exc))
        else:
            if not _active_or_runnable(story):
                errors.append(
                    f"Harness story is neither active nor runnable: {ns.story}"
                )
        if receipt.get("storyId") != ns.story:
            errors.append("VerificationReceipt storyId does not match completion")
        if not receipt.get("workContextDigest"):
            errors.append("story-linked VerificationReceipt lacks WorkContext digest")
        if receipt.get("target", {}).get("mode") == "stop":
            errors.append("Stop receipt cannot complete a Harness story")

    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 4

    result = {
        "receipt": receipt_path.relative_to(ROOT).as_posix(),
        "receiptId": receipt.get("receiptId"),
        "storyId": receipt.get("storyId"),
        "result": "pass",
    }
    print(json.dumps(result, sort_keys=True) if ns.json else result["receiptId"])
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    context = commands.add_parser("context", help="emit an immutable WorkContext")
    context.add_argument("--run-id", required=True)
    context.add_argument(
        "--mode",
        choices=("read_only", "targeted", "stop", "ci", "audit"),
        required=True,
    )
    context.add_argument(
        "--complexity",
        choices=("read_only", "bounded", "complex", "maintenance"),
        required=True,
    )
    context.add_argument("--story")
    context.add_argument("--base", default="HEAD")
    context.add_argument("--path", action="append", default=[])
    context.add_argument("--declared-class", action="append", default=[])
    context.add_argument("--output")
    context.set_defaults(handler=emit_context)

    validate = commands.add_parser(
        "validate-receipt",
        help="validate a current receipt without mutating lifecycle state",
    )
    validate.add_argument("--receipt", required=True)
    validate.add_argument("--story")
    validate.add_argument("--json", action="store_true")
    validate.set_defaults(handler=check_receipt)
    return root


def main() -> int:
    ns = parser().parse_args()
    try:
        return ns.handler(ns)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
