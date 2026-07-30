from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def git(repo: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=repo, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if check and proc.returncode:
        raise ValueError(proc.stderr.strip() or f"git {' '.join(args)} failed")
    return proc.stdout.strip()


def current_revision(repo: Path) -> str:
    try:
        return git(repo, "rev-parse", "HEAD")
    except ValueError:
        return "UNVERSIONED"


def safe_relative_path(repo: Path, value: str | Path, *, require_exists: bool = False) -> str:
    raw = Path(value)
    if raw.is_absolute():
        candidate = raw.resolve(strict=require_exists)
    else:
        candidate = (repo / raw).resolve(strict=require_exists)
    root = repo.resolve()
    try:
        rel = candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"path escapes repository: {value}") from exc
    if any(part in ("", ".", "..") for part in rel.parts):
        raise ValueError(f"unsafe repository path: {value}")
    return rel.as_posix()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_digest(parts: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8", errors="strict"))
        digest.update(b"\0")
    return digest.hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def atomic_write_json(path: Path, payload: Any) -> None:
    atomic_write(path, (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8"))
