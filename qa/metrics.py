#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path


def emit_metrics(repo: Path, payload: dict) -> Path:
    output_dir = repo / "artifacts" / "metrics"
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = output_dir / f"verification-{stamp}-{os.getpid()}.json"
    body = {"schemaVersion": "1", "emittedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), **payload}
    path.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path
