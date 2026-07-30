param(
    [Parameter(Position = 0)]
    [string]$Command,
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$cli = Join-Path $root "scripts\bin\harness-cli.exe"
$core = Join-Path $root "scripts\bin\harness.exe"
$database = if ([string]::IsNullOrWhiteSpace($env:HARNESS_DB_PATH)) {
    Join-Path $root "harness.windows.db"
} else {
    [System.IO.Path]::GetFullPath($env:HARNESS_DB_PATH)
}
$changesets = Join-Path $root ".harness\changesets"
$python = (Get-Command python -ErrorAction Stop).Source
$env:HARNESS_REPO_ROOT = $root
$env:HARNESS_DB_PATH = $database
$script:CliExitCode = 0

function Show-Usage {
    [Console]::Error.WriteLine(
        "Usage: scripts/windows-control.ps1 {status|doctor|verify|rebuild-harness|orchestrator|continuity}"
    )
}

function Invoke-Cli([string[]]$CliArguments) {
    & $cli @CliArguments
    $script:CliExitCode = $LASTEXITCODE
}

function Requires-RunId([string[]]$CliArguments) {
    if (!$CliArguments -or $CliArguments -contains "-h" -or
        $CliArguments -contains "--help" -or $CliArguments[0] -eq "help") {
        return $false
    }
    switch ($CliArguments[0]) {
        "story" { return $true }
        "intake" { return $true }
        "decision" { return $true }
        "tool" { return $true }
        "intervention" { return $true }
        "trace" { return $true }
        "import" { return $true }
        "backlog" {
            return !($CliArguments -contains "--dry-run") -or
                ($CliArguments -contains "--apply")
        }
        "audit" { return $CliArguments -contains "--record-evidence" }
        "propose" {
            return ($CliArguments -contains "--accept") -or
                ($CliArguments -contains "--reject")
        }
        default { return $false }
    }
}

switch ($Command) {
    "status" {
        Write-Output "control_plane=$root"
        Write-Output "platform=$([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
        & $core --version
        & $cli --version
        & $python (Join-Path $root "qa\check_harness.py") --skip-doctor-command
        exit $LASTEXITCODE
    }
    "doctor" {
        & $python (Join-Path $root "qa\check_harness.py") --skip-doctor-command
        exit $LASTEXITCODE
    }
    "verify" {
        & (Join-Path $root "qa\verify.ps1") @Arguments
        exit $LASTEXITCODE
    }
    "rebuild-harness" {
        & (Join-Path $root "scripts\build-harness-windows.ps1") @Arguments
        exit $LASTEXITCODE
    }
    "continuity" {
        & $python (Join-Path $root "scripts\continuity_cli.py") --repo-root $root @Arguments
        exit $LASTEXITCODE
    }
    "orchestrator" {
        $subcommand = if ($Arguments) { $Arguments[0] } else { "status" }
        if ($subcommand -eq "init") {
            if (!(Test-Path -LiteralPath $database) -and
                (Get-ChildItem -LiteralPath $changesets -Filter "*.changeset.jsonl" | Select-Object -First 1)) {
                Invoke-Cli @("db", "rebuild", "--from", $changesets)
                exit $script:CliExitCode
            }
            & (Join-Path $root "scripts\bootstrap-harness.ps1") -Database $database -Cli $cli
            exit $LASTEXITCODE
        }
        if ($subcommand -eq "rebuild") {
            if (Test-Path -LiteralPath $database) {
                [Console]::Error.WriteLine(
                    "FAIL: move the existing database aside before rebuild: $database"
                )
                exit 1
            }
            if (!(Get-ChildItem -LiteralPath $changesets -Filter "*.changeset.jsonl" | Select-Object -First 1)) {
                [Console]::Error.WriteLine(
                    "FAIL: no semantic changesets found in $changesets"
                )
                exit 1
            }
            Invoke-Cli @("db", "rebuild", "--from", $changesets)
            exit $script:CliExitCode
        }
        if ($subcommand -eq "status") {
            $contractJson = & $cli query contract --json
            $contractJson
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            $contract = $contractJson | ConvertFrom-Json
            if ($contract.result.database_state -eq "current") {
                Invoke-Cli @("query", "work-graph", "--json")
                exit $script:CliExitCode
            }
            exit 0
        }
        if ((Requires-RunId $Arguments) -and
            [string]::IsNullOrWhiteSpace($env:HARNESS_RUN_ID)) {
            [Console]::Error.WriteLine(
                "FAIL: set a stable HARNESS_RUN_ID before mutating Harness state."
            )
            exit 2
        }
        Invoke-Cli $Arguments
        exit $script:CliExitCode
    }
    default {
        Show-Usage
        exit 2
    }
}
