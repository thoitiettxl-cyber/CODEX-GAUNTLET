#!/data/data/com.termux/files/usr/bin/python3
"""Deterministic, explainable Codex Gauntlet v6 change classifier."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
CODE_EXTENSIONS = {
    ".bash",
    ".go",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".php",
    ".ps1",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".ts",
    ".tsx",
}
DEPENDENCY_FILES = {
    "Cargo.lock",
    "Cargo.toml",
    "Pipfile.lock",
    "build.gradle",
    "bun.lockb",
    "go.mod",
    "go.sum",
    "package-lock.json",
    "package.json",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pom.xml",
    "pyproject.toml",
    "requirements.txt",
    "yarn.lock",
}
SECURITY_SEGMENTS = {
    "auth",
    "authentication",
    "authorization",
    "crypto",
    "cryptography",
    "deserialize",
    "deserialization",
    "firewall",
    "network",
    "oauth",
    "permission",
    "permissions",
    "secret",
    "secrets",
    "session",
    "sessions",
    "upload",
    "uploads",
}
MIGRATION_SEGMENTS = {"ddl", "migration", "migrations", "schema", "schemas"}
API_SEGMENTS = {"api", "apis", "contract", "contracts", "graphql", "openapi"}
BENIGN_FILENAMES = {
    "apply_patch_notes.md",
    "executor.py",
    "profile.py",
    "response-format.md",
    "response.py",
}

BASE_GATES = {
    "docs-only": ["docs"],
    "pure-logic": ["unit", "coverage"],
    "api-contract": ["unit", "integration", "acceptance", "coverage"],
    "migration-schema": ["unit", "integration", "migration", "acceptance"],
    "dependency": ["build", "unit", "integration", "dependency-audit"],
    "security-sensitive": ["unit", "integration"],
    "gauntlet-policy": [
        "docs",
        "selftest",
        "policy-audit",
        "unit",
        "integration",
    ],
    "harness-core": ["harness-integrity", "integration", "acceptance"],
    "harness-state": ["harness-integrity"],
    "threat-model-source": ["threat-model-freshness"],
    "pi": ["unit", "integration", "coverage"],
    "unknown-mixed": [
        "docs",
        "build",
        "unit",
        "integration",
        "acceptance",
        "coverage",
        "policy-audit",
    ],
}


@dataclass(frozen=True)
class ClassificationRecord:
    className: str
    ruleId: str
    path: str
    evidence: list[str]
    confidence: str
    selectedGates: list[str]


def _git(*args: str) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return proc.stdout if proc.returncode == 0 else ""


def git_paths(base: str | None) -> list[str]:
    paths: set[str] = set()
    if base:
        paths.update(_git("diff", "--name-only", f"{base}...HEAD").splitlines())
    paths.update(_git("diff", "--name-only", "HEAD").splitlines())
    paths.update(_git("diff", "--name-only", "--cached").splitlines())
    paths.update(_git("ls-files", "--others", "--exclude-standard").splitlines())
    return sorted(path for path in paths if path)


def _safe_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"unsafe changed path: {value}")
    return path.as_posix()


def _record(
    class_name: str,
    rule_id: str,
    path: str,
    evidence: Iterable[str],
    confidence: str = "high",
) -> ClassificationRecord:
    return ClassificationRecord(
        class_name,
        rule_id,
        path,
        list(evidence),
        confidence,
        list(BASE_GATES[class_name]),
    )


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if not isinstance(node.func, ast.Attribute):
        return ""
    parts = [node.func.attr]
    value = node.func.value
    while isinstance(value, ast.Attribute):
        parts.append(value.attr)
        value = value.value
    if isinstance(value, ast.Name):
        parts.append(value.id)
    return ".".join(reversed(parts))


def _python_security_records(path: str, source: str) -> list[ClassificationRecord]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    records: list[ClassificationRecord] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func_name = _call_name(node)
        line = getattr(node, "lineno", 1)
        if func_name in {"eval", "exec", "builtins.eval", "builtins.exec"}:
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.DYNAMIC_EXEC",
                    path,
                    [f"AST call {func_name} at line {line}"],
                )
            )
        if func_name in {
            "os.system",
            "subprocess.getoutput",
            "subprocess.getstatusoutput",
        }:
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.SHELL_EXEC",
                    path,
                    [f"AST shell execution {func_name} at line {line}"],
                )
            )
        if func_name.startswith("subprocess.") and any(
            keyword.arg == "shell"
            and isinstance(keyword.value, ast.Constant)
            and keyword.value.value is True
            for keyword in node.keywords
        ):
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.SHELL_TRUE",
                    path,
                    [f"subprocess shell=True at line {line}"],
                )
            )
        if func_name in {
            "marshal.load",
            "marshal.loads",
            "pickle.load",
            "pickle.loads",
            "yaml.load",
        }:
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.UNSAFE_DESERIALIZATION",
                    path,
                    [f"deserialization call {func_name} at line {line}"],
                )
            )
        if func_name in {
            "open",
            "io.open",
            "pathlib.Path.write_bytes",
            "pathlib.Path.write_text",
        }:
            mode_write = func_name.startswith("pathlib.Path.write_")
            if func_name in {"open", "io.open"}:
                mode_values = [
                    keyword.value.value
                    for keyword in node.keywords
                    if keyword.arg == "mode"
                    and isinstance(keyword.value, ast.Constant)
                ]
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    mode_values.append(node.args[1].value)
                mode_write = any(
                    any(flag in str(value) for flag in "wax+")
                    for value in mode_values
                )
            first = node.args[0] if node.args else None
            if mode_write and first is not None and not isinstance(first, ast.Constant):
                records.append(
                    _record(
                        "security-sensitive",
                        "CG.CLASS.UNTRUSTED_FILE_WRITE",
                        path,
                        [f"dynamic write target at line {line}"],
                        "medium",
                    )
                )
    return records


def _generic_security_records(path: str, source: str) -> list[ClassificationRecord]:
    records: list[ClassificationRecord] = []
    for line_no, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "//", "/*", "*")):
            continue
        if re.search(r"\b(?:child_process\.)?exec\s*\(", stripped) and not re.search(
            r"\.exec\s*\(", stripped
        ):
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.SHELL_EXEC",
                    path,
                    [f"executable exec call at line {line_no}"],
                    "medium",
                )
            )
        if re.search(r"\beval\s*\(", stripped):
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.DYNAMIC_EXEC",
                    path,
                    [f"dynamic eval call at line {line_no}"],
                    "medium",
                )
            )
        if re.search(r"\b(?:pickle\.loads?|yaml\.load)\s*\(", stripped):
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.UNSAFE_DESERIALIZATION",
                    path,
                    [f"unsafe deserialization at line {line_no}"],
                )
            )
    return records


def _content_records(path: str) -> list[ClassificationRecord]:
    candidate = ROOT / path
    if (
        not candidate.is_file()
        or candidate.is_symlink()
        or candidate.suffix.lower() not in CODE_EXTENSIONS
    ):
        return []
    source = candidate.read_text(encoding="utf-8", errors="replace")
    if candidate.suffix.lower() == ".py":
        return _python_security_records(path, source)
    return _generic_security_records(path, source)


def _base_record(path: str) -> ClassificationRecord:
    pure = PurePosixPath(path)
    parts = tuple(part.lower() for part in pure.parts)
    name = pure.name
    lowered_name = name.lower()
    suffix = pure.suffix.lower()

    gauntlet_path = (
        parts[0] == ".codex"
        or parts[0] == "qa"
        or path in {"scripts/gauntlet_handshake.py", "scripts/gauntlet_policy.py"}
        or (parts[0] == "gauntlet" and len(parts) > 1 and parts[1] in {"handshake", "security"})
        or (
            parts[0] == ".agents"
            and "onboard-repository" not in parts
            and "audit-onboarding-proposal" not in parts
        )
    )
    if gauntlet_path:
        return _record(
            "gauntlet-policy",
            "CG.CLASS.GAUNTLET_POLICY_PATH",
            path,
            ["Gauntlet-owned policy, verification, or security path changed"],
        )
    if parts[0] == ".pi":
        return _record(
            "pi",
            "CG.CLASS.PI_ADAPTER",
            path,
            ["Pi auxiliary adapter path changed"],
        )
    if (
        parts[0] == ".harness-core"
        or path in {"scripts/bin/harness", "scripts/bin/harness-cli"}
        or (
            parts[0] == ".agents"
            and any(
                segment in parts
                for segment in ("onboard-repository", "audit-onboarding-proposal")
            )
        )
    ):
        return _record(
            "harness-core",
            "CG.CLASS.HARNESS_MANAGED_PATH",
            path,
            ["Harness-owned path changed"],
        )
    if len(parts) > 1 and parts[:2] == (".harness", "changesets"):
        return _record(
            "harness-state",
            "CG.CLASS.HARNESS_SEMANTIC_STATE",
            path,
            ["replayable Harness semantic changeset changed"],
        )
    if path in {
        "AGENTS.md",
        "SECURITY.md",
        "docs/ARCHITECTURE.md",
        "docs/quality/SECURITY-GATE.md",
        "security/threat-model-sources.json",
        "security/threat-model.md",
    }:
        return _record(
            "threat-model-source",
            "CG.CLASS.THREAT_MODEL_SOURCE",
            path,
            ["meaningful threat-model boundary source changed"],
        )
    if name in DEPENDENCY_FILES:
        return _record(
            "dependency",
            "CG.CLASS.DEPENDENCY_MANIFEST",
            path,
            [f"dependency manifest: {name}"],
        )
    if any(segment in MIGRATION_SEGMENTS for segment in parts):
        return _record(
            "migration-schema",
            "CG.CLASS.MIGRATION_SEGMENT",
            path,
            ["migration or schema boundary path"],
        )
    if any(segment in API_SEGMENTS for segment in parts) or lowered_name.startswith(
        ("openapi.", "schema.")
    ):
        return _record(
            "api-contract",
            "CG.CLASS.API_BOUNDARY",
            path,
            ["API or contract boundary path"],
        )
    if suffix in CODE_EXTENSIONS:
        return _record(
            "pure-logic",
            "CG.CLASS.CODE",
            path,
            [f"supported source extension: {suffix}"],
        )
    if parts[0] == "docs" or suffix == ".md":
        return _record(
            "docs-only",
            "CG.CLASS.DOCUMENTATION",
            path,
            ["documentation-only path"],
        )
    return _record(
        "unknown-mixed",
        "CG.CLASS.UNKNOWN_PATH",
        path,
        ["no precise class rule matched"],
        "low",
    )


def classify_records(paths: list[str]) -> list[ClassificationRecord]:
    if not paths:
        return [
            _record(
                "unknown-mixed",
                "CG.CLASS.NO_DIFF",
                ".",
                ["no concrete changed path was available"],
                "low",
            )
        ]

    records: list[ClassificationRecord] = []
    for raw in paths:
        path = _safe_path(raw)
        pure = PurePosixPath(path)
        parts = tuple(part.lower() for part in pure.parts)
        name = pure.name.lower()
        records.append(_base_record(path))
        if name not in BENIGN_FILENAMES and any(
            segment in SECURITY_SEGMENTS for segment in parts
        ):
            records.append(
                _record(
                    "security-sensitive",
                    "CG.CLASS.SECURITY_BOUNDARY_SEGMENT",
                    path,
                    [
                        "security boundary segment: "
                        + ", ".join(sorted(set(parts) & SECURITY_SEGMENTS))
                    ],
                    "medium",
                )
            )
        records.extend(_content_records(path))

    unique = {
        (item.className, item.ruleId, item.path): item
        for item in records
    }
    result = sorted(
        unique.values(),
        key=lambda item: (item.path, item.className, item.ruleId),
    )
    if any(item.className != "docs-only" for item in result):
        result = [item for item in result if item.className != "docs-only"]
    return result


def classify(paths: list[str]) -> list[str]:
    classes = {record.className for record in classify_records(paths)}
    return sorted(classes)


def records_digest(records: Iterable[ClassificationRecord]) -> str:
    payload = [asdict(item) for item in records]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def classification_payload(paths: list[str]) -> dict:
    records = classify_records(paths)
    return {
        "schemaVersion": 1,
        "classifierVersion": "6.0.0",
        "paths": paths,
        "classes": sorted({item.className for item in records}),
        "records": [asdict(item) for item in records],
        "recordsDigest": records_digest(records),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Precise Codex Gauntlet v6 change classifier"
    )
    parser.add_argument("paths", nargs="*")
    parser.add_argument("--base")
    parser.add_argument("--json", action="store_true")
    ns = parser.parse_args()
    paths = ns.paths or git_paths(ns.base)
    try:
        result = classification_payload(paths)
    except ValueError as exc:
        print(f"FAIL: classifier: {exc}")
        return 2
    print(
        json.dumps(result, indent=2, sort_keys=True)
        if ns.json
        else "\n".join(result["classes"])
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
