from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Iterable

from ..common import git, safe_relative_path
from ..targets import NormalizedTarget

CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java", ".kt", ".rb", ".php"}
PARSED_EXTENSIONS = {".py"}
SKIP_PREFIXES = (
    ".git/", ".qa-artifacts/", "artifacts/", "qa/security/reports/", "qa/security/triage/",
    "qa/fixtures/", "node_modules/", "vendor/", "dist/", "build/",
)

RULE_META = {
    "CG.SEC.DYNAMIC_EXEC": ("Dynamic code execution", "high", "high", "Replace dynamic execution with constrained parsing or explicit dispatch."),
    "CG.SEC.SHELL": ("Shell command injection surface", "high", "high", "Use argv-based subprocess execution with shell disabled."),
    "CG.SEC.DESERIALIZE": ("Unsafe deserialization surface", "high", "high", "Use a non-executable serialization format and validate its schema."),
    "CG.SEC.PATH_WRITE": ("Untrusted path write surface", "high", "medium", "Normalize against an approved root and reject traversal before writing."),
    "CG.SEC.AUTH_BYPASS": ("Authorization bypass surface", "high", "medium", "Enforce authorization before the protected operation and add a focused regression test."),
    "CG.SEC.SECRET": ("Unsafe secret handling", "high", "medium", "Use a secret provider and avoid committing or logging credentials."),
    "CG.SEC.NETWORK": ("Untrusted network boundary", "high", "medium", "Constrain destinations with an allowlist and validate the parsed URL before requests."),
    "CG.SEC.WEAK_HASH": ("Weak cryptographic hash", "low", "medium", "Use a modern collision-resistant primitive when security relevant."),
}


def _candidate(rule_id: str, path: str, line: int, anchor: str, *, evidence: list[str] | None = None) -> dict:
    title, severity, confidence, remediation = RULE_META[rule_id]
    semantic_anchor = re.sub(r"\s+", " ", anchor.strip())[:160]
    root_key = f"{rule_id}:{semantic_anchor}"
    return {
        "ruleId": rule_id,
        "title": title,
        "severity": severity,
        "confidence": confidence,
        "location": {"path": path, "startLine": line, "endLine": line},
        "rootCauseKey": root_key,
        "rootCauseSummary": f"{title}: {semantic_anchor}",
        "evidenceRefs": evidence or [f"source:{path}:{line}"],
        "remediation": remediation,
        "source": "gauntlet-security-discovery-v6",
    }


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        parts = [node.func.attr]
        value = node.func.value
        while isinstance(value, ast.Attribute):
            parts.append(value.attr)
            value = value.value
        if isinstance(value, ast.Name):
            parts.append(value.id)
        return ".".join(reversed(parts))
    return ""


def _enclosing_name(tree: ast.AST, target: ast.AST) -> str:
    # AST nodes do not expose parents; line ranges are enough for a stable semantic anchor.
    line = getattr(target, "lineno", 0)
    best = "module"
    best_span = 10**9
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            start = getattr(node, "lineno", 0)
            end = getattr(node, "end_lineno", start)
            if start <= line <= end and end - start < best_span:
                best = node.name
                best_span = end - start
    return best


def discover_python_source(path: str, source: str) -> list[dict]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    candidates: list[dict] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node)
        line = getattr(node, "lineno", 1)
        scope = _enclosing_name(tree, node)
        if name in {"eval", "exec", "builtins.eval", "builtins.exec"}:
            candidates.append(_candidate("CG.SEC.DYNAMIC_EXEC", path, line, f"{scope}:{name}"))
        if name in {"os.system", "subprocess.getoutput", "subprocess.getstatusoutput"}:
            candidates.append(_candidate("CG.SEC.SHELL", path, line, f"{scope}:{name}"))
        if name.startswith("subprocess."):
            for keyword in node.keywords:
                if keyword.arg == "shell" and isinstance(keyword.value, ast.Constant) and keyword.value.value is True:
                    candidates.append(_candidate("CG.SEC.SHELL", path, line, f"{scope}:{name}:shell=true"))
        if name in {"pickle.load", "pickle.loads", "marshal.load", "marshal.loads", "yaml.load"}:
            if name == "yaml.load" and any(keyword.arg == "Loader" and isinstance(keyword.value, ast.Attribute) and keyword.value.attr == "SafeLoader" for keyword in node.keywords):
                continue
            candidates.append(_candidate("CG.SEC.DESERIALIZE", path, line, f"{scope}:{name}"))
        if name in {"open", "io.open"}:
            mode = ""
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                mode = str(node.args[1].value)
            for keyword in node.keywords:
                if keyword.arg == "mode" and isinstance(keyword.value, ast.Constant):
                    mode = str(keyword.value.value)
            first = node.args[0] if node.args else None
            dynamic = first is not None and not isinstance(first, ast.Constant)
            if dynamic and any(flag in mode for flag in "wax+"):
                candidates.append(_candidate("CG.SEC.PATH_WRITE", path, line, f"{scope}:dynamic-open-write"))
        if name in {"hashlib.md5", "hashlib.sha1"}:
            candidates.append(_candidate("CG.SEC.WEAK_HASH", path, line, f"{scope}:{name}"))
        if name in {"requests.get", "requests.post", "requests.put", "requests.delete", "httpx.get", "httpx.post"}:
            first = node.args[0] if node.args else None
            if first is not None and not isinstance(first, ast.Constant):
                candidates.append(_candidate("CG.SEC.NETWORK", path, line, f"{scope}:{name}:dynamic-url"))


    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            value = node.value
            names = [target.id.lower() for target in targets if isinstance(target, ast.Name)]
            if any(re.search(r"(?:password|secret|api_key|token)$", name) for name in names) and isinstance(value, ast.Constant) and isinstance(value.value, str):
                literal = value.value.strip().lower()
                if literal and not any(marker in literal for marker in ("example", "placeholder", "changeme", "test", "dummy")):
                    candidates.append(_candidate("CG.SEC.SECRET", path, getattr(node, "lineno", 1), f"hardcoded-secret:{','.join(names)}"))

    # Detect explicit authorization bypass markers only in executable AST, not comments/strings.
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and isinstance(node.test, ast.Constant) and node.test.value is True:
            body_names = {_call_name(item) for child in node.body for item in ast.walk(child) if isinstance(item, ast.Call)}
            if any(name.endswith(("delete_user", "admin_action", "transfer_funds")) for name in body_names):
                candidates.append(_candidate("CG.SEC.AUTH_BYPASS", path, getattr(node, "lineno", 1), f"unconditional-protected-action:{sorted(body_names)}"))
    return candidates


def discover_generic_source(path: str, source: str) -> list[dict]:
    candidates: list[dict] = []
    for line_no, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "//", "/*", "*", "<!--")):
            continue
        # Avoid string-literal-only mentions by requiring a call-like token before a quote terminator.
        if re.search(r"(^|[=;({]\s*)eval\s*\(", stripped) and not re.search(r"['\"]\s*eval\s*\(", stripped):
            candidates.append(_candidate("CG.SEC.DYNAMIC_EXEC", path, line_no, "generic:eval-call"))
        if re.search(r"\b(?:child_process\.)?exec\s*\(", stripped) and not re.search(r"\w+\.exec\s*\(", stripped):
            candidates.append(_candidate("CG.SEC.SHELL", path, line_no, "generic:shell-exec"))
        if re.search(r"\b(?:pickle\.loads?|yaml\.load)\s*\(", stripped):
            candidates.append(_candidate("CG.SEC.DESERIALIZE", path, line_no, "generic:unsafe-deserialization"))
    return candidates


def discover_source(path: str, source: str) -> tuple[list[dict], str]:
    extension = Path(path).suffix.lower()
    if extension == ".py":
        try:
            ast.parse(source)
        except SyntaxError:
            return discover_generic_source(path, source), "fallback"
        return discover_python_source(path, source), "parsed"
    if extension in CODE_EXTENSIONS:
        return discover_generic_source(path, source), "fallback"
    return [], "unsupported"


def _target_values(repo: Path, target: NormalizedTarget) -> list[str]:
    if target.kind in {"paths", "diff", "working_tree"}:
        return list(target.paths)
    try:
        tracked = git(repo, "ls-files").splitlines()
        untracked = git(
            repo,
            "ls-files",
            "--others",
            "--exclude-standard",
        ).splitlines()
    except ValueError:
        return [
            path.relative_to(repo).as_posix()
            for path in repo.rglob("*")
            if path.is_file()
        ]
    return sorted({path for path in (*tracked, *untracked) if path})


def _target_files(repo: Path, target: NormalizedTarget) -> tuple[list[str], list[str], int]:
    files: list[str] = []
    unsupported: list[str] = []
    skipped = 0
    for rel in _target_values(repo, target):
        try:
            normalized = safe_relative_path(repo, rel, require_exists=False)
        except ValueError:
            continue
        path = repo / normalized
        if normalized.startswith(SKIP_PREFIXES) or not path.is_file() or path.is_symlink():
            skipped += 1
            continue
        if path.suffix.lower() not in CODE_EXTENSIONS:
            unsupported.append(normalized)
            continue
        files.append(normalized)
    return sorted(set(files)), sorted(set(unsupported)), skipped


def discover_candidates(repo_root: str | Path, target: NormalizedTarget, threat_model: dict, kb_text: str = "") -> tuple[list[dict], dict]:
    repo = Path(repo_root).resolve()
    files, unsupported, skipped = _target_files(repo, target)
    candidates: list[dict] = []
    parsed = 0
    fallback = 0
    for rel in files:
        text = (repo / rel).read_text(encoding="utf-8", errors="replace")
        found, mode = discover_source(rel, text)
        candidates.extend(found)
        parsed += int(mode == "parsed")
        fallback += int(mode == "fallback")
    unique: dict[tuple[str, str, int], dict] = {}
    for item in candidates:
        location = item["location"]
        unique[(item["ruleId"], item["rootCauseKey"], location["startLine"])] = item
    candidates = sorted(unique.values(), key=lambda item: (item["location"]["path"], item["location"]["startLine"], item["ruleId"]))
    values = _target_values(repo, target)
    coverage = {
        "filesConsidered": len(values),
        "filesScanned": len(files),
        "filesParsed": parsed,
        "filesFallbackScanned": fallback,
        "unsupportedFiles": unsupported,
        "unsupportedLanguageCount": len(unsupported),
        "skippedGeneratedVendor": skipped,
        "untestedAttackSurfaces": [f"unsupported:{path}" for path in unsupported],
    }
    return candidates, coverage
