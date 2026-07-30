from __future__ import annotations

import json
import re
import shlex
import tomllib
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from urllib.parse import urlparse

from ..common import git
from ..targets import NormalizedTarget
from .rules import candidate, normalize_candidates


REQUIRED_CODEX_CONFIG = (".codex/config.toml", ".codex/hooks.json")
OPTIONAL_MCP_CONFIG = (".codex/mcp.json", ".mcp.json", "mcp.json")
SKILL_PATH_RE = re.compile(
    r"^\.agents/skills/([^/]+)/(SKILL\.md|agents/openai\.yaml)$"
)
SAFE_SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
SECRET_KEY = re.compile(
    r"(?:api[_-]?key|authorization|client[_-]?secret|cookie|password|private[_-]?key|secret|token)$",
    re.I,
)
SECRET_PATTERNS = (
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)
SECRET_ARGUMENT = re.compile(
    r"(?:--?(?:api[-_]?key|password|secret|token)|\b(?:API[_-]?KEY|PASSWORD|SECRET|TOKEN)\b)"
    r"(?:\s*[:=]\s*|\s+)(?P<value>\"[^\"]+\"|'[^']+'|[^\s,;]+)",
    re.I,
)
PLACEHOLDER_MARKERS = (
    "changeme",
    "dummy",
    "example",
    "fake",
    "placeholder",
    "redacted",
    "replace-me",
    "test-only",
)
AUDIT_IMPLEMENTATION_PREFIXES = (
    "gauntlet/security/config_audit/",
    "gauntlet/security/run.py",
    "qa/security/gates.py",
    "qa/policy_audit.py",
    "security/threat-model-sources.json",
    "docs/quality/SECURITY-GATE.md",
)
WINDOWS_INTERPRETERS = {"python", "python.exe"}
REQUIRED_MUTATION_TOOLS = {"Bash", "apply_patch", "Edit", "Write"}
MAX_CONFIG_BYTES = 256 * 1024
MAX_SKILL_BYTES = 16 * 1024
MAX_SKILL_LINES = 400


class DuplicateKeyError(ValueError):
    pass


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(key)
        result[key] = value
    return result


def _visible_paths(repo: Path) -> list[str]:
    try:
        git(repo, "rev-parse", "--show-toplevel")
        values = git(repo, "ls-files").splitlines()
        values.extend(
            git(
                repo,
                "ls-files",
                "--others",
                "--exclude-standard",
                check=False,
            ).splitlines()
        )
    except ValueError:
        values = [
            path.relative_to(repo).as_posix()
            for path in repo.rglob("*")
            if path.is_file() or path.is_symlink()
        ]
    normalized: set[str] = set()
    for value in values:
        if not value or value.startswith((".git/", ".qa-artifacts/")):
            continue
        lexical = value.replace("\\", "/")
        while lexical.startswith("./"):
            lexical = lexical[2:]
        candidate_path = PurePosixPath(lexical)
        if candidate_path.is_absolute() or not candidate_path.parts or ".." in candidate_path.parts:
            continue
        normalized.add(candidate_path.as_posix())
    return sorted(normalized)


def _is_auditable(path: str) -> bool:
    return path in REQUIRED_CODEX_CONFIG + OPTIONAL_MCP_CONFIG or bool(
        SKILL_PATH_RE.fullmatch(path)
    )


def _selected_paths(
    visible: list[str], target: NormalizedTarget
) -> tuple[list[str], str, list[str]]:
    inventory = sorted(path for path in visible if _is_auditable(path))
    target_paths = set(target.paths)
    trigger_all = target.kind == "repository" or any(
        path == prefix or path.startswith(prefix)
        for path in target_paths
        for prefix in AUDIT_IMPLEMENTATION_PREFIXES
    )
    if trigger_all:
        selected = set(inventory) | set(REQUIRED_CODEX_CONFIG)
        scope = "repository" if target.kind == "repository" else "full-baseline"
    else:
        selected = {path for path in target_paths if _is_auditable(path)}
        changed_skills = {
            match.group(1)
            for path in selected
            if (match := SKILL_PATH_RE.fullmatch(path))
        }
        if changed_skills:
            selected.update(path for path in inventory if SKILL_PATH_RE.fullmatch(path))
        scope = "targeted" if selected else "not-applicable"
    triggers = sorted(
        path
        for path in target_paths
        if any(path == prefix or path.startswith(prefix) for prefix in AUDIT_IMPLEMENTATION_PREFIXES)
    )
    return sorted(selected), scope, triggers


def _line_for(text: str, key: str) -> int:
    pattern = re.compile(rf"(?im)^\s*[\"']?{re.escape(key)}[\"']?\s*[:=]")
    match = pattern.search(text)
    return text.count("\n", 0, match.start()) + 1 if match else 1


def _literal_secret(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    stripped = value.strip()
    lowered = stripped.lower()
    if not stripped or stripped.startswith(("$", "env:", "secret:")):
        return False
    if (stripped.startswith("<") and stripped.endswith(">")) or any(
        marker in lowered for marker in PLACEHOLDER_MARKERS
    ):
        return False
    return True


def _walk_secret_values(
    value: Any,
    *,
    path: str,
    text: str,
    prefix: tuple[str, ...] = (),
) -> list[dict]:
    findings: list[dict] = []
    if isinstance(value, dict):
        for key in sorted(value):
            child = value[key]
            key_path = (*prefix, str(key))
            if SECRET_KEY.search(str(key)) and _literal_secret(child):
                findings.append(
                    candidate(
                        "CG.AGENT.SECRET_LITERAL",
                        path,
                        _line_for(text, str(key)),
                        "key-" + ".".join(key_path),
                    )
                )
            findings.extend(
                _walk_secret_values(
                    child,
                    path=path,
                    text=text,
                    prefix=key_path,
                )
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            findings.extend(
                _walk_secret_values(
                    child,
                    path=path,
                    text=text,
                    prefix=(*prefix, str(index)),
                )
            )
    return findings


def _secret_pattern_candidates(path: str, text: str) -> list[dict]:
    findings: list[dict] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if any(pattern.search(line) for pattern in SECRET_PATTERNS):
            findings.append(
                candidate(
                    "CG.AGENT.SECRET_LITERAL",
                    path,
                    line_no,
                    "recognized-secret-pattern",
                )
            )
        for match in SECRET_ARGUMENT.finditer(line):
            value = match.group("value").strip("\"'")
            if _literal_secret(value):
                findings.append(
                    candidate(
                        "CG.AGENT.SECRET_LITERAL",
                        path,
                        line_no,
                        "literal-secret-argument",
                    )
                )
    return findings


def _command_line(text: str, command: str) -> int:
    offset = text.find(command)
    return text.count("\n", 0, offset) + 1 if offset >= 0 else 1


def _regular_repo_file(repo: Path, candidate_path: Path) -> bool:
    if candidate_path.is_symlink():
        return False
    try:
        resolved = candidate_path.resolve()
        resolved.relative_to(repo)
    except (OSError, RuntimeError, ValueError):
        return False
    return candidate_path.is_file()


def _hook_command_candidates(
    repo: Path, path: str, text: str, command: str
) -> list[dict]:
    line = _command_line(text, command)
    findings: list[dict] = []
    scrubbed = command
    if (
        not command.strip()
        or len(command) > 4096
        or "\x00" in command
        or "\n" in command
        or "$(" in scrubbed
        or "`" in scrubbed
        or re.search(r"(?:&&|\|\||[;|<>])", scrubbed)
        or re.search(r"\b(?:curl|wget|npx|bunx|npm|pnpm|yarn)\b", scrubbed)
        or re.search(r"https?://", scrubbed, re.I)
    ):
        findings.append(
            candidate(
                "CG.AGENT.HOOK_UNSAFE_EXEC",
                path,
                line,
                "shell-or-remote-execution",
            )
        )
        return findings

    try:
        argv = shlex.split(command)
    except ValueError:
        return [
            candidate(
                "CG.AGENT.HOOK_UNSAFE_EXEC",
                path,
                line,
                "unparseable-command",
            )
        ]
    if not argv:
        return [
            candidate(
                "CG.AGENT.HOOK_UNSAFE_EXEC",
                path,
                line,
                "empty-command",
            )
        ]

    executable = Path(argv[0])
    if executable.name.lower() not in WINDOWS_INTERPRETERS:
        findings.append(
            candidate(
                "CG.AGENT.HOOK_PATH_ESCAPE",
                path,
                line,
                "unpinned-interpreter",
            )
        )
    if any(item in {"-c", "-e", "-m"} for item in argv[1:]):
        findings.append(
            candidate(
                "CG.AGENT.HOOK_UNSAFE_EXEC",
                path,
                line,
                "interpreter-evaluation-flag",
            )
        )

    repository_path_seen = False
    for token in argv[1:]:
        path_token = token.split("=", 1)[1] if token.startswith("-") and "=" in token else token
        if path_token.startswith("-") or not ({"/", "\\"} & set(path_token)):
            continue
        token_path = Path(path_token)
        candidate_path = token_path if token_path.is_absolute() else repo / token_path
        if not _regular_repo_file(repo, candidate_path):
            findings.append(
                candidate(
                    "CG.AGENT.HOOK_PATH_ESCAPE",
                    path,
                    line,
                    "script-missing-escaping-or-symlink",
                )
            )
        else:
            repository_path_seen = True
    if not repository_path_seen:
        findings.append(
            candidate(
                "CG.AGENT.HOOK_PATH_ESCAPE",
                path,
                line,
                "repository-script-missing",
            )
        )
    return findings


def _mcp_server_candidates(
    repo: Path,
    path: str,
    text: str,
    name: str,
    server: Any,
) -> list[dict]:
    if not isinstance(server, dict):
        return [
            candidate(
                "CG.AGENT.CONFIG_MALFORMED",
                path,
                _line_for(text, name),
                f"mcp-{name}-not-object",
            )
        ]
    findings = _walk_secret_values(server, path=path, text=text, prefix=("mcp", name))
    url = server.get("url")
    if url is not None:
        if not isinstance(url, str) or not url.strip():
            findings.append(
                candidate(
                    "CG.AGENT.CONFIG_MALFORMED",
                    path,
                    _line_for(text, "url"),
                    f"mcp-{name}-invalid-url",
                )
            )
        else:
            parsed = urlparse(url)
            local_hosts = {"", "127.0.0.1", "::1", "localhost"}
            if parsed.scheme not in {"unix", "stdio"} and parsed.hostname not in local_hosts:
                findings.append(
                    candidate(
                        "CG.AGENT.MCP_REMOTE",
                        path,
                        _line_for(text, "url"),
                        f"mcp-{name}-remote-endpoint",
                    )
                )
    command = server.get("command")
    args = server.get("args", [])
    if not isinstance(args, list) or any(not isinstance(item, str) for item in args):
        findings.append(
            candidate(
                "CG.AGENT.CONFIG_MALFORMED",
                path,
                _line_for(text, "args"),
                f"mcp-{name}-invalid-args",
            )
        )
        args = []
    if command is not None:
        if not isinstance(command, str) or not command.strip():
            findings.append(
                candidate(
                    "CG.AGENT.CONFIG_MALFORMED",
                    path,
                    _line_for(text, "command"),
                    f"mcp-{name}-invalid-command",
                )
            )
        else:
            try:
                argv = shlex.split(command)
            except ValueError:
                argv = []
            executable = Path(argv[0]) if argv else Path("")
            repo_executable = (
                executable.is_absolute()
                and executable.is_relative_to(repo)
                and executable.is_file()
                and not executable.is_symlink()
            )
            windows_interpreter = executable.name.lower() in WINDOWS_INTERPRETERS
            path_arguments_safe = True
            repository_path_seen = False
            for token in [*argv[1:], *args]:
                path_token = token.split("=", 1)[1] if token.startswith("-") and "=" in token else token
                if path_token.startswith("-") or not ({"/", "\\"} & set(path_token)) or "://" in path_token:
                    continue
                token_path = Path(path_token)
                candidate_path = token_path if token_path.is_absolute() else repo / token_path
                if not _regular_repo_file(repo, candidate_path):
                    path_arguments_safe = False
                    break
                repository_path_seen = True
            interpreter_needs_script = windows_interpreter
            unsafe = (
                not argv
                or not (repo_executable or windows_interpreter)
                or not path_arguments_safe
                or (interpreter_needs_script and not repository_path_seen)
                or any(item in {"-c", "-e", "-m"} for item in [*argv[1:], *args])
                or re.search(r"\b(?:npx|bunx|npm|pnpm|yarn|curl|wget)\b", command)
                or re.search(r"https?://|(?:&&|\|\||[;|<>]|\$\(|`)", command)
                or any(re.search(r"https?://|(?:&&|\|\||[;|<>]|\$\(|`)", item) for item in args)
            )
            if unsafe:
                findings.append(
                    candidate(
                        "CG.AGENT.MCP_UNPINNED",
                        path,
                        _line_for(text, "command"),
                        f"mcp-{name}-unsafe-command",
                    )
                )
    if url is None and command is None:
        findings.append(
            candidate(
                "CG.AGENT.CONFIG_MALFORMED",
                path,
                _line_for(text, name),
                f"mcp-{name}-missing-transport",
            )
        )
    return findings


def _audit_codex_toml(repo: Path, path: str, text: str) -> tuple[list[dict], bool]:
    try:
        payload = tomllib.loads(text)
    except (tomllib.TOMLDecodeError, ValueError):
        return [candidate("CG.AGENT.CONFIG_MALFORMED", path, 1, "invalid-toml")], True
    findings = _walk_secret_values(payload, path=path, text=text)
    sandbox_mode = payload.get("sandbox_mode")
    approval_policy = payload.get("approval_policy")
    workspace = payload.get("sandbox_workspace_write")
    network_setting = workspace.get("network_access") if isinstance(workspace, dict) else None
    baseline = {
        "sandbox_mode": isinstance(sandbox_mode, str)
        and sandbox_mode in {"read-only", "workspace-write"},
        "approval_policy": isinstance(approval_policy, str)
        and approval_policy in {"on-request", "untrusted"},
        "network_access": network_setting is False
        if sandbox_mode == "workspace-write"
        else sandbox_mode == "read-only"
        and (network_setting is None or network_setting is False),
        "hooks": payload.get("features", {}).get("hooks") is True
        if isinstance(payload.get("features"), dict)
        else False,
    }
    for key, valid in baseline.items():
        if not valid:
            findings.append(
                candidate(
                    "CG.AGENT.POLICY_WEAKENING",
                    path,
                    _line_for(text, key),
                    f"baseline-{key}",
                )
            )
    compact_prompt = payload.get("experimental_compact_prompt_file")
    if compact_prompt is not None:
        valid_prompt = isinstance(compact_prompt, str) and bool(compact_prompt.strip())
        if valid_prompt:
            raw_prompt = Path(compact_prompt)
            candidate_prompt = raw_prompt if raw_prompt.is_absolute() else repo / ".codex" / raw_prompt
            valid_prompt = _regular_repo_file(repo, candidate_prompt)
        if not valid_prompt:
            findings.append(
                candidate(
                    "CG.AGENT.CONFIG_PATH_ESCAPE",
                    path,
                    _line_for(text, "experimental_compact_prompt_file"),
                    "compact-prompt-path",
                )
            )
    servers = payload.get("mcp_servers", {})
    if servers is not None and not isinstance(servers, dict):
        findings.append(
            candidate("CG.AGENT.CONFIG_MALFORMED", path, 1, "mcp-servers-not-object")
        )
    elif isinstance(servers, dict):
        for name in sorted(servers):
            findings.extend(
                _mcp_server_candidates(repo, path, text, str(name), servers[name])
            )
    return findings, False


def _load_json(path: str, text: str) -> tuple[dict[str, Any] | None, list[dict]]:
    try:
        payload = json.loads(text, object_pairs_hook=_object_without_duplicates)
    except (json.JSONDecodeError, DuplicateKeyError, ValueError):
        return None, [candidate("CG.AGENT.CONFIG_MALFORMED", path, 1, "invalid-json")]
    if not isinstance(payload, dict):
        return None, [candidate("CG.AGENT.CONFIG_MALFORMED", path, 1, "json-root-not-object")]
    return payload, []


def _matcher_tokens(value: Any) -> set[str]:
    if not isinstance(value, str):
        return set()
    tokens = value.split("|")
    if any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", token) for token in tokens):
        return set()
    return set(tokens)


def _audit_hooks_json(repo: Path, path: str, text: str) -> tuple[list[dict], bool]:
    payload, findings = _load_json(path, text)
    if payload is None:
        return findings, True
    findings.extend(_walk_secret_values(payload, path=path, text=text))
    hooks = payload.get("hooks")
    if not isinstance(hooks, dict):
        findings.append(candidate("CG.AGENT.CONFIG_MALFORMED", path, 1, "hooks-not-object"))
        return findings, True

    for required in ("PreToolUse", "PermissionRequest", "Stop"):
        if required not in hooks:
            findings.append(
                candidate(
                    "CG.AGENT.HOOK_COVERAGE",
                    path,
                    1,
                    f"missing-{required}",
                )
            )

    for event in sorted(hooks):
        groups = hooks[event]
        if not isinstance(groups, list) or not groups:
            findings.append(
                candidate(
                    "CG.AGENT.CONFIG_MALFORMED",
                    path,
                    _line_for(text, event),
                    f"event-{event}-not-list",
                )
            )
            continue
        covered_tools: set[str] = set()
        for group in groups:
            if not isinstance(group, dict):
                findings.append(
                    candidate(
                        "CG.AGENT.CONFIG_MALFORMED",
                        path,
                        _line_for(text, event),
                        f"event-{event}-group-not-object",
                    )
                )
                continue
            matcher = group.get("matcher")
            if matcher is not None:
                tokens = _matcher_tokens(matcher)
                if not tokens:
                    findings.append(
                        candidate(
                            "CG.AGENT.HOOK_COVERAGE",
                            path,
                            _line_for(text, "matcher"),
                            f"event-{event}-ambiguous-matcher",
                        )
                    )
                covered_tools.update(tokens)
            handlers = group.get("hooks")
            if not isinstance(handlers, list) or not handlers:
                findings.append(
                    candidate(
                        "CG.AGENT.CONFIG_MALFORMED",
                        path,
                        _line_for(text, event),
                        f"event-{event}-handlers-not-list",
                    )
                )
                continue
            for handler in handlers:
                if not isinstance(handler, dict) or handler.get("type") != "command":
                    findings.append(
                        candidate(
                            "CG.AGENT.CONFIG_MALFORMED",
                            path,
                            _line_for(text, "type"),
                            f"event-{event}-handler-shape",
                        )
                    )
                    continue
                for field in ("command", "commandWindows"):
                    command = handler.get(field)
                    if not isinstance(command, str):
                        findings.append(
                            candidate(
                                "CG.AGENT.CONFIG_MALFORMED",
                                path,
                                _line_for(text, field),
                                f"event-{event}-{field}-not-string",
                            )
                        )
                    else:
                        findings.extend(_hook_command_candidates(repo, path, text, command))
                timeout = handler.get("timeout")
                if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 900:
                    findings.append(
                        candidate(
                            "CG.AGENT.CONFIG_MALFORMED",
                            path,
                            _line_for(text, "timeout"),
                            f"event-{event}-invalid-timeout",
                        )
                    )
                status_message = handler.get("statusMessage")
                if not isinstance(status_message, str) or not status_message.strip() or len(status_message) > 160:
                    findings.append(
                        candidate(
                            "CG.AGENT.CONFIG_MALFORMED",
                            path,
                            _line_for(text, "statusMessage"),
                            f"event-{event}-invalid-status-message",
                        )
                    )
        if event in {"PreToolUse", "PermissionRequest"} and not REQUIRED_MUTATION_TOOLS <= covered_tools:
            findings.append(
                candidate(
                    "CG.AGENT.HOOK_COVERAGE",
                    path,
                    _line_for(text, event),
                    f"event-{event}-missing-mutation-tools",
                )
            )
    return findings, False


def _audit_mcp_json(repo: Path, path: str, text: str) -> tuple[list[dict], bool]:
    payload, findings = _load_json(path, text)
    if payload is None:
        return findings, True
    findings.extend(_walk_secret_values(payload, path=path, text=text))
    servers = payload.get("mcpServers", payload.get("servers"))
    if not isinstance(servers, dict):
        findings.append(candidate("CG.AGENT.CONFIG_MALFORMED", path, 1, "mcp-servers-not-object"))
        return findings, True
    for name in sorted(servers):
        findings.extend(_mcp_server_candidates(repo, path, text, str(name), servers[name]))
    return findings, False


def _frontmatter(path: str, text: str) -> tuple[dict[str, str] | None, int]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, 1
    try:
        end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        return None, 1
    fields: dict[str, str] = {}
    for index, line in enumerate(lines[1:end], 2):
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*", line)
        if not match or match.group(1) in fields:
            return None, index
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
            value = value[1:-1]
        fields[match.group(1)] = value
    return fields, end + 1


def _openai_metadata(path: str, text: str) -> tuple[dict[str, Any] | None, int]:
    fields: dict[str, Any] = {}
    section: str | None = None
    for index, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        top = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*):\s*", line)
        if top:
            section = top.group(1)
            continue
        child = re.fullmatch(r"  ([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*", line)
        if not child or section is None:
            return None, index
        raw = child.group(2).strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"\"", "'"}:
            value: Any = raw[1:-1]
        elif raw in {"true", "false"}:
            value = raw == "true"
        else:
            value = raw
        key = f"{section}.{child.group(1)}"
        if key in fields:
            return None, index
        fields[key] = value
    return fields, 1


def _description_tokens(value: str) -> set[str]:
    stop = {
        "a",
        "an",
        "and",
        "for",
        "of",
        "repository",
        "the",
        "to",
        "with",
    }
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) > 1 and token not in stop
    }


def _unsafe_skill_lines(text: str) -> Iterable[int]:
    patterns = (
        r"--dangerously-bypass-(?:approvals-and-sandbox|hook-trust)",
        r"approval_policy\s*=\s*[\"']?never",
        r"sandbox_mode\s*=\s*[\"']?danger-full-access",
        r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b",
        r"\b(?:npx|bunx)\b",
        r"\b(?:sudo|su\s+-c)\b",
        r"\bchmod\s+777\b",
        r"ignore\s+(?:all\s+)?previous\s+instructions",
    )
    negation = re.compile(r"\b(?:do not|must not|never|prohibit(?:ed)?|without|không)\b", re.I)
    in_fence = False
    fence_negated = False
    recent_nonempty: list[str] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            if not in_fence:
                fence_negated = any(
                    negation.search(value) for value in recent_nonempty[-3:]
                )
            in_fence = not in_fence
        previous_negated_block = bool(
            recent_nonempty
            and recent_nonempty[-1].strip().endswith(":")
            and negation.search(recent_nonempty[-1])
        )
        contextual_negation = (
            bool(negation.search(line))
            or previous_negated_block
            or (in_fence and fence_negated)
        )
        if not contextual_negation and any(re.search(pattern, line, re.I) for pattern in patterns):
            yield line_no
        if stripped:
            recent_nonempty.append(line)


def _markdown_reference_candidates(repo: Path, path: str, text: str) -> list[dict]:
    findings: list[dict] = []
    base = (repo / path).parent
    for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", text):
        raw = match.group(1).strip().split(maxsplit=1)[0].strip("<>\"'")
        if not raw or raw.startswith(("#", "http://", "https://", "mailto:")):
            continue
        line = text.count("\n", 0, match.start()) + 1
        reference = Path(raw)
        candidate_reference = reference if reference.is_absolute() else base / reference
        if not _regular_repo_file(repo, candidate_reference):
            findings.append(
                candidate(
                    "CG.AGENT.SKILL_REFERENCE",
                    path,
                    line,
                    "reference-missing-escaping-or-symlink",
                )
            )
    return findings


def _audit_skills(
    repo: Path,
    selected: list[str],
    contents: dict[str, str],
) -> tuple[list[dict], set[str], list[str]]:
    findings: list[dict] = []
    malformed: set[str] = set()
    skill_names = sorted(
        {
            match.group(1)
            for path in selected
            if (match := SKILL_PATH_RE.fullmatch(path))
        }
    )
    records: list[tuple[str, str, str, set[str], bool]] = []
    for directory in skill_names:
        skill_path = f".agents/skills/{directory}/SKILL.md"
        metadata_path = f".agents/skills/{directory}/agents/openai.yaml"
        skill_text = contents.get(skill_path)
        metadata_text = contents.get(metadata_path)
        if skill_text is None:
            findings.append(candidate("CG.AGENT.SKILL_METADATA", skill_path, 1, f"skill-{directory}-missing-entrypoint"))
            malformed.add(skill_path)
            continue
        if len(skill_text.encode("utf-8")) > MAX_SKILL_BYTES or len(skill_text.splitlines()) > MAX_SKILL_LINES:
            findings.append(candidate("CG.AGENT.SKILL_OVERSIZED", skill_path, 1, f"skill-{directory}-entrypoint-budget"))

        frontmatter, frontmatter_line = _frontmatter(skill_path, skill_text)
        if frontmatter is None:
            findings.append(candidate("CG.AGENT.SKILL_METADATA", skill_path, frontmatter_line, f"skill-{directory}-frontmatter"))
            malformed.add(skill_path)
            name = directory
            description = ""
        else:
            name = frontmatter.get("name", "")
            description = frontmatter.get("description", "")
            if name != directory or not SAFE_SKILL_NAME.fullmatch(name):
                findings.append(candidate("CG.AGENT.SKILL_METADATA", skill_path, _line_for(skill_text, "name"), f"skill-{directory}-name-mismatch"))
            if not 8 <= len(description) <= 240:
                findings.append(candidate("CG.AGENT.SKILL_METADATA", skill_path, _line_for(skill_text, "description"), f"skill-{directory}-description"))
            if not re.search(r"(?m)^#\s+\S", skill_text):
                findings.append(candidate("CG.AGENT.SKILL_METADATA", skill_path, frontmatter_line, f"skill-{directory}-missing-heading"))

        implicit = False
        if metadata_text is None:
            findings.append(candidate("CG.AGENT.SKILL_METADATA", metadata_path, 1, f"skill-{directory}-missing-openai-metadata"))
            malformed.add(metadata_path)
        else:
            metadata, metadata_line = _openai_metadata(metadata_path, metadata_text)
            if metadata is None:
                findings.append(candidate("CG.AGENT.SKILL_METADATA", metadata_path, metadata_line, f"skill-{directory}-openai-metadata"))
                malformed.add(metadata_path)
            else:
                required = {
                    "interface.display_name": str,
                    "interface.short_description": str,
                    "policy.allow_implicit_invocation": bool,
                }
                if any(not isinstance(metadata.get(key), kind) for key, kind in required.items()):
                    findings.append(candidate("CG.AGENT.SKILL_METADATA", metadata_path, 1, f"skill-{directory}-openai-required-fields"))
                implicit = metadata.get("policy.allow_implicit_invocation") is True
                if implicit and re.search(r"run only when (?:the user )?explicitly", skill_text, re.I):
                    findings.append(candidate("CG.AGENT.SKILL_METADATA", metadata_path, _line_for(metadata_text, "allow_implicit_invocation"), f"skill-{directory}-invocation-conflict"))

        findings.extend(_markdown_reference_candidates(repo, skill_path, skill_text))
        for line in _unsafe_skill_lines(skill_text):
            findings.append(candidate("CG.AGENT.SKILL_UNSAFE_INSTRUCTION", skill_path, line, f"skill-{directory}-unsafe-instruction"))
        findings.extend(_secret_pattern_candidates(skill_path, skill_text))
        records.append((directory, name, description, _description_tokens(description), implicit))

    for index, left in enumerate(records):
        for right in records[index + 1 :]:
            left_dir, left_name, left_description, left_tokens, _ = left
            right_dir, right_name, right_description, right_tokens, _ = right
            duplicate_name = bool(left_name and left_name == right_name)
            union = left_tokens | right_tokens
            similarity = len(left_tokens & right_tokens) / len(union) if union else 0.0
            duplicate_purpose = (
                bool(left_description and right_description)
                and (
                    left_description.strip().casefold() == right_description.strip().casefold()
                    or (len(left_tokens) >= 3 and len(right_tokens) >= 3 and similarity >= 0.8)
                )
            )
            if duplicate_name or duplicate_purpose:
                path = f".agents/skills/{right_dir}/SKILL.md"
                findings.append(candidate("CG.AGENT.SKILL_DUPLICATE", path, 1, f"skills-{left_dir}+{right_dir}"))
    return findings, malformed, skill_names


def audit_agent_configuration(
    repo_root: str | Path,
    target: NormalizedTarget,
) -> tuple[list[dict], dict]:
    """Audit only Git-visible repository configuration; never mutate or leave the repo."""

    repo = Path(repo_root).resolve()
    visible = _visible_paths(repo)
    selected, scope, triggers = _selected_paths(visible, target)
    findings: list[dict] = []
    contents: dict[str, str] = {}
    malformed: set[str] = set()
    skipped_symlinks: list[str] = []
    files_audited = 0
    config_files = 0
    skill_files = 0

    for rel in selected:
        path = repo / rel
        if path.is_symlink():
            skipped_symlinks.append(rel)
            findings.append(candidate("CG.AGENT.CONFIG_SYMLINK", rel, 1, f"symlink-{rel}"))
            continue
        if not path.is_file():
            if rel in REQUIRED_CODEX_CONFIG:
                findings.append(candidate("CG.AGENT.CONFIG_MALFORMED", rel, 1, f"missing-{rel}"))
                malformed.add(rel)
            continue
        if path.stat().st_size > MAX_CONFIG_BYTES:
            findings.append(candidate("CG.AGENT.CONFIG_MALFORMED", rel, 1, f"oversized-{rel}"))
            malformed.add(rel)
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="strict")
        except (OSError, UnicodeError):
            findings.append(candidate("CG.AGENT.CONFIG_MALFORMED", rel, 1, f"unreadable-{rel}"))
            malformed.add(rel)
            continue
        contents[rel] = text
        files_audited += 1
        if SKILL_PATH_RE.fullmatch(rel):
            skill_files += 1
            continue
        config_files += 1
        findings.extend(_secret_pattern_candidates(rel, text))
        if rel == ".codex/config.toml":
            found, invalid = _audit_codex_toml(repo, rel, text)
        elif rel == ".codex/hooks.json":
            found, invalid = _audit_hooks_json(repo, rel, text)
        else:
            found, invalid = _audit_mcp_json(repo, rel, text)
        findings.extend(found)
        if invalid:
            malformed.add(rel)

    skill_findings, skill_malformed, skills = _audit_skills(repo, selected, contents)
    findings.extend(skill_findings)
    malformed.update(skill_malformed)
    findings = normalize_candidates(findings)
    coverage = {
        "schemaVersion": "1",
        "status": "complete",
        "scope": scope,
        "triggeredBy": triggers,
        "filesConsidered": len(selected),
        "filesAudited": files_audited,
        "configFilesAudited": config_files,
        "skillFilesAudited": skill_files,
        "skillsAudited": len(skills),
        "candidateCount": len(findings),
        "ruleIds": sorted({item["ruleId"] for item in findings}),
        "malformedFiles": sorted(malformed),
        "unsupportedFiles": [],
        "skippedSymlinks": sorted(skipped_symlinks),
        "evidenceRedacted": True,
        "externalScanner": False,
        "networkUsed": False,
    }
    return findings, coverage
