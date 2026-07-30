from __future__ import annotations

import re
from dataclasses import dataclass


SOURCE = "gauntlet-agent-config-audit-v1"


@dataclass(frozen=True)
class Rule:
    title: str
    severity: str
    confidence: str
    remediation: str


RULES = {
    "CG.AGENT.CONFIG_MALFORMED": Rule(
        "Malformed agent configuration",
        "high",
        "high",
        "Restore a parseable, repository-owned configuration with the required security fields.",
    ),
    "CG.AGENT.CONFIG_SYMLINK": Rule(
        "Agent configuration escapes through a symlink",
        "high",
        "high",
        "Replace the symlink with a reviewed regular file inside the repository.",
    ),
    "CG.AGENT.CONFIG_PATH_ESCAPE": Rule(
        "Agent configuration references a path outside the repository",
        "high",
        "high",
        "Use an existing regular repository file and reject absolute, escaping, or symlinked targets.",
    ),
    "CG.AGENT.POLICY_WEAKENING": Rule(
        "Codex security baseline is weakened",
        "high",
        "high",
        "Preserve workspace isolation, human-reviewed approval, disabled outbound network, and enabled hooks.",
    ),
    "CG.AGENT.SECRET_LITERAL": Rule(
        "Literal secret material in agent configuration",
        "high",
        "high",
        "Remove the literal and reference a runtime secret provider without committing or logging the value.",
    ),
    "CG.AGENT.HOOK_UNSAFE_EXEC": Rule(
        "Unsafe hook execution shape",
        "high",
        "high",
        "Use one pinned argv-style repository command without shell evaluation, downloads, or command chaining.",
    ),
    "CG.AGENT.HOOK_PATH_ESCAPE": Rule(
        "Hook command target is outside the reviewed repository boundary",
        "high",
        "high",
        "Resolve hook scripts beneath the repository and use the pinned Termux interpreter.",
    ),
    "CG.AGENT.HOOK_COVERAGE": Rule(
        "Required mutation hook coverage is incomplete",
        "high",
        "high",
        "Restore PreToolUse, PermissionRequest, and Stop coverage for the canonical mutation tools.",
    ),
    "CG.AGENT.MCP_REMOTE": Rule(
        "Remote MCP endpoint violates the offline boundary",
        "high",
        "high",
        "Use a reviewed local transport or explicitly change the repository security contract.",
    ),
    "CG.AGENT.MCP_UNPINNED": Rule(
        "MCP server command is unpinned or shell-evaluated",
        "high",
        "high",
        "Use a reviewed repository-local or exact Termux executable with fixed argv and no package runner.",
    ),
    "CG.AGENT.SKILL_METADATA": Rule(
        "Skill metadata is missing, malformed, or inconsistent",
        "medium",
        "high",
        "Restore bounded frontmatter and OpenAI metadata that agree with the skill directory and invocation policy.",
    ),
    "CG.AGENT.SKILL_DUPLICATE": Rule(
        "Skill name or purpose overlaps another managed skill",
        "medium",
        "medium",
        "Merge the overlapping responsibility or make each skill purpose and trigger boundary distinct.",
    ),
    "CG.AGENT.SKILL_OVERSIZED": Rule(
        "Skill entrypoint exceeds the bounded context budget",
        "low",
        "high",
        "Keep SKILL.md concise and move optional detail into explicitly referenced resources.",
    ),
    "CG.AGENT.SKILL_REFERENCE": Rule(
        "Skill reference is missing or escapes the repository",
        "medium",
        "high",
        "Point the Markdown reference at an existing regular file inside the repository.",
    ),
    "CG.AGENT.SKILL_UNSAFE_INSTRUCTION": Rule(
        "Skill contains an unsafe executable instruction",
        "high",
        "high",
        "Remove approval bypass, privilege escalation, remote installer, or prompt-injection instructions.",
    ),
}


def candidate(
    rule_id: str,
    path: str,
    line: int,
    anchor: str,
    *,
    evidence: list[str] | None = None,
) -> dict:
    """Create a standard candidate without retaining matched secret content."""

    rule = RULES[rule_id]
    safe_anchor = re.sub(r"[^A-Za-z0-9._:/+,-]+", "-", anchor).strip("-")[:160]
    safe_anchor = safe_anchor or "configuration"
    return {
        "ruleId": rule_id,
        "title": rule.title,
        "severity": rule.severity,
        "confidence": rule.confidence,
        "location": {
            "path": path,
            "startLine": max(1, int(line)),
            "endLine": max(1, int(line)),
        },
        "rootCauseKey": f"{rule_id}:{safe_anchor}",
        "rootCauseSummary": f"{rule.title}: {safe_anchor}",
        "evidenceRefs": evidence or [f"source:{path}:{max(1, int(line))}"],
        "remediation": rule.remediation,
        "source": SOURCE,
    }


def normalize_candidates(values: list[dict]) -> list[dict]:
    unique: dict[tuple[str, str, str, int], dict] = {}
    for item in values:
        location = item["location"]
        key = (
            item["ruleId"],
            item["rootCauseKey"],
            location["path"],
            location["startLine"],
        )
        unique[key] = item
    return sorted(
        unique.values(),
        key=lambda item: (
            item["location"]["path"],
            item["location"]["startLine"],
            item["ruleId"],
            item["rootCauseKey"],
        ),
    )
