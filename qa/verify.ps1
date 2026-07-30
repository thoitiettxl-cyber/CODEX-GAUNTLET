param(
    [ValidateSet("targeted", "stop", "ci", "audit")]
    [string]$Mode = "targeted",
    [string]$Base,
    [string]$WorkContext
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$python = Get-Command python -ErrorAction Stop
$arguments = @((Join-Path $root "qa/verify_v6.py"), "--mode", $Mode)
if (![string]::IsNullOrWhiteSpace($Base)) {
    $arguments += @("--base", $Base)
}
if (![string]::IsNullOrWhiteSpace($WorkContext)) {
    $arguments += @("--work-context", $WorkContext)
}
& $python.Source @arguments
exit $LASTEXITCODE
