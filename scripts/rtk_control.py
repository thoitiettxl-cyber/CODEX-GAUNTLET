#!/data/data/com.termux/files/usr/bin/python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import tomllib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator


STABLE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SHELL_SYNTAX = re.compile(r"(?:\n|&&|\|\||[;|<>`]|[$][(]|<<)")
EXACT_COMMANDS = {
    "cat",
    "head",
    "tail",
    "sed",
    "awk",
    "jq",
    "rg",
    "grep",
    "find",
    "ls",
    "sha256sum",
    "shasum",
    "md5sum",
    "cmp",
    "diff",
    "readelf",
    "file",
}
MUTATING_COMMANDS = {
    "apply_patch",
    "cargo install",
    "git add",
    "git cherry-pick",
    "git clean",
    "git commit",
    "git merge",
    "git pull",
    "git push",
    "git rebase",
    "git reset",
    "install",
    "mv",
    "npm install",
    "pip install",
    "rm",
    "touch",
    "wget",
}
PERMITTED_FILTERS = {
    ("cargo", "build"): "rtk cargo build",
    ("cargo", "check"): "rtk cargo check",
    ("cargo", "clippy"): "rtk cargo clippy",
    ("cargo", "test"): "rtk cargo test",
    ("go", "test"): "rtk go test",
    ("gradlew", "build"): "rtk gradlew build",
    ("gradlew", "lint"): "rtk gradlew lint",
    ("gradlew", "test"): "rtk gradlew test",
    ("jest",): "rtk jest",
    ("mvn", "test"): "rtk mvn test",
    ("npm", "test"): "rtk npm test",
    ("pytest",): "rtk pytest",
    ("ruff", "check"): "rtk ruff check",
    ("vitest",): "rtk vitest",
}


@dataclass(frozen=True)
class RuntimePaths:
    binary: Path
    config: Path
    codex_policy: Path
    codex_agents: Path
    pi_policy: Path
    pi_rewrite_extension: Path

    @classmethod
    def deployed(cls) -> RuntimePaths:
        home = Path.home()
        return cls(
            binary=home / ".local" / "bin" / "rtk",
            config=home / ".config" / "rtk" / "config.toml",
            codex_policy=home / ".codex" / "RTK.md",
            codex_agents=home / ".codex" / "AGENTS.md",
            pi_policy=home / ".pi" / "agent" / "APPEND_SYSTEM.md",
            pi_rewrite_extension=home / ".pi" / "agent" / "extensions" / "rtk.ts",
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_toml(path: Path) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def check(ok: bool, detail: str) -> dict[str, object]:
    return {"ok": bool(ok), "detail": detail}


def classify_command(command: str) -> dict[str, str]:
    stripped = command.strip()
    if not stripped:
        return {"posture": "raw_required", "reason": "empty-command"}
    if stripped.startswith("rtk "):
        return {"posture": "raw_required", "reason": "already-wrapped"}
    if SHELL_SYNTAX.search(stripped):
        return {"posture": "raw_required", "reason": "shell-composition"}
    try:
        parts = shlex.split(stripped)
    except ValueError:
        return {"posture": "raw_required", "reason": "unparseable-shell"}
    if not parts:
        return {"posture": "raw_required", "reason": "empty-command"}

    while parts and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", parts[0]):
        parts.pop(0)
    if not parts:
        return {"posture": "raw_required", "reason": "environment-only"}

    command_path = parts[0]
    executable = Path(command_path).name
    normalized = [executable, *parts[1:]]
    joined = " ".join(normalized)
    if executable in EXACT_COMMANDS:
        return {"posture": "raw_required", "reason": "exact-output"}
    if command_path in {"./qa/verify", "qa/verify"}:
        return {"posture": "raw_required", "reason": "canonical-verification"}
    if command_path in {"scripts/termux-control", "./scripts/termux-control"}:
        return {"posture": "raw_required", "reason": "control-plane"}
    if executable == "git" and len(normalized) > 1 and normalized[1] in {
        "status",
        "diff",
        "show",
        "log",
    }:
        return {"posture": "raw_required", "reason": "git-evidence"}
    for prefix in MUTATING_COMMANDS:
        if joined == prefix or joined.startswith(prefix + " "):
            return {"posture": "raw_required", "reason": "mutation"}

    for prefix, wrapper in PERMITTED_FILTERS.items():
        if tuple(normalized[: len(prefix)]) == prefix:
            suffix = normalized[len(prefix) :]
            rendered = " ".join([wrapper, *map(shlex.quote, suffix)])
            return {
                "posture": "rtk_permitted",
                "reason": "supported-noisy-command",
                "suggested": rendered,
            }
    return {"posture": "raw_required", "reason": "unsupported-command"}


def elf_identity(path: Path) -> dict[str, object]:
    try:
        data = path.read_bytes()
    except OSError:
        return {"valid": False, "format": None, "machine": None, "interpreter": None}
    if len(data) < 20 or data[:4] != b"\x7fELF":
        return {"valid": False, "format": None, "machine": None, "interpreter": None}
    elf_class = "ELF64" if data[4] == 2 else "ELF32" if data[4] == 1 else "unknown"
    endian = "<" if data[5] == 1 else ">" if data[5] == 2 else None
    machine = None
    if endian:
        machine_id = struct.unpack(f"{endian}H", data[18:20])[0]
        machine = {183: "AArch64"}.get(machine_id, str(machine_id))
    interpreter = None
    for candidate in (b"/system/bin/linker64", b"/system/bin/linker"):
        if candidate in data:
            interpreter = candidate.decode()
            break
    return {
        "valid": True,
        "format": elf_class,
        "machine": machine,
        "interpreter": interpreter,
    }


def binary_version(binary: Path) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            [str(binary), "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "RTK_TELEMETRY_DISABLED": "1"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False, "unavailable"
    value = result.stdout.strip()
    match = re.fullmatch(r"rtk ([0-9]+\.[0-9]+\.[0-9]+)", value)
    return bool(result.returncode == 0 and match), match.group(1) if match else "unexpected"


def codex_reference_healthy(agents: Path, policy: Path) -> bool:
    try:
        lines = agents.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    accepted = {
        f"@{policy}",
        "@~/.codex/RTK.md",
        "@/data/data/com.termux/files/home/.codex/RTK.md",
    }
    return any(line.strip() in accepted for line in lines)


def inspect_pi_integration(
    policy_template: Path,
    policy_target: Path,
    rewrite_extension: Path,
) -> dict[str, dict[str, object]]:
    policy_match = bool(
        policy_target.is_file()
        and sha256_file(policy_target) == sha256_file(policy_template)
    )
    rewrite_absent = not (rewrite_extension.exists() or rewrite_extension.is_symlink())
    return {
        "pi_policy_match": check(policy_match, "canonical global append policy"),
        "pi_automatic_rewrite_absent": check(
            rewrite_absent,
            (
                "prohibited extension absent"
                if rewrite_absent
                else "prohibited automatic rewrite target present"
            ),
        ),
    }


def privacy_config_healthy(config: dict) -> bool:
    tracking = config.get("tracking", {})
    telemetry = config.get("telemetry", {})
    tee = config.get("tee", {})
    return bool(
        tracking.get("enabled") is False
        and tracking.get("database_path") == "/dev/null"
        and telemetry.get("enabled") is False
        and telemetry.get("consent_given") is False
        and tee.get("enabled") is True
        and tee.get("mode") == "failures"
        and isinstance(tee.get("max_files"), int)
        and 0 < tee["max_files"] <= 50
        and isinstance(tee.get("max_file_size"), int)
        and 0 < tee["max_file_size"] <= 4 * 1024 * 1024
    )


def telemetry_healthy(binary: Path, config: Path | None = None) -> bool:
    env = {**os.environ, "RTK_TELEMETRY_DISABLED": "1"}
    if config is not None:
        env["XDG_CONFIG_HOME"] = str(config.parents[1])
    try:
        result = subprocess.run(
            [str(binary), "telemetry", "status"],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    output = f"{result.stdout}\n{result.stderr}".lower()
    return bool(
        result.returncode == 0
        and "consent:" in output
        and "consent:" + "       no" in output
        and "enabled:" + "       no" in output
        and "no salt file" in output
    )


def query_rtk_registry(repo_root: Path) -> dict | None:
    cli = repo_root / "scripts" / "bin" / "harness-cli"
    db_path = Path(os.environ.get("HARNESS_DB_PATH", str(repo_root / "harness.db")))
    if not cli.is_file() or not db_path.is_file():
        return None
    env = {
        **os.environ,
        "HARNESS_REPO_ROOT": str(repo_root),
        "HARNESS_DB_PATH": str(db_path),
    }
    try:
        result = subprocess.run(
            [str(cli), "query", "tools", "--json"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
        )
        entries = json.loads(result.stdout) if result.returncode == 0 else []
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return None
    return next(
        (
            item
            for item in entries
            if item.get("source") == "registered" and item.get("name") == "rtk"
        ),
        None,
    )


def inspect_status(
    repo_root: Path,
    runtime: RuntimePaths | None = None,
    registry_provider: Callable[[Path], dict | None] = query_rtk_registry,
) -> dict:
    runtime = runtime or RuntimePaths.deployed()
    provenance = load_json(repo_root / "docs" / "provenance" / "rtk-termux-build.json")
    config_template = repo_root / "config" / "rtk" / "config.toml"
    policy_template = repo_root / "config" / "rtk" / "RTK.md"
    artifact = provenance["artifact"]
    checks: dict[str, dict[str, object]] = {}

    binary_exists = runtime.binary.is_file() and os.access(runtime.binary, os.X_OK)
    checks["binary_present"] = check(binary_exists, "installed executable resolved")
    version_ok, version = binary_version(runtime.binary) if binary_exists else (False, "missing")
    checks["version"] = check(version_ok and version == artifact["version"], version)
    actual_sha = sha256_file(runtime.binary) if binary_exists else None
    checks["artifact_sha256"] = check(
        actual_sha == artifact["sha256"],
        "matches pinned provenance" if actual_sha == artifact["sha256"] else "mismatch",
    )
    identity = elf_identity(runtime.binary) if binary_exists else {}
    identity_ok = bool(
        identity.get("valid")
        and identity.get("format") == artifact["format"]
        and identity.get("machine") == artifact["machine"]
        and identity.get("interpreter") == artifact["interpreter"]
    )
    checks["native_android_elf"] = check(identity_ok, "ELF64 AArch64 Android linker")

    deployed_config = None
    try:
        deployed_config = load_toml(runtime.config)
        template_config = load_toml(config_template)
        config_parse_ok = True
    except (OSError, tomllib.TOMLDecodeError):
        deployed_config, template_config, config_parse_ok = None, None, False
    checks["config_parse"] = check(config_parse_ok, "TOML parsed without exposing values")
    semantic_match = bool(config_parse_ok and deployed_config == template_config)
    checks["config_semantic_match"] = check(semantic_match, "canonical semantics")
    byte_match = bool(
        runtime.config.is_file()
        and sha256_file(runtime.config) == sha256_file(config_template)
    )
    checks["config_byte_match"] = check(byte_match, "canonical bytes")
    checks["privacy_config"] = check(
        bool(deployed_config and privacy_config_healthy(deployed_config)),
        "tracking and telemetry off; private bounded recovery configured",
    )

    policy_match = bool(
        runtime.codex_policy.is_file()
        and sha256_file(runtime.codex_policy) == sha256_file(policy_template)
    )
    checks["codex_policy_match"] = check(policy_match, "canonical accuracy policy")
    checks["codex_reference"] = check(
        codex_reference_healthy(runtime.codex_agents, runtime.codex_policy),
        "AGENTS reference present",
    )
    checks.update(
        inspect_pi_integration(
            policy_template,
            runtime.pi_policy,
            runtime.pi_rewrite_extension,
        )
    )
    checks["telemetry_runtime"] = check(
        binary_exists and telemetry_healthy(runtime.binary),
        "no consent, transmission, or device salt",
    )

    registry = registry_provider(repo_root)
    registry_ok = bool(
        registry
        and registry.get("kind") == "binary"
        and registry.get("command") == "rtk"
        and registry.get("capability") == "command-output-filtering"
        and registry.get("responsibility") == "Tool access"
        and registry.get("status") == "present"
    )
    checks["harness_registry"] = check(
        registry_ok,
        "registered optional provider is present" if registry_ok else "missing or unhealthy",
    )
    return {
        "operation": "rtk.status",
        "version": version,
        "checks": checks,
        "ok": all(bool(item["ok"]) for item in checks.values()),
    }


def private_umask() -> None:
    os.umask(0o077)


def isolated_runtime_probes(binary: Path, repo_root: Path) -> dict:
    with task_temp_dir("rtk-doctor") as temp:
        xdg_config = temp / "config"
        xdg_data = temp / "data"
        config_dir = xdg_config / "rtk"
        tee_dir = xdg_data / "rtk" / "tee"
        config_dir.mkdir(parents=True, mode=0o700)
        xdg_data.mkdir(parents=True, mode=0o700)
        shutil.copyfile(repo_root / "config" / "rtk" / "config.toml", config_dir / "config.toml")
        os.chmod(config_dir / "config.toml", 0o600)
        env = {
            **os.environ,
            "XDG_CONFIG_HOME": str(xdg_config),
            "XDG_DATA_HOME": str(xdg_data),
            "RTK_TELEMETRY_DISABLED": "1",
            "RTK_TEE_DIR": str(tee_dir),
        }
        checks: dict[str, dict[str, object]] = {}

        config_result = subprocess.run(
            [str(binary), "config"],
            capture_output=True,
            timeout=10,
            env=env,
            preexec_fn=private_umask,
        )
        checks["runtime_config_parse"] = check(
            config_result.returncode == 0, "RTK accepted isolated canonical TOML"
        )

        child = (
            "import os;"
            "os.write(1,b'rtk-synthetic-stdout\\n');"
            "os.write(2,b'rtk-synthetic-stderr\\n');"
            "raise SystemExit(17)"
        )
        proxy = subprocess.run(
            [str(binary), "proxy", sys.executable, "-c", child],
            capture_output=True,
            timeout=15,
            env=env,
            preexec_fn=private_umask,
        )
        checks["raw_proxy_bytes"] = check(
            proxy.stdout == b"rtk-synthetic-stdout\n"
            and proxy.stderr == b"rtk-synthetic-stderr\n",
            "stdout and stderr preserved exactly",
        )
        checks["exit_code"] = check(proxy.returncode == 17, "child exit code preserved")

        corpus = temp / "corpus.txt"
        corpus.write_text("noise\nrtk-synthetic-needle\nnoise\n", encoding="utf-8")
        filtered = subprocess.run(
            [str(binary), "grep", "rtk-synthetic-needle", str(corpus)],
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
            preexec_fn=private_umask,
        )
        checks["isolated_filter"] = check(
            filtered.returncode == 0 and "rtk-synthetic-needle" in filtered.stdout,
            "secret-free supported filter succeeded",
        )

        failure_script = temp / "pytest_synthetic_failure.py"
        failure_script.write_text(
            "import os\n"
            "os.write(2, (b'rtk-synthetic-noise\\n' * 80) + b'FAILED synthetic-case\\n')\n"
            "raise SystemExit(9)\n",
            encoding="utf-8",
        )
        tee_result = subprocess.run(
            [str(binary), "test", sys.executable, str(failure_script)],
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
            preexec_fn=private_umask,
        )
        tee_files = list(tee_dir.glob("*.log")) if tee_dir.is_dir() else []
        tee_private = bool(
            tee_files
            and stat.S_IMODE(tee_dir.stat().st_mode) == 0o700
            and all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in tee_files)
        )
        tee_bounded = bool(
            len(tee_files) <= 50 and all(path.stat().st_size <= 4 * 1024 * 1024 for path in tee_files)
        )
        hint_present = "[full output:" in (tee_result.stdout + tee_result.stderr)
        checks["failure_tee"] = check(
            tee_result.returncode == 9 and tee_private and tee_bounded and hint_present,
            (
                "private, bounded, failure-only recovery artifact"
                if tee_result.returncode == 9 and tee_private and tee_bounded and hint_present
                else (
                    f"synthetic exit={tee_result.returncode}; files={len(tee_files)}; "
                    f"private={tee_private}; bounded={tee_bounded}; hint={hint_present}"
                )
            ),
        )

        tracking_files = [
            path
            for path in xdg_data.rglob("*")
            if path.is_file() and path.name in {"tracking.db", "tracking.db-wal", "tracking.db-shm"}
        ]
        checks["tracking_absent"] = check(
            not tracking_files, "no command-history database persisted"
        )
        checks["telemetry_absent"] = check(
            telemetry_healthy(binary, config_dir / "config.toml")
            and not any("salt" in path.name.lower() for path in xdg_data.rglob("*")),
            "no consent, transmission, or device salt",
        )
        return {
            "operation": "rtk.isolated-doctor",
            "checks": checks,
            "ok": all(bool(item["ok"]) for item in checks.values()),
        }


@contextmanager
def task_temp_dir(label: str) -> Iterator[Path]:
    temp_parent = Path(tempfile.gettempdir())
    result = subprocess.run(
        ["mktemp", "-d", str(temp_parent / f"{label}.XXXXXX")],
        capture_output=True,
        text=True,
        check=True,
    )
    path = Path(result.stdout.strip()).resolve()
    expected_parent = temp_parent.resolve()
    if path.parent != expected_parent or not path.name.startswith(f"{label}."):
        raise RuntimeError("mktemp returned an unexpected path")
    try:
        yield path
    finally:
        if path.is_dir() and path.parent == expected_parent:
            shutil.rmtree(path)


def doctor(repo_root: Path, runtime: RuntimePaths | None = None) -> dict:
    runtime = runtime or RuntimePaths.deployed()
    status_report = inspect_status(repo_root, runtime)
    probes = (
        isolated_runtime_probes(runtime.binary, repo_root)
        if runtime.binary.is_file()
        else {"operation": "rtk.isolated-doctor", "checks": {}, "ok": False}
    )
    checks = {**status_report["checks"], **probes["checks"]}
    return {
        "operation": "rtk.doctor",
        "checks": checks,
        "ok": all(bool(item["ok"]) for item in checks.values()),
    }


def parse_release_refs(text: str) -> list[dict[str, object]]:
    releases: dict[tuple[int, int, int], tuple[bool, dict[str, object]]] = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) != 2 or not fields[1].startswith("refs/tags/"):
            continue
        tag = fields[1].removeprefix("refs/tags/")
        peeled = tag.endswith("^{}")
        tag = tag.removesuffix("^{}")
        match = STABLE_TAG.fullmatch(tag)
        if not match or not COMMIT.fullmatch(fields[0]):
            continue
        version_tuple = tuple(int(value) for value in match.groups())
        existing = releases.get(version_tuple)
        if existing is None or peeled:
            releases[version_tuple] = (
                peeled,
                {
                    "tag": tag,
                    "version": ".".join(match.groups()),
                    "commit": fields[0],
                },
            )
    return [releases[key][1] for key in sorted(releases)]


def update_dry_run(repo_root: Path, refs_file: Path | None = None) -> dict:
    provenance = load_json(repo_root / "docs" / "provenance" / "rtk-termux-build.json")
    source = provenance["source"]
    if refs_file:
        refs = refs_file.read_text(encoding="utf-8")
        origin = "fixture"
    else:
        result = subprocess.run(
            ["git", "ls-remote", "--tags", source["repository"]],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if result.returncode:
            raise RuntimeError("candidate discovery failed; no state was changed")
        refs = result.stdout
        origin = "upstream"
    releases = parse_release_refs(refs)
    if not releases:
        raise RuntimeError("candidate discovery returned no stable release tags")
    candidate = releases[-1]
    current_tuple = tuple(int(value) for value in provenance["artifact"]["version"].split("."))
    candidate_tuple = tuple(int(value) for value in candidate["version"].split("."))
    return {
        "operation": "rtk.update.dry-run",
        "source": origin,
        "current": {
            "tag": source["tag"],
            "version": provenance["artifact"]["version"],
            "commit": source["commit"],
        },
        "candidate": candidate,
        "update_available": candidate_tuple > current_tuple,
        "review_required": True,
        "mutations": [],
        "ok": True,
    }


def validate_candidate(binary: Path, expected_sha256: str, expected_version: str | None) -> dict:
    actual_sha = sha256_file(binary)
    version_ok, version = binary_version(binary)
    identity = elf_identity(binary)
    ok = bool(
        actual_sha == expected_sha256
        and version_ok
        and (expected_version is None or version == expected_version)
        and identity.get("format") == "ELF64"
        and identity.get("machine") == "AArch64"
        and identity.get("interpreter") == "/system/bin/linker64"
    )
    return {
        "ok": ok,
        "version": version,
        "sha256_match": actual_sha == expected_sha256,
        "native_android_elf": bool(
            identity.get("format") == "ELF64"
            and identity.get("machine") == "AArch64"
            and identity.get("interpreter") == "/system/bin/linker64"
        ),
    }


def rehearse_atomic_switch(
    baseline: Path,
    candidate: Path,
    stage_dir: Path,
    validator: Callable[[Path], bool],
) -> dict[str, object]:
    active = stage_dir / "rtk"
    previous = stage_dir / "rtk.previous"
    staged_candidate = stage_dir / "rtk.candidate"
    shutil.copy2(baseline, active)
    shutil.copy2(candidate, staged_candidate)
    baseline_sha = sha256_file(active)
    candidate_sha = sha256_file(staged_candidate)
    shutil.copy2(active, previous)
    switched = False
    candidate_valid = False
    try:
        os.replace(staged_candidate, active)
        switched = sha256_file(active) == candidate_sha
        candidate_valid = validator(active)
    finally:
        if previous.exists():
            os.replace(previous, active)
    rollback_ok = sha256_file(active) == baseline_sha
    return {
        "switched": switched,
        "candidate_valid": candidate_valid,
        "rollback_ok": rollback_ok,
        "baseline_sha256": baseline_sha,
        "candidate_sha256": candidate_sha,
    }


def source_candidate(
    source: Path,
    expected_commit: str,
) -> Path:
    if not source.is_absolute() or not source.is_dir():
        raise RuntimeError("source must be an existing absolute directory")
    if not COMMIT.fullmatch(expected_commit):
        raise RuntimeError("expected commit must be a lowercase 40-hex identity")
    head = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if head.returncode or head.stdout.strip() != expected_commit:
        raise RuntimeError("reviewed source commit does not match")
    status_result = subprocess.run(
        ["git", "-C", str(source), "status", "--porcelain", "--untracked-files=all"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if status_result.returncode or status_result.stdout.strip():
        raise RuntimeError("reviewed source has tracked modifications")
    if not (source / "Cargo.lock").is_file():
        raise RuntimeError("reviewed source has no Cargo.lock")
    build = subprocess.run(
        ["cargo", "build", "--release", "--locked"],
        cwd=source,
        capture_output=True,
        timeout=1800,
        env={**os.environ, "RTK_TELEMETRY_DISABLED": "1"},
    )
    if build.returncode:
        raise RuntimeError("locked native source build failed; rerun it raw for diagnosis")
    candidate = source / "target" / "release" / "rtk"
    if not candidate.is_file():
        raise RuntimeError("locked build produced no RTK candidate")
    return candidate


def rehearse(
    repo_root: Path,
    expected_sha256: str,
    expected_version: str | None,
    source: Path | None,
    expected_commit: str | None,
    candidate_binary: Path | None,
    baseline: Path | None = None,
) -> dict:
    if not SHA256.fullmatch(expected_sha256):
        raise RuntimeError("expected SHA-256 must be lowercase 64-hex")
    if source:
        if not expected_commit:
            raise RuntimeError("--expected-commit is required with --source")
        candidate = source_candidate(source, expected_commit)
        candidate_origin = "locked-native-source-build"
    elif candidate_binary:
        candidate = candidate_binary
        candidate_origin = "reviewed-binary"
    else:
        raise RuntimeError("one candidate source is required")
    if not candidate.is_absolute() or not candidate.is_file():
        raise RuntimeError("candidate binary must be an existing absolute path")
    baseline = baseline or RuntimePaths.deployed().binary
    if not baseline.is_file():
        raise RuntimeError("recoverable baseline binary is unavailable")

    candidate_result = validate_candidate(candidate, expected_sha256, expected_version)
    if not candidate_result["ok"]:
        raise RuntimeError("candidate identity or native Android validation failed")

    with task_temp_dir("rtk-rehearsal") as temp:
        stage_dir = temp / "stage"
        stage_dir.mkdir(mode=0o700)
        switch = rehearse_atomic_switch(
            baseline,
            candidate,
            stage_dir,
            lambda path: validate_candidate(path, expected_sha256, expected_version)["ok"],
        )
        isolated = isolated_runtime_probes(candidate, repo_root)
        policy = temp / "RTK.md"
        config = temp / "config.toml"
        shutil.copyfile(repo_root / "config" / "rtk" / "RTK.md", policy)
        shutil.copyfile(repo_root / "config" / "rtk" / "config.toml", config)
        policy_before = sha256_file(policy)
        with policy.open("ab") as handle:
            handle.write(b"\n# synthetic upstream replacement attempt\n")
        drift_detected = sha256_file(policy) != policy_before
        shutil.copyfile(repo_root / "config" / "rtk" / "RTK.md", policy)
        restored_template = sha256_file(policy) == policy_before
        ok = bool(
            switch["switched"]
            and switch["candidate_valid"]
            and switch["rollback_ok"]
            and isolated["ok"]
            and drift_detected
            and restored_template
        )
        return {
            "operation": "rtk.rehearse",
            "candidate_origin": candidate_origin,
            "candidate": candidate_result,
            "isolated_doctor": isolated,
            "staged_switch": {
                "switched": switch["switched"],
                "candidate_valid": switch["candidate_valid"],
                "rollback_ok": switch["rollback_ok"],
            },
            "template_drift_detected": drift_detected,
            "template_restored": restored_template,
            "active_paths_changed": False,
            "ok": ok,
        }


def render(report: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return
    print(f"{report['operation']}: {'PASS' if report.get('ok', True) else 'FAIL'}")
    for name, item in report.get("checks", {}).items():
        print(f"{'PASS' if item['ok'] else 'FAIL'} {name}: {item['detail']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Operate the pinned RTK Termux capability")
    parser.add_argument("--repo-root", type=Path, required=True, help=argparse.SUPPRESS)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("status", "doctor"):
        child = subparsers.add_parser(name)
        child.add_argument("--json", action="store_true")
    update = subparsers.add_parser("update")
    update.add_argument("--dry-run", action="store_true", required=True)
    update.add_argument("--refs-file", type=Path, help=argparse.SUPPRESS)
    update.add_argument("--json", action="store_true")
    rehearsal = subparsers.add_parser("rehearse")
    candidate = rehearsal.add_mutually_exclusive_group(required=True)
    candidate.add_argument("--source", type=Path)
    candidate.add_argument("--candidate-binary", type=Path)
    rehearsal.add_argument("--expected-commit")
    rehearsal.add_argument("--expected-sha256", required=True)
    rehearsal.add_argument("--expected-version")
    rehearsal.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    ns = build_parser().parse_args()
    repo_root = ns.repo_root.resolve()
    try:
        if ns.command == "status":
            report = inspect_status(repo_root)
        elif ns.command == "doctor":
            report = doctor(repo_root)
        elif ns.command == "update":
            report = update_dry_run(repo_root, ns.refs_file)
        else:
            report = rehearse(
                repo_root=repo_root,
                expected_sha256=ns.expected_sha256,
                expected_version=ns.expected_version,
                source=ns.source.resolve() if ns.source else None,
                expected_commit=ns.expected_commit,
                candidate_binary=ns.candidate_binary.resolve() if ns.candidate_binary else None,
            )
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        report = {"operation": f"rtk.{ns.command}", "ok": False, "error": str(exc)}
    render(report, ns.json)
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
