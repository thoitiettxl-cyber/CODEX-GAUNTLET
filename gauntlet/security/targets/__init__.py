from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from ..common import current_revision, git, safe_relative_path

VALID_MODES = {"standard", "deep"}


@dataclass(frozen=True)
class NormalizedTarget:
    kind: str
    mode: str
    revision: str
    paths: tuple[str, ...] = ()
    base: str | None = None
    head: str | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["paths"] = list(self.paths)
        return data


def _validate_ref(repo: Path, ref: str) -> str:
    if not ref or ref.startswith("-"):
        raise ValueError(f"invalid git ref: {ref!r}")
    return git(repo, "rev-parse", "--verify", f"{ref}^{{commit}}")


def _changed_paths(repo: Path, base: str, head: str) -> tuple[str, ...]:
    out = git(repo, "diff", "--name-only", f"{base}...{head}")
    paths: list[str] = []
    for line in out.splitlines():
        if line.strip():
            paths.append(safe_relative_path(repo, line.strip(), require_exists=False))
    return tuple(sorted(set(paths)))


def normalize_target(
    repo_root: str | Path,
    *,
    mode: str = "standard",
    repository: bool = False,
    paths: Iterable[str] | None = None,
    diff: str | None = None,
    working_tree: bool = False,
    base: str | None = None,
    head: str | None = None,
) -> NormalizedTarget:
    repo = Path(repo_root).resolve()
    if mode not in VALID_MODES:
        raise ValueError(f"unsupported scan mode: {mode}")
    explicit_paths = tuple(paths or ())
    selectors = int(repository) + int(bool(explicit_paths)) + int(diff is not None) + int(working_tree)
    if selectors != 1:
        raise ValueError("select exactly one target: repository, paths, diff, or working_tree")

    revision = current_revision(repo)
    if repository:
        return NormalizedTarget("repository", mode, revision)

    if explicit_paths:
        normalized = tuple(sorted({safe_relative_path(repo, p, require_exists=True) for p in explicit_paths}))
        return NormalizedTarget("paths", mode, revision, normalized)

    if diff is not None:
        if base or head:
            raise ValueError("do not combine --diff with separate base/head")
        separator = "..." if "..." in diff else ".."
        pieces = diff.split(separator)
        if len(pieces) != 2 or not all(pieces):
            raise ValueError("diff must be BASE..HEAD or BASE...HEAD")
        base_sha = _validate_ref(repo, pieces[0])
        head_sha = _validate_ref(repo, pieces[1])
        return NormalizedTarget("diff", mode, head_sha, _changed_paths(repo, base_sha, head_sha), base_sha, head_sha)

    if head is not None:
        raise ValueError("working_tree target must not provide head")
    base_ref = base or "HEAD"
    base_sha = _validate_ref(repo, base_ref)
    out = git(repo, "diff", "--name-only", base_sha)
    untracked = git(repo, "ls-files", "--others", "--exclude-standard", check=False)
    values = [*out.splitlines(), *untracked.splitlines()]
    normalized = tuple(sorted({safe_relative_path(repo, p, require_exists=False) for p in values if p.strip()}))
    return NormalizedTarget("working_tree", mode, revision, normalized, base_sha, None)
