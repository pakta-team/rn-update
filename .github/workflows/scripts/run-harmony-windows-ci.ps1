<#
[INPUT]: 依赖隔离 checkout、固定候选/HAR 摘要、显式 DevEco/WSL/HDC 与工程外签名文件
[OUTPUT]: 在全新短工程中串行执行共享 Harmony 阶段，仅保存输入 JSON 与命令日志
[POS]: Windows 临时 runner 编排边界；不覆盖主工作树或已有签名工程，不注册 runner 或触发 Actions
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
#>
[CmdletBinding()]
param([switch]$PlanOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$CandidateSha = '4818abacdfd97e308b80f8f8bbbb96ade221d58f1135e0a703d7b5069cc06cbf'
$HarSha = '92bb0c023ca9a4c2160a7ed20db8ea19bf7437b7eac8f2e64733f592935bc9ff'
$ExpectedProject = 'D:\r\hw1115'

function Require-Environment([string]$Name) {
    $Value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "Missing required environment: $Name" }
    return $Value
}

function Full-Path([string]$Value) {
    if (-not [IO.Path]::IsPathFullyQualified($Value)) { throw 'An absolute path is required' }
    return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/')
}

function Is-Inside([string]$Root, [string]$Child) {
    return $Child.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or
        $Child.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Require-PhysicalFile([string]$File) {
    $Item = Get-Item -LiteralPath $File
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Input must be a physical regular file'
    }
}

function Require-Digest([string]$File, [string]$Expected) {
    Require-PhysicalFile $File
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw 'Input SHA-256 differs from the fixed validation candidate'
    }
}

# ---------- 只读预检：实际运行前不接触设备、不复制签名 ----------
$Workspace = Full-Path (Require-Environment 'GITHUB_WORKSPACE')
$Repo = Full-Path (Join-Path $PSScriptRoot '../../..')
$ExpectedCheckout = Full-Path (Join-Path $Workspace 'source')
if ($Repo -ne $ExpectedCheckout -or (Get-Item -LiteralPath $Repo).LinkType) {
    throw 'Harmony CI must run from the physical source/ checkout inside its runner workspace'
}
$Project = Full-Path (Require-Environment 'RNU_HARMONY_PROJECT')
if ($Project -ne $ExpectedProject -or (Is-Inside $Workspace $Project)) {
    throw 'Harmony CI requires the dedicated external D:\r\hw1115 project'
}
if (Test-Path -LiteralPath $Project) { throw 'Refusing to overwrite an existing Harmony project' }
$Signing = Full-Path (Require-Environment 'RNU_HARMONY_SIGNING_FILE')
Require-PhysicalFile $Signing
if ((Is-Inside $Workspace $Signing) -or (Is-Inside $Project $Signing)) {
    throw 'Signing input must remain outside the checkout and target project'
}
$Candidate = Full-Path (Require-Environment 'RNU_HARMONY_SDK_TGZ')
$Har = Full-Path (Require-Environment 'RNU_HARMONY_HAR_PATH')
if ((Require-Environment 'RNU_HARMONY_SDK_SHA256') -ne $CandidateSha -or
    (Require-Environment 'RNU_HARMONY_HAR_SHA256') -ne $HarSha) {
    throw 'Explicit candidate and HAR digests must match this validation run'
}
Require-Digest $Candidate $CandidateSha
Require-Digest $Har $HarSha
$null = Require-Environment 'HDC_TARGET'
$null = Require-Environment 'DEVECO_STUDIO_HOME'
Require-PhysicalFile (Full-Path (Require-Environment 'HDC_PATH'))
$null = Require-Environment 'RNU_WSL_HDIFF_ROOT'
$Sdk = Join-Path $Repo 'rn-update'
$E2e = Join-Path $Sdk 'Example/e2etest'
$App = Join-Path $Sdk 'Example/harmony_use_pakta'
$SourceProject = Join-Path $App 'harmony'
$Cli = Join-Path $Repo 'rn-update-cli'
foreach ($File in @('hvigorfile.ts', 'build-profile.json5', 'entry/build-profile.json5')) {
    Require-PhysicalFile (Join-Path $SourceProject $File)
}
$Phases = @('stage', 'sync', 'prepare', 'base', 'build', 'diff', 'check', 'install', 'test')
$Plan = [ordered]@{
    checkout = $Repo; project = $Project; candidateSha256 = $CandidateSha; harSha256 = $HarSha
    phases = $Phases; copySigning = 'external input to ignored signing.local.json5'
    nodeDependencies = 'frozen locks; physical SDK copy'; artifactPolicy = 'explicit input JSON and logs only'
}
if ($PlanOnly) { $Plan | ConvertTo-Json -Depth 4; exit 0 }

# ---------- 实跑：独占测试端口与新短工程，复用现有阶段门卫 ----------
if (Get-NetTCPConnection -LocalPort 31337 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 31337 is already in use; do not interrupt another platform run'
}
$LogRoot = Join-Path $E2e '.e2e-artifacts/harmony-ci'
$null = New-Item -ItemType Directory -Path $LogRoot -Force
$Plan | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $LogRoot 'plan.json') -Encoding utf8NoBOM

function Invoke-Logged([string]$Name, [string]$Directory, [string]$Command, [string[]]$Arguments) {
    Push-Location -LiteralPath $Directory
    try {
        & $Command @Arguments 2>&1 | Tee-Object -FilePath (Join-Path $LogRoot "$Name.log")
        if ($LASTEXITCODE -ne 0) { throw "$Name exited $LASTEXITCODE" }
    } finally { Pop-Location }
}

function Copy-ProjectTree([string]$Source, [string]$Destination) {
    $Ignored = @('node_modules', 'oh_modules', 'build', '.hvigor', '.cxx', '.git',
        'local-signing', 'local.properties', 'signing.local.json5')
    $null = New-Item -ItemType Directory -Path $Destination
    foreach ($Item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($Item.Name -in $Ignored) { continue }
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Refusing a linked source Harmony project member'
        }
        $Target = Join-Path $Destination $Item.Name
        if ($Item.PSIsContainer) { Copy-ProjectTree $Item.FullName $Target }
        else { Copy-Item -LiteralPath $Item.FullName -Destination $Target }
    }
}

$Entry = Join-Path $E2e 'scripts/run-harmony-e2e.js'
$env:RNU_CLI_ROOT = $Cli
$env:RNU_E2E_SKIP_PREPARE = 'false'
$env:RNU_HARMONY_REUSE_DEPENDENCIES = '0'
$env:RNU_METRO_MAX_WORKERS = '1'
$LinuxCli = & wsl.exe --exec wslpath -a -u $Cli
if ($LASTEXITCODE -ne 0 -or -not $LinuxCli) { throw 'Cannot resolve the current checkout CLI in WSL' }
$env:RNU_WSL_CLI_ROOT = $LinuxCli.Trim()
try {
    Invoke-Logged 'stage' $E2e 'node' @($Entry, 'stage')
    Invoke-Logged 'install-e2e' $E2e 'bun' @('install', '--frozen-lockfile')
    Invoke-Logged 'test-orchestrator' $E2e 'bun' @('run', 'test:harmony-orchestrator')
    Invoke-Logged 'install-app' $App 'bun' @('install', '--frozen-lockfile', '--backend', 'copyfile')
    Invoke-Logged 'install-cli' $Cli 'bun' @('install', '--frozen-lockfile')
    Invoke-Logged 'build-cli' $Cli 'bun' @('run', 'build')
    Invoke-Logged 'sync' $E2e 'node' @($Entry, 'sync')
    Invoke-Logged 'codegen' $App 'bun' @('run', 'codegen')
    $Parent = Split-Path -Parent $Project
    if (-not (Test-Path -LiteralPath $Parent)) { $null = New-Item -ItemType Directory -Path $Parent }
    if ((Get-Item -LiteralPath $Parent).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The short project parent must be a physical directory'
    }
    Copy-ProjectTree $SourceProject $Project
    Copy-Item -LiteralPath $Signing -Destination (Join-Path $Project 'signing.local.json5')
    foreach ($Phase in @('prepare', 'base', 'build', 'diff', 'check', 'install', 'test')) {
        Invoke-Logged $Phase $E2e 'node' @($Entry, $Phase)
    }
} finally {
    # 复用已有 PID 归属门卫，仅回收该 checkout 启动的 Harmony server。
    $Cleanup = "const p=require('node:path'); const s=require('./e2e/harmony/server-process'); s.stopServerFromPidFile(p.resolve('.e2e-artifacts/.server.harmony.pid')).then(()=>{}).catch(()=>process.exitCode=1);"
    Push-Location -LiteralPath $E2e
    try { & node -e $Cleanup 2>&1 | Tee-Object -FilePath (Join-Path $LogRoot 'cleanup.log') }
    finally { Pop-Location }
}
