#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROTECTED_PATHS = (
    ".codex/",
    ".pi/",
    ".harness-core/",
    ".agents/skills/onboard-repository/",
    ".agents/skills/audit-onboarding-proposal/",
    ".agents/skills/verify-suite/",
    ".agents/skills/spec-check/",
    ".agents/skills/mutation-audit/",
)
HARD_PROTECTED_PATHS = tuple(
    path
    for path in PROTECTED_PATHS
    if path == ".harness-core/" or path.startswith(".agents/skills/")
)
POLICY_CRITICAL = (
    "qa/verify",
    "qa/thresholds.json",
    "qa/compatibility.json",
    "qa/verify-matrix.yaml",
    "qa/policy_audit.py",
    "qa/check_harness.py",
    ".github/workflows/codex-gauntlet.yml",
)
ALL_PROTECTED_PATHS = PROTECTED_PATHS + POLICY_CRITICAL

ALLOWED_OPERATIONS = {"shell", "edit", "write", "patch", "unknown"}
MAINTENANCE_OPERATIONS = {"edit", "write", "patch"}
MAX_REASON = 240

DANGEROUS_COMMANDS = (
    (
        "destructive_root_remove",
        r"\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:--\s+)?/(?:\s|$)",
    ),
    ("filesystem_format", r"\bmkfs(?:\.|\s)"),
    ("raw_disk_write", r"\bdd\s+if="),
    ("git_hard_reset", r"\bgit\s+reset\s+--hard\b"),
    ("git_destructive_clean", r"\bgit\s+clean\s+-[^\n]*[xX]"),
    ("git_force_push", r"\bgit\s+push\s+[^\n]*(?:--force|-f\b)"),
    ("hook_trust_bypass", r"--dangerously-bypass-hook-trust"),
    ("sandbox_bypass", r"\bdanger-full-access\b"),
)

MUTATION_PATTERNS = (
    r"(?:^|[;&|]\s*|\s)(?:rm|mv|cp|touch|chmod|chown|mkdir|rmdir|ln|install|truncate)\s",
    r"\b(?:git\s+(?:checkout\s+--|restore|apply|commit|merge|rebase|cherry-pick))\b",
    r"\b(?:sed\s+-i|perl\s+-pi|python(?:3)?\s+-c)\b",
    r"\bapply_patch\b",
    r"\b(?:cat|tee)\s+[^\n]*(?:>|>>)",
    r"(?<![<>])>{1,2}(?!>)",
    r"\*\*\*\s+(?:update|add|delete)\s+file:",
)

PROHIBITED_CONFIG = (
    r"sandbox_mode\s*=\s*[\"']danger-full-access[\"']",
    r"approval_policy\s*=\s*[\"']never[\"']",
    r"sandbox_workspace_write\.network_access\s*=\s*true",
    r"\bnetwork_access\s*=\s*true",
)


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
        )


@dataclass(frozen=True)
class PolicyDecision:
    action: str
    reason_code: str
    reason: str
    normalized_targets: tuple[str, ...]
    protected_targets: tuple[str, ...]
    mutation: bool
    policy_sensitive: bool
    covered: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "reason_code": self.reason_code,
            "reason": self.reason[:MAX_REASON],
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


def is_mutating_command(text: str) -> bool:
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in MUTATION_PATTERNS)


def mutation_requested(policy_input: PolicyInput) -> bool:
    if policy_input.operation in {"edit", "write", "patch"}:
        return True
    return (
        policy_input.operation == "shell"
        and is_mutating_command(policy_input.text)
    )


def _decision(
    action: str,
    reason_code: str,
    reason: str,
    *,
    normalized_targets: tuple[str, ...],
    protected_targets: tuple[str, ...],
    mutation: bool,
    covered: bool = True,
) -> PolicyDecision:
    return PolicyDecision(
        action=action,
        reason_code=reason_code,
        reason=reason[:MAX_REASON],
        normalized_targets=normalized_targets,
        protected_targets=protected_targets,
        mutation=mutation,
        policy_sensitive=mutation or action != "allow",
        covered=covered,
    )


def decide(
    policy_input: PolicyInput,
    context: PolicyContext,
) -> PolicyDecision:
    normalized_targets = tuple(
        sorted({normalize_target(target, context) for target in policy_input.targets})
    )
    direct_protected = {
        protected
        for target in normalized_targets
        if (protected := protected_path_for_target(target))
    }
    mutation = mutation_requested(policy_input)
    text_protected = set(
        protected_paths_in_text(policy_input.text)
        if (
            mutation or policy_input.authority_request
        ) and (
            policy_input.operation == "shell" or not normalized_targets
        )
        else ()
    )
    protected_targets = tuple(sorted(direct_protected | text_protected))
    if policy_input.authority_request and protected_targets:
        mutation = True

    if policy_input.operation == "unknown":
        return _decision(
            "allow",
            "unsupported_tool",
            "This tool is outside the shared Gauntlet decision contract.",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=False,
            covered=False,
        )

    if policy_input.operation == "shell":
        for reason_code, pattern in DANGEROUS_COMMANDS:
            if re.search(pattern, policy_input.text, re.IGNORECASE):
                return _decision(
                    "deny",
                    reason_code,
                    "Blocked destructive or policy-bypass shell operation.",
                    normalized_targets=normalized_targets,
                    protected_targets=protected_targets,
                    mutation=True,
                )

    config_targeted = any(
        target_matches(target, ".codex/config.toml")
        for target in normalized_targets
    )
    if (
        (policy_input.operation == "shell" or config_targeted)
        and any(
            re.search(pattern, policy_input.text, re.IGNORECASE)
            for pattern in PROHIBITED_CONFIG
        )
    ):
        return _decision(
            "deny",
            "codex_baseline_weakening",
            "Codex sandbox, approval, or network policy may not be weakened.",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    harness_update = (
        policy_input.operation == "shell"
        and ("scripts/bin/" + "harness update") in policy_input.text.lower()
    )
    if harness_update:
        action = "requires_human" if context.maintenance_enabled else "deny"
        return _decision(
            action,
            "harness_maintenance",
            "Harness update requires explicit operator maintenance authority.",
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
                "hard_protected_target",
                "Managed Harness and Agent Skill paths cannot enter this maintenance lane.",
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
                "exact_maintenance_scope",
                "Exact maintenance scope is valid; human approval remains authoritative.",
                normalized_targets=normalized_targets,
                protected_targets=protected_targets,
                mutation=True,
            )
        return _decision(
            "deny",
            "protected_target",
            "Direct mutation of a protected path is outside the active exact maintenance scope.",
            normalized_targets=normalized_targets,
            protected_targets=protected_targets,
            mutation=True,
        )

    return _decision(
        "allow",
        "ordinary_operation",
        "Operation is allowed by the shared repository policy.",
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
