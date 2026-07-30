param(
    [string]$BuildRoot,
    [switch]$KeepBuildRoot
)

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceRepository = "https://github.com/hoangnb24/repository-harness.git"
$sourceTag = "harness-v0.1.7"
$sourceCommit = "d43b70254308b0e10efed2efbcbe595f1e771f63"
$coreAsset = "harness-windows-x64.exe"
$coreSha256 = "9948fa714ee8e7731c1691f3d84649832571b882d009aaa0c511a0c82086754c"
$releaseBase = "https://github.com/hoangnb24/repository-harness/releases/download/$sourceTag"
$createdBuildRoot = $false

if ($env:CODEX_GAUNTLET_MAINTENANCE -ne "1") {
    throw "Windows Harness build failed: set CODEX_GAUNTLET_MAINTENANCE=1 after reviewing the pinned source identity"
}
if (![System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::Windows)) {
    throw "Windows Harness build failed: this build lane requires native Windows"
}
foreach ($command in @("git", "cargo", "rustc")) {
    if (!(Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Windows Harness build failed: missing required command: $command"
    }
}

if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    $BuildRoot = Join-Path $env:TEMP ("harness-windows-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $BuildRoot | Out-Null
    $createdBuildRoot = $true
} else {
    $BuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
    if (Test-Path -LiteralPath $BuildRoot) {
        if (Get-ChildItem -Force -LiteralPath $BuildRoot | Select-Object -First 1) {
            throw "Windows Harness build failed: BuildRoot must be absent or empty: $BuildRoot"
        }
    } else {
        New-Item -ItemType Directory -Path $BuildRoot | Out-Null
        $createdBuildRoot = $true
    }
}

$source = Join-Path $BuildRoot "source"
$stage = Join-Path $BuildRoot "stage"
$previousRustFlags = [Environment]::GetEnvironmentVariable("RUSTFLAGS", "Process")
$previousEncodedRustFlags = [Environment]::GetEnvironmentVariable(
    "CARGO_ENCODED_RUSTFLAGS", "Process"
)

try {
    & git clone --filter=blob:none --no-checkout $sourceRepository $source
    if ($LASTEXITCODE -ne 0) { throw "Windows Harness build failed: source clone failed" }
    & git -C $source checkout --detach $sourceTag
    if ($LASTEXITCODE -ne 0) { throw "Windows Harness build failed: source checkout failed" }
    $actualCommit = (& git -C $source rev-parse HEAD).Trim()
    if ($actualCommit -ne $sourceCommit) {
        throw "Windows Harness build failed: $sourceTag resolved to unexpected commit $actualCommit"
    }

    $upstreamManifest = Join-Path $source "scripts\harness-cli-install-files.txt"
    $localManifest = Join-Path $repositoryRoot "scripts\harness-cli-install-files.txt"
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $upstreamManifest).Hash -ne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $localManifest).Hash) {
        throw "Windows Harness build failed: pinned CLI payload manifest differs from upstream"
    }

    Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
    $separator = [char]0x1f
    $env:CARGO_ENCODED_RUSTFLAGS = @(
        "-C",
        "link-arg=/Brepro",
        "--remap-path-prefix",
        "$source=."
    ) -join $separator
    & cargo test --locked --manifest-path (Join-Path $source "Cargo.toml") --package harness-cli
    if ($LASTEXITCODE -ne 0) { throw "Windows Harness build failed: upstream CLI tests failed" }
    & cargo build --locked --release --manifest-path (Join-Path $source "Cargo.toml") --package harness-cli
    if ($LASTEXITCODE -ne 0) { throw "Windows Harness build failed: release build failed" }

    New-Item -ItemType Directory -Path $stage | Out-Null
    $builtCli = Join-Path $source "target\release\harness-cli.exe"
    $stagedHarness = Join-Path $stage "harness.exe"
    $stagedCli = Join-Path $stage "harness-cli.exe"
    $checksumFile = Join-Path $stage "$coreAsset.sha256"
    Invoke-WebRequest -Uri "$releaseBase/$coreAsset" -OutFile $stagedHarness
    Invoke-WebRequest -Uri "$releaseBase/$coreAsset.sha256" -OutFile $checksumFile
    $releaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stagedHarness).Hash.ToLowerInvariant()
    $declaredHash = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
    if ($releaseHash -ne $coreSha256 -or $declaredHash -ne $releaseHash) {
        throw "Windows Harness build failed: release core checksum mismatch"
    }
    Copy-Item -LiteralPath $builtCli -Destination $stagedCli

    if ((& $stagedHarness --version).Trim() -ne "harness 0.1.7") {
        throw "Windows Harness build failed: staged Harness version mismatch"
    }
    if ((& $stagedCli --version).Trim() -ne "harness-cli 0.1.23") {
        throw "Windows Harness build failed: staged Harness CLI version mismatch"
    }

    $destination = Join-Path $repositoryRoot "scripts\bin"
    Copy-Item -LiteralPath $stagedHarness -Destination (Join-Path $destination "harness.exe") -Force
    Copy-Item -LiteralPath $stagedCli -Destination (Join-Path $destination "harness-cli.exe") -Force

    $harnessHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stagedHarness).Hash.ToLowerInvariant()
    $cliHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stagedCli).Hash.ToLowerInvariant()
    Write-Host "PASS: staged official Windows Harness core and built CLI from $sourceTag ($sourceCommit)"
    Write-Host "harness.exe sha256=$harnessHash"
    Write-Host "harness-cli.exe sha256=$cliHash"
} finally {
    if ($null -eq $previousRustFlags) {
        Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
    } else {
        $env:RUSTFLAGS = $previousRustFlags
    }
    if ($null -eq $previousEncodedRustFlags) {
        Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue
    } else {
        $env:CARGO_ENCODED_RUSTFLAGS = $previousEncodedRustFlags
    }
    if ($createdBuildRoot -and !$KeepBuildRoot -and (Test-Path -LiteralPath $BuildRoot)) {
        $resolvedBuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
        $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
        if (!$resolvedBuildRoot.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing cleanup outside the Windows temp directory: $resolvedBuildRoot"
        }
        Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
    }
}
