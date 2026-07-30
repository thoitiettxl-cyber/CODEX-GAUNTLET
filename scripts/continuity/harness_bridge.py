from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from .model import AmbiguousBinding, BindingUnavailable, bounded_text
from .store import ContinuityStore

MAX_PROCESS_OUTPUT = 1_048_576


class HarnessUnavailable(RuntimeError):
    pass


class HarnessTimedOut(HarnessUnavailable):
    pass


def resolve_repo_root(cwd: str | Path) -> Path:
    candidate = Path(cwd).expanduser().resolve()
    for parent in (candidate, *candidate.parents):
        if (parent / ".git").exists() and (parent / "scripts" / "windows-control.ps1").is_file():
            return parent
    raise ValueError("cwd is not inside a supported Windows control-plane repository")


def state_database(repo_root: Path) -> Path:
    override = os.environ.get("CODEX_CONTINUITY_STATE_ROOT")
    if override:
        state_root = Path(override)
    else:
        local_app_data = os.environ.get("LOCALAPPDATA")
        if not local_app_data:
            raise ValueError("LOCALAPPDATA is required for the continuity state root")
        state_root = Path(local_app_data) / "CodexGauntlet" / "session-state"
    if not state_root.is_absolute():
        raise ValueError("continuity state root must be absolute")
    repository_id = hashlib.sha256(str(repo_root.resolve()).encode("utf-8")).hexdigest()[:20]
    return state_root / f"{repository_id}.sqlite"


def _terminate_tree(process: subprocess.Popen[str]) -> None:
    if os.name == "nt":
        try:
            process.terminate()
            process.wait(timeout=1)
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
            process.wait(timeout=1)
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=0.2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=1)


def bounded_process(
    argv: list[str],
    *,
    cwd: Path,
    timeout_seconds: float,
) -> subprocess.CompletedProcess[str]:
    try:
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            text=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError as exc:
        raise HarnessUnavailable("Harness read could not start") from exc
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        _terminate_tree(process)
        raise HarnessTimedOut("Harness read reached the continuity timeout") from exc
    if len(stdout.encode("utf-8")) + len(stderr.encode("utf-8")) > MAX_PROCESS_OUTPUT:
        _terminate_tree(process)
        raise HarnessUnavailable("Harness read exceeded the continuity output limit")
    return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)


def harness_timeout() -> float:
    raw = os.environ.get("CODEX_CONTINUITY_HARNESS_TIMEOUT_MS", "350")
    try:
        milliseconds = int(raw)
    except ValueError:
        milliseconds = 350
    return max(0.05, min(milliseconds / 1_000, 2.0))


def query_work_graph(repo_root: Path) -> dict[str, Any]:
    command = [
        "powershell.exe",
        "-NoProfile",
        "-File",
        str(repo_root / "scripts" / "windows-control.ps1"),
        "orchestrator",
        "query",
        "work-graph",
        "--json",
    ]
    result = bounded_process(command, cwd=repo_root, timeout_seconds=harness_timeout())
    if result.returncode:
        raise HarnessUnavailable("Harness work-graph read failed")
    try:
        envelope = json.loads(result.stdout)
        graph = envelope["result"]
        if not isinstance(graph["stories"], list) or not isinstance(graph["revision"], str):
            raise TypeError("invalid work graph")
        return graph
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise HarnessUnavailable("Harness returned an invalid work-graph envelope") from exc


def active_stories(graph: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        story
        for story in graph.get("stories", [])
        if isinstance(story, dict) and story.get("status") == "in_progress"
    ]


def select_active_story(graph: dict[str, Any]) -> dict[str, Any]:
    active = active_stories(graph)
    if len(active) == 1:
        result = dict(active[0])
        result["story_revision"] = graph.get("revision", "unknown")
        return result
    if len(active) > 1:
        ids = sorted(bounded_text(story.get("id"), 128) for story in active)
        raise AmbiguousBinding(
            "multiple in_progress stories require explicit binding: " + ", ".join(ids)
        )
    raise BindingUnavailable("no in_progress Harness story is available")


def story_from_graph(graph: dict[str, Any], story_id: str) -> dict[str, Any]:
    matches = [
        story
        for story in graph.get("stories", [])
        if isinstance(story, dict) and story.get("id") == story_id
    ]
    if len(matches) != 1:
        raise BindingUnavailable(f"Harness story is not unique: {story_id}")
    if matches[0].get("status") != "in_progress":
        raise BindingUnavailable(f"Harness story is not in_progress: {story_id}")
    result = dict(matches[0])
    result["story_revision"] = graph.get("revision", "unknown")
    return result


def resolve_binding(
    store: ContinuityStore,
    *,
    session_id: str,
    repo_root: Path,
    explicit_story: str | None = None,
    refresh_existing: bool = True,
) -> tuple[dict[str, Any], list[str]]:
    existing = store.binding(session_id)
    degraded: list[str] = []
    if existing and not explicit_story:
        if refresh_existing:
            try:
                graph = query_work_graph(repo_root)
                matching = [
                    story
                    for story in graph.get("stories", [])
                    if story.get("id") == existing["story_id"]
                ]
                if len(matching) == 1:
                    existing = store.bind(
                        session_id,
                        existing["story_id"],
                        graph.get("revision", existing["story_revision"]),
                        matching[0].get("contract_doc") or existing["plan_path"],
                    )
                else:
                    degraded.append("bound story was not present in the latest Harness read")
            except HarnessTimedOut:
                degraded.append("Harness lock-timeout; used the existing session binding")
            except HarnessUnavailable:
                degraded.append("Harness read unavailable; used the existing session binding")
        return existing, degraded

    graph = query_work_graph(repo_root)
    story = (
        story_from_graph(graph, explicit_story)
        if explicit_story
        else select_active_story(graph)
    )
    binding = store.bind(
        session_id,
        story["id"],
        story["story_revision"],
        story.get("contract_doc") or "unknown",
        explicit=bool(explicit_story),
    )
    return binding, degraded


def git_snapshot(repo_root: Path) -> tuple[str, str]:
    try:
        head = bounded_process(
            ["git", "rev-parse", "HEAD"], cwd=repo_root, timeout_seconds=2
        )
        status = bounded_process(
            ["git", "status", "--porcelain=v1", "-z"],
            cwd=repo_root,
            timeout_seconds=2,
        )
        git_head = head.stdout.strip() if head.returncode == 0 else "unknown"
        status_bytes = status.stdout.encode("utf-8") if status.returncode == 0 else b"unknown"
    except HarnessUnavailable:
        return "unknown", hashlib.sha256(b"unknown").hexdigest()
    return bounded_text(git_head, 128), hashlib.sha256(status_bytes).hexdigest()


def checkpoint_age_seconds(packet: dict[str, Any]) -> int | None:
    from .model import parse_utc

    try:
        created = parse_utc(packet["created_at"])
        now = time.time()
        return max(0, int(now - created.timestamp()))
    except (KeyError, TypeError, ValueError):
        return None
