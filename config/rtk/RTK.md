# RTK - Rust Token Killer for Codex CLI

RTK is an optional lossy output filter. Correctness and repository evidence
always take precedence over token savings.

## When to use RTK

- Use RTK for noisy orientation, test, build, lint, and log output when a
  compact summary is sufficient, for example `rtk cargo test`,
  `rtk cargo build`, `rtk cargo clippy`, `rtk pytest`, or `rtk npm test`.
- `rtk grep`, `rtk find`, `rtk ls`, `rtk git status`, and `rtk git diff` are
  allowed only for initial orientation. Confirm every relevant fact with the
  raw command before editing or reporting.
- Prefix only a supported individual command. Never prefix a compound shell
  script, shell builtin, heredoc, redirection, or pipeline wholesale with
  `rtk`.

## When raw output is mandatory

Run the original command without RTK whenever exact bytes, complete file
bodies, every match, ordering, full diffs, stable JSON, checksums, or
machine-consumable stdout matter. In particular, use raw output for:

- reading repository instructions, product contracts, source, or config that
  will drive an edit;
- final `git status` and `git diff` review;
- repository-mandated verification such as `./qa/verify`;
- mutating commands and any command whose output feeds another command or file.

RTK output alone is never executable verification evidence.

## Raw recovery

- Use `RTK_DISABLED=1 <command>` to force raw execution if an RTK rewrite hook
  is ever active. With the current Codex guidance integration, running the
  original command directly is also raw.
- `rtk proxy <command>` is a raw single-command passthrough.
- `rtk git diff --no-compact` shows the full human-readable diff, but may still
  normalize formatting. Use raw `git diff` when byte-exact output matters.
- If RTK emits `[full output: ...]`, `[see remaining: ...]`,
  `[RTK:PASSTHROUGH]`, a truncation marker, a degraded-parser warning, or an
  ambiguous result, immediately read the referenced raw output or rerun the
  original command raw before continuing.

Local command tracking and network telemetry are disabled. Failure tee files
are private local recovery data and must never be quoted if they contain
secrets.
