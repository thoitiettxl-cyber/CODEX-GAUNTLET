# Keep ripgrep native on Termux

Use this runbook when `rg` fails under Codex, resolves below `codex-path`, or
needs recovery after a shell or Codex launcher change.

## Authority and scope

- Durable inventory: `docs/inventory/rg.json`.
- Native executable: `/data/data/com.termux/files/usr/bin/rg`, owned by the
  Termux `ripgrep` package.
- User-level compatibility points: `~/.bashrc` and `~/.local/bin/codex`.
- Executable repository pass/fail: `./qa/verify` only.

Do not install a generic GNU/Linux AArch64 ripgrep binary on Android. Do not
replace the copy below the npm-managed Codex package: a Codex update can
overwrite it.

## Cause and supported resolution

Codex prepends its package-local `codex-path` directory to command `PATH`. The
bundled `rg` is a GNU/Linux ELF that requests `/lib/ld-linux-aarch64.so.1`, so
Android cannot execute it. Termux's native binary instead requests Android's
linker and runs normally.

Changing ordinary `PATH` order is insufficient because Codex adds its helper
ahead of the caller's paths. The supported user-level fix exports a Bash
function named `rg` from both shell startup and the Termux Codex launcher:

```bash
rg() {
  command /data/data/com.termux/files/usr/bin/rg "$@"
}
export -f rg
```

Function resolution precedes executable lookup and preserves every argument
boundary through `"$@"`. The copy in `~/.bashrc` covers normal Bash sessions.
The copy in `~/.local/bin/codex` covers Codex started without an already
configured interactive shell.

## Inspect

Use the absolute native path while diagnosing a broken resolution:

```bash
type -a rg
file /data/data/com.termux/files/usr/bin/rg
/data/data/com.termux/files/usr/bin/rg --version
dpkg -S /data/data/com.termux/files/usr/bin/rg
bash -n "$HOME/.bashrc"
bash -n "$HOME/.local/bin/codex"
```

Expected native identity:

- `ELF64`, `AArch64`;
- Android interpreter `/system/bin/linker64`;
- package owner `ripgrep`.

Do not print full shell configuration while inspecting it because startup
files may contain credentials.

## Verify the compatibility fix

Open a new login shell and run:

```bash
bash -lc 'type -t rg'
bash -lc 'rg --version'
printf 'alpha beta\n' | bash -lc "rg --fixed-strings 'alpha beta'"
"$HOME/.local/bin/codex" --version
```

The first command must print `function`, the version must be real, the quoted
search must match, and the Codex wrapper must still start. A Codex process that
was already running before the fix retains its old environment; start a new
Codex session before judging the exported function absent.

## Update and drift

Termux updates the native binary through its `ripgrep` package. Codex npm
updates may replace the incompatible package-local helper, but they do not own
the exported function in `~/.bashrc` or the user-level Termux launcher.

After changing either shell file, rerun the syntax and login-shell checks
above. If `~/.local/bin/codex` is replaced, restore its Termux CA defaults and
the exported `rg` function before using it as the primary launcher.

## Recovery

To remove this compatibility behavior, delete only the documented `rg`
function and its `export -f rg` line from `~/.bashrc` and
`~/.local/bin/codex`, then start a new shell and Codex session. In an existing
interactive Bash shell, `unset -f rg` removes the imported function for that
shell only.

Recovery restores Codex's default resolution, which is known to select the
incompatible GNU/Linux helper on this Termux platform. The Termux `ripgrep`
package and `/data/data/com.termux/files/usr/bin/rg` remain unchanged.
