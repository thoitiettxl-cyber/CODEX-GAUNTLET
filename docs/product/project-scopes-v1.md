# Project scopes v1

## Purpose

Resolve a named project to one exact local scope before Codex inspects or
changes it. Scope resolution provides discovery only; it never grants mutation
authority or proves project state.

## Sources

- In-repository projects live at `projects/<id>/`.
- External projects are declared in `scopes/external.json` with a stable `id`,
  optional `aliases`, an absolute Windows `root`, and one relative
  `entrypoint` owned by that project.

Operational commands, credentials, policy, and target state remain in the
project entrypoint or target system and must not be duplicated in the external
scope registry.

## Resolution

1. Use `projects/<id>/` when that exact in-repository directory exists.
2. Otherwise, match exactly one external scope by `id` or `alias`.
3. Require an absolute external root. Resolve the entrypoint below that root,
   verify both paths exist, and read the entrypoint before operating.
4. If the scope is missing or ambiguous, stop before mutation and request an
   exact path or binding.

Do not scan unrelated filesystem roots or use web search to locate a local
project unless the user explicitly requests that discovery. Harness remains
the lifecycle authority, external targets own their actual state, and
`qa/verify.ps1` remains the repository definition-of-pass.
