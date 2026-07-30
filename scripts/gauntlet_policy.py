#!/usr/bin/env python
"""Normalized-operation policy for the native Windows Codex adapter."""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


PROTECTED_PATHS = (
    ".codex/",
    ".harness-core/",
    ".agents/skills/onboard-repository/",
    ".agents/skills/audit-onboarding-proposal/",
    ".agents/skills/verify-suite/",
    ".agents/skills/spec-check/",
    ".agents/skills/mutation-audit/",
    ".agents/skills/threat-model/",
    ".agents/skills/security-diff-scan/",
    ".agents/skills/validate-finding/",
    ".agents/skills/attack-path-review/",
    ".agents/skills/triage-finding/",
    "gauntlet/handshake/",
    "gauntlet/security/",
    "qa/security/",
    "qa/tests/",
    "artifacts/verification/",
)
HARD_PROTECTED_PATHS = tuple(
    path
    for path in PROTECTED_PATHS
    if path == ".harness-core/" or path.startswith(".agents/skills/")
)
POLICY_CRITICAL = (
    "qa/verify.ps1",
    "qa/verify_v6.py",
    "qa/policy.json",
    "qa/thresholds.json",
    "qa/security/thresholds.json",
    "qa/compatibility.json",
    "qa/verify-matrix.yaml",
    "qa/classify_changes.py",
    "qa/gate_selection.py",
    "qa/policy_audit.py",
    "qa/check_harness.py",
    "qa/repository-identity.json",
    "scripts/gauntlet_handshake.py",
    "scripts/gauntlet_policy.py",
    "security/threat-model.md",
    "security/threat-model-sources.json",
    ".github/workflows/codex-gauntlet.yml",
)
ALL_PROTECTED_PATHS = PROTECTED_PATHS + POLICY_CRITICAL

ALLOWED_OPERATIONS = {"shell", "edit", "write", "patch", "read", "unknown"}
MAINTENANCE_OPERATIONS = {"edit", "write", "patch"}
READ_ONLY_COMMANDS = {
    "awk",
    "basename",
    "cat",
    "command",
    "cut",
    "dirname",
    "du",
    "env",
    "file",
    "find",
    "git",
    "grep",
    "head",
    "jq",
    "ls",
    "pwd",
    "readlink",
    "realpath",
    "rg",
    "sed",
    "sort",
    "stat",
    "tail",
    "test",
    "tr",
    "tree",
    "uname",
    "uniq",
    "wc",
    "which",
}
MUTATING_COMMANDS = {
    "add-content",
    "clear-content",
    "chmod",
    "chown",
    "copy-item",
    "cp",
    "install",
    "ln",
    "mkdir",
    "move-item",
    "mv",
    "new-item",
    "out-file",
    "remove-item",
    "rename-item",
    "rm",
    "rmdir",
    "set-content",
    "tee",
    "touch",
    "truncate",
}
GIT_MUTATING_SUBCOMMANDS = {
    "add",
    "am",
    "apply",
    "branch",
    "checkout",
    "cherry-pick",
    "clean",
    "commit",
    "fetch",
    "merge",
    "mv",
    "pull",
    "push",
    "rebase",
    "reset",
    "restore",
    "revert",
    "rm",
    "stash",
    "switch",
    "tag",
}
MAX_REASON = 240

PROHIBITED_CONFIG = (
    r"sandbox_mode\s*=\s*[\"']danger-full-access[\"']",
    r"approval_policy\s*=\s*[\"']never[\"']",
    r"sandbox_workspace_write\.network_access\s*=\s*true",
    r"\bnetwork_access\s*=\s*true",
)
PATCH_TARGET_RE = re.compile(
    r"(?m)^\*\*\* (?:Add|Update|Delete) File: (.+)$"
    r"|^\*\*\* Move to: (.+)$"
)


@dataclass(frozen=True)
class ShellCommand:
    argv: tuple[str, ...]
    write_targets: tuple[str, ...]
    side_effect: str


@dataclass(frozen=True)
class PolicyInput:
    operation: str
    text: str = ""
    targets: tuple[str, ...] = ()
    authority_request: bool = False

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> PolicyInput:
        operation = str(value.get("operation") or "unknown").lower()
        if operation not in ALLOWED_OPERATIONS:
            operation = "unknown"
        text = value.get("text")
        raw_targets = value.get("targets")
        targets = (
            tuple(str(item) for item in raw_targets if isinstance(item, str))
            if isinstance(raw_targets, list)
            else ()
        )
        return cls(
            operation=operation,
            text=text if isinstance(text, str) else "",
            targets=targets,
            authority_request=value.get("authority_request") is True,
        )


@dataclass(frozen=True)
class PolicyContext:
    cwd: Path
    repo_root: Path
    maintenance_enabled: bool = False
    maintenance_targets: tuple[str, ...] = ()
    human_triage_enabled: bool = False

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> PolicyContext:
        cwd = Path(str(value.get("cwd") or ".")).resolve()
        repo_root = Path(str(value.get("repo_root") or cwd)).resolve()
        raw_targets = value.get("maintenance_targets")
        targets = (
            tuple(str(item) for item in raw_targets if isinstance(item, str))
            if isinstance(raw_targets, list)
            else ()
        )
        return cls(
            cwd=cwd,
            repo_root=repo_root,
            maintenance_enabled=value.get("maintenance_enabled") is True,
            maintenance_targets=targets,
            human_triage_enabled=value.get("human_triage_enabled") is True,
        )


@dataclass(frozen=True)
class PolicyDecision:
    action: str
    reason_code: str
    reason: str
    remediation: str
    target: str
    normalized_targets: tuple[str, ...]
    protected_targets: tuple[str, ...]
    mutation: bool
    policy_sensitive: bool
    covered: bool = True

    def explanation(self) -> str:
        return " | ".join(
            (
                f"rule={self.reason_code}",
                f"target={self.target or '<operation>'}",
                f"reason={self.reason[:MAX_REASON]}",
                f"remediation={self.remediation[:MAX_REASON]}",
            )
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "reason_code": self.reason_code,
            "reason": self.reason[:MAX_REASON],
            "remediation": self.remediation[:MAX_REASON],
            "target": self.target,
            "explanation": self.explanation(),
            "normalized_targets": list(self.normalized_targets),
            "protected_targets": list(self.protected_targets),
            "mutation": self.mutation,
            "policy_sensitive": self.policy_sensitive,
            "covered": self.covered,
        }


def normalize_target(value: str, context: PolicyContext) -> str:
    candidate = value.strip().strip("\"'").replace("\\", "/")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    candidate = posixpath.normpath(candidate)
    path = Path(candidate)
    resolved = path.resolve() if path.is_absolute() else (context.cwd / path).resolve()
    try:
        return resolved.relative_to(context.repo_root.resolve()).as_posix()
    except ValueError:
        return resolved.as_posix()


def target_matches(target: str, protected_path: str) -> bool:
    normalized = posixpath.normpath(protected_path)
    return target == normalized or (
        protected_path.endswith("/") and target.startswith(normalized + "/")
    )


def protected_path_for_target(target: str) -> str | None:
    return next(
        (
            protected
            for protected in ALL_PROTECTED_PATHS
            if target_matches(target, protected)
        ),
        None,
    )


def protected_paths_in_text(text: str) -> tuple[str, ...]:
    normalized = text.replace("\\", "/")
    return tuple(
        protected
        for protected in ALL_PROTECTED_PATHS
        if protected.rstrip("/") in normalized
    )


def _tokenize_shell(text: str) -> list[str]:
    try:
        lexer = shlex.shlex(text, posix=True, punctuation_chars=";&|<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except ValueError:
        return []


def _command_side_effect(argv: list[str], write_targets: list[str]) -> str:
    if write_targets:
        return "definite"
    if not argv:
        return "none"
    executable = Path(argv[0]).name.lower()
    if executable in MUTATING_COMMANDS:
        return "definite"
    if executable == "git" and len(argv) > 1:
        subcommand = next((item for item in argv[1:] if not item.startswith("-")), "")
        return "definite" if subcommand in GIT_MUTATING_SUBCOMMANDS else "none"
    if executable in {"sed", "perl"} and any(
        item == "-i" or item.startswith("-i") or item == "-pi"
        for item in argv[1:]
    ):
        return "definite"
    if executable in {"apply_patch"} or "*** Begin Patch" in " ".join(argv):
        return "definite"
    if executable in {
        "bash",
        "node",
        "perl",
        "php",
        "python",
        "python3",
        "ruby",
        "sh",
        "zsh",
    } and any(item in {"-c", "-e"} for item in argv[1:]):
        return "possible"
    return "none" if executable in READ_ONLY_COMMANDS else "possible"


def _argument_write_targets(argv: list[str], side_effect: str) -> list[str]:
    if not argv or side_effect != "definite":
        return []
    executable = Path(argv[0]).name.lower()
    args = [item for item in argv[1:] if item and not item.startswith("-")]
    if executable == "chmod" and args and re.fullmatch(r"[0-7]{3,4}", args[0]):
        args = args[1:]
    if executable == "git":
        return []
    if executable in {"mv", "rm", "rmdir"}:
        return args
    if executable in MUTATING_COMMANDS:
        return args[-1:] if executable in {"cp", "install", "ln", "tee"} else args
    if executable in {"sed", "perl"}:
        return args[-1:]
    return []


def normalized_shell_commands(text: str) -> tuple[ShellCommand, ...]:
    tokens = _tokenize_shell(text)
    if not tokens:
        return ()
    commands: list[ShellCommand] = []
    argv: list[str] = []
    redirects: list[str] = []
    index = 0

    def finish() -> None:
        nonlocal argv, redirects
        if not argv and not redirects:
            return
        side_effect = _command_side_effect(argv, redirects)
        targets = redirects + _argument_write_targets(argv, side_effect)
        commands.append(ShellCommand(tuple(argv), tuple(targets), side_effect))
        argv = []
        redirects = []

    while index < len(tokens):
        token = tokens[index]
        if token and set(token) <= set(";&|"):
            finish()
            index += 1
            continue
        if token and set(token) <= set("<>"):
            if ">" in token and index + 1 < len(tokens):
                redirects.append(tokens[index + 1])
            index += 2
            continue
        argv.append(token)
        index += 1
    finish()
    return tuple(commands)


def _patch_targets(text: str) -> tuple[str, ...]:
    return tuple(
        (match.group(1) or match.group(2)).strip()
        for match in PATCH_TARGET_RE.finditer(text)
    )


def shell_write_targets(text: str) -> tuple[str, ...]:
    targets = {
        target
        for command in normalized_shell_commands(text)
        for target in command.write_targets
    }
    targets.update(_patch_targets(text))
    return tuple(sorted(targets))


def is_mutating_command(text: str) -> bool:
    return any(
        item.side_effect in {"possible", "definite"}
        for item in normalized_shell_commands(text)
    ) or bool(_patch_targets(text))


def mutation_requested(policy_input: PolicyInput) -> bool:
    if policy_input.operation in {"edit", "write", "patch"}:
        return True
    return policy_input.operation == "shell" and is_mutating_command(policy_input.text)


def _dangerous_shell_decision(
    commands: Iterable[ShellCommand],
) -> tuple[str, str, str, str] | None:
    for command in commands:
        argv = list(command.argv)
        if not argv:
            continue
        executable = Path(argv[0]).name.lower()
        lowered = [item.lower() for item in argv[1:]]
        joined = " ".join(argv)

        if any(
            item in {"--dangerously-bypass-hook-trust", "danger-full-access"}
            for item in lowered
        ):
            return (
                "CG.POLICY.BYPASS",
                joined,
                "sandbox or hook-trust bypass is prohibited",
                "use the repository approval and maintenance workflow",
            )
        if executable == "rm":
            flags = "".join(item[1:] for item in argv[1:] if item.startswith("-"))
            targets = [item for item in argv[1:] if not item.startswith("-")]
            if "r" in flags and "f" in flags and any(
                item in {"/", "~", "~/", "$HOME", "$HOME/"} for item in targets
            ):
                return (
                    "CG.POLICY.DESTRUCTIVE_ROOT",
                    next(item for item in targets if item in {"/", "~", "~/", "$HOME", "$HOME/"}),
                    "destructive removal targets a root or home boundary",
                    "resolve and review a narrow workspace-relative target",
                )
        if executable.startswith("mkfs"):
            return (
                "CG.POLICY.FILESYSTEM_FORMAT",
                joined,
                "filesystem formatting is outside repository scope",
                "use a non-destructive repository-local operation",
            )
        if executable == "dd" and any(item.startswith("of=/dev/") for item in argv[1:]):
            return (
                "CG.POLICY.RAW_DISK_WRITE",
                joined,
                "raw device writes are prohibited",
                "write only to an explicit repository-local file",
            )
        if executable == "git" and "reset" in lowered and "--hard" in lowered:
            return (
                "CG.POLICY.GIT_HARD_RESET",
                joined,
                "hard reset can discard unrelated user work",
                "inspect the diff and use a narrow recoverable Git operation",
            )
        if executable == "git" and "clean" in lowered and any(
            item.startswith("-") and "f" in item for item in lowered
        ):
            return (
                "CG.POLICY.GIT_DESTRUCTIVE_CLEAN",
                joined,
                "forced Git clean can delete untracked user files",
                "enumerate exact files and use a recoverable operation",
            )
        if executable == "git" and "push" in lowered and any(
            item == "-f" or item.startswith("--force") for item in lowered
        ):
            return (
                "CG.POLICY.GIT_FORCE_PUSH",
                joined,
                "force push rewrites shared history",
                "use a normal push or obtain explicit authorization",
            )
        scanner_install = executable in {"npm", "pnpm", "yarn", "bun"} and any(
            item in {"install", "add", "i"} for item in lowered
        )
        scanner_run = executable in {"npx", "bunx", "codex-security"}
        if (scanner_install or scanner_run) and "codex-security" in " ".join(lowered):
            return (
                "CG.POLICY.EXTERNAL_SCANNER",
                joined,
                "external security scanner use violates the offline clean-room boundary",
                "run the internal Security Intelligence gates through ./qa/verify",
            )
    return None


def _decision(
    action: str,
    reason_code: str,
    reason: str,
    remediation: str,
    *,
    target: str,
    normalized_targets: tuple[str, ...],
    protected_targets: tuple[str, ...],
    mutation: bool,
    covered: bool = True,
) -> PolicyDecision:
    return PolicyDecision(
        action=action,
        reason_code=reason_code,
        reason=reason[:MAX_REASON],
        remediation=remediation[:MAX_REASON],
        target=target,
        normalized_targets=normalized_targets,
        protected_targets=protected_targets,
        mutation=mutation,
        policy_sensitive=mutation or action != "allow",
        covered=covered,
    )


def decide(policy_input: PolicyInput, context: PolicyContext) -> PolicyDecision:
    raw_targets = set(policy_input.targets)
    shell_commands = (
        normalized_shell_commands(policy_input.text)
        if policy_input.operation == "shell"
        else ()
    )
    if policy_input.operation == "shell":
        raw_targets.update(shell_write_targets(policy_input.text))
    if policy_input.operation == "patch":
        raw_targets.update(_patch_targets(policy_input.text))
    normalized_targets = tuple(
        sorted({normalize_target(target, context) for target in raw_targets})
    )
    mutation = mutation_requested(policy_input)

    direct_protected = {
        protected
        for target in normalized_targets
        if (protected := protected_path_for_target(target))
    }
    text_protected: set[str] = set()
    unresolved_shell_mutation = any(
        command.side_effect == "definite"
        or (
            command.side_effect == "possible"
            and any(item in {"-c", "-e"} for item in command.argv[1:])
        )
        for command in shell_commands
    )
    if (
        policy_input.authority_request
        or (
            policy_input.operation == "shell"
            and unresolved_shell_mutation
            and not normalized_targets
        )
    ):
        text_protected.update(protected_paths_in_text(policy_input.text))
    protected_targets = tuple(sorted(direct_protected | text_protected))
    if policy_input.authority_request and protected_targets:
        mutation = True

    if policy_input.operation == "unknown":
        return _decision(
            "allow",
            "CG.POLICY.UNCOVERED_TOOL",
            "this tool is outside the shared normalized-operation contract",
            "retain native sandbox and user approval for this tool",
            target="<uncovered-tool>",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=False,
            covered=False,
        )

    if policy_input.operation == "shell":
        dangerous = _dangerous_shell_decision(shell_commands)
        if dangerous:
            rule_id, target, reason, remediation = dangerous
            return _decision(
                "deny",
                rule_id,
                reason,
                remediation,
                target=target,
                normalized_targets=normalized_targets,
                protected_targets=protected_targets,
                mutation=True,
            )

    config_targeted = any(
        target_matches(target, ".codex/config.toml")
        for target in normalized_targets
    )
    if config_targeted and any(
        re.search(pattern, policy_input.text, re.IGNORECASE)
        for pattern in PROHIBITED_CONFIG
    ):
        return _decision(
            "deny",
            "CG.POLICY.CODEX_BASELINE",
            "Codex sandbox, approval, or network policy may not be weakened",
            "preserve the checked-in baseline and request a narrow operation",
            target=".codex/config.toml",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    harness_update = any(
        command.argv
        and str(command.argv[0]).replace("\\", "/").endswith("scripts/bin/harness.exe")
        and any(item in {"update", "activate"} for item in command.argv[1:])
        for command in shell_commands
    )
    if harness_update:
        action = "requires_human" if context.maintenance_enabled else "deny"
        return _decision(
            action,
            "CG.POLICY.HARNESS_MAINTENANCE",
            "Harness update requires explicit operator maintenance authority",
            "enter the documented Harness maintenance lane",
            target="scripts/bin/harness.exe",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    triage_targeted = any(
        target_matches(target, "qa/security/triage/")
        for target in normalized_targets
    )
    if triage_targeted and mutation and not context.human_triage_enabled:
        return _decision(
            "deny",
            "CG.POLICY.HUMAN_TRIAGE",
            "security triage is human-only and requires auditable metadata",
            "obtain a human approver, reason, timestamp, and optional expiry",
            target="qa/security/triage/",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    sealed_target = next(
        (
            path
            for path in (
                "qa/security/reports/",
                "artifacts/verification/evidence/",
                "artifacts/verification/receipts/",
            )
            if any(target_matches(target, path) for target in normalized_targets)
        ),
        None,
    )
    if sealed_target and mutation:
        return _decision(
            "deny",
            "CG.POLICY.SEALED_ARTIFACT",
            "sealed runtime evidence may only be created by its canonical issuer",
            "run qa/verify.ps1 instead of writing generated evidence directly",
            target=sealed_target,
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    if protected_targets and mutation:
        hard_protected = any(
            protected in HARD_PROTECTED_PATHS for protected in protected_targets
        )
        if hard_protected:
            return _decision(
                "deny",
                "CG.POLICY.HARD_PROTECTED_WRITE",
                "managed Harness and Agent Skill paths cannot enter this maintenance lane",
                "use the owner-specific reviewed update process",
                target=protected_targets[0],
                normalized_targets=normalized_targets,
                protected_targets=protected_targets,
                mutation=True,
            )

        allowed = {
            normalize_target(target, context)
            for target in context.maintenance_targets
            if target.strip()
        }
        exact_scope = (
            policy_input.operation in MAINTENANCE_OPERATIONS
            and bool(normalized_targets)
            and set(normalized_targets) <= allowed
        )
        if context.maintenance_enabled and exact_scope:
            return _decision(
                "requires_human",
                "CG.POLICY.EXACT_MAINTENANCE_SCOPE",
                "the exact maintenance scope is valid; human approval remains authoritative",
                "approve only the reviewed exact target set",
                target=normalized_targets[0],
                normalized_targets=normalized_targets,
                protected_targets=protected_targets,
                mutation=True,
            )
        return _decision(
            "deny",
            "CG.POLICY.PROTECTED_WRITE",
            "direct mutation of a protected ownership path is outside the active scope",
            "use the correct exact maintenance lane with human approval",
            target=normalized_targets[0] if normalized_targets else protected_targets[0],
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    return _decision(
        "allow",
        "CG.POLICY.ALLOW",
        "operation is allowed by the normalized repository policy",
        "no remediation required",
        target=normalized_targets[0] if normalized_targets else "<operation>",
        normalized_targets=normalized_targets,
        protected_targets=protected_targets,
        mutation=mutation,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if not args.json:
        parser.error("--json is required")
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("request must be an object")
        raw_input = payload.get("input")
        raw_context = payload.get("context")
        if not isinstance(raw_input, dict) or not isinstance(raw_context, dict):
            raise ValueError("input and context objects are required")
        result = decide(
            PolicyInput.from_mapping(raw_input),
            PolicyContext.from_mapping(raw_context),
        )
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"invalid policy request: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result.as_dict(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
