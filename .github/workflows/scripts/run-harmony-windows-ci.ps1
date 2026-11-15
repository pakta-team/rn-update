<#
[INPUT]: 依赖隔离 checkout、本次显式候选/HAR 摘要与独立公开 CLI、显式 DevEco/WSL/HDC 与工程外签名文件
[OUTPUT]: 在两个全新短工程串行执行原九项及 healthy/crash 原生场景，隔离保存输入/日志/HAP
[POS]: Windows 临时 runner 编排边界；不覆盖主工作树或已有签名工程，不注册 runner 或触发 Actions
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
#>
[CmdletBinding()]
param([switch]$PlanOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

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
        throw 'Input SHA-256 differs from the explicitly selected validation input'
    }
}

# ---------- 只读预检：实际运行前不接触设备、不复制签名 ----------
$CandidateSha = (Require-Environment 'RNU_HARMONY_SDK_SHA256').ToLowerInvariant()
$HarSha = (Require-Environment 'RNU_HARMONY_HAR_SHA256').ToLowerInvariant()
if ($CandidateSha -notmatch '^[0-9a-f]{64}$' -or $HarSha -notmatch '^[0-9a-f]{64}$') {
    throw 'Explicit SDK and HAR SHA-256 values are required'
}
$Workspace = Full-Path (Require-Environment 'GITHUB_WORKSPACE')
$Repo = Full-Path (Join-Path $PSScriptRoot '../../..')
$ExpectedCheckout = Full-Path (Join-Path $Workspace 'source')
if ($Repo -ne $ExpectedCheckout -or (Get-Item -LiteralPath $Repo).LinkType) {
    throw 'Harmony CI must run from the physical source/ checkout inside its runner workspace'
}
$Project = Full-Path (Require-Environment 'RNU_HARMONY_PROJECT')
if (Is-Inside $Workspace $Project) {
    throw 'Harmony CI requires a new short project outside the checkout without overwriting the checkout'
}
if (Test-Path -LiteralPath $Project) { throw 'Refusing to overwrite an existing Harmony project' }
$NativeProject = Full-Path (Require-Environment 'RNU_HARMONY_NATIVE_PROJECT')
if ((Is-Inside $Workspace $NativeProject) -or
    (Is-Inside $Project $NativeProject) -or (Is-Inside $NativeProject $Project)) {
    throw 'Native validation requires a separate new short external project without overlap'
}
if (Test-Path -LiteralPath $NativeProject) { throw 'Refusing to overwrite an existing native project' }
$Signing = Full-Path (Require-Environment 'RNU_HARMONY_SIGNING_FILE')
Require-PhysicalFile $Signing
if ((Is-Inside $Workspace $Signing) -or (Is-Inside $Project $Signing) -or
    (Is-Inside $NativeProject $Signing)) {
    throw 'Signing input must remain outside the checkout and target project'
}
$Candidate = Full-Path (Require-Environment 'RNU_HARMONY_SDK_TGZ')
$Har = Full-Path (Require-Environment 'RNU_HARMONY_HAR_PATH')
Require-Digest $Candidate $CandidateSha
Require-Digest $Har $HarSha
$null = Require-Environment 'HDC_TARGET'
$null = Require-Environment 'DEVECO_STUDIO_HOME'
Require-PhysicalFile (Full-Path (Require-Environment 'HDC_PATH'))
$null = Require-Environment 'RNU_WSL_HDIFF_ROOT'
$Sdk = $Repo
$E2e = Join-Path $Sdk 'Example/e2etest'
$App = Join-Path $Sdk 'Example/harmony_use_pakta'
$SourceProject = Join-Path $App 'harmony'
$Cli = Full-Path (Require-Environment 'RNU_CLI_ROOT')
Require-PhysicalFile (Join-Path $Cli 'package.json')
Require-PhysicalFile (Join-Path $Cli 'lib/bin.js')
foreach ($File in @('hvigorfile.ts', 'build-profile.json5', 'entry/build-profile.json5')) {
    Require-PhysicalFile (Join-Path $SourceProject $File)
}
$Phases = @('stage', 'sync', 'prepare', 'base', 'build', 'diff', 'check', 'install', 'test')
$Plan = [ordered]@{
    checkout = $Repo; project = $Project; nativeProject = $NativeProject
    nativeVariants = @('healthy', 'crash'); candidateSha256 = $CandidateSha; harSha256 = $HarSha
    phases = $Phases; copySigning = 'external input to ignored signing.local.json5'
    nodeDependencies = 'frozen locks; physical SDK copy'
    artifactPolicy = 'explicit JSON/logs; native HAP separated by variant, no signing input upload'
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
if ($LASTEXITCODE -ne 0 -or -not $LinuxCli) { throw 'Cannot resolve the independent public CLI checkout in WSL' }
$env:RNU_WSL_CLI_ROOT = $LinuxCli.Trim()
try {
    Invoke-Logged 'stage' $E2e 'node' @($Entry, 'stage')
    Invoke-Logged 'install-e2e' $E2e 'bun' @('install', '--frozen-lockfile')
    Invoke-Logged 'test-orchestrator' $E2e 'bun' @('run', 'test:harmony-orchestrator')
    Invoke-Logged 'install-app' $App 'bun' @('install', '--frozen-lockfile', '--backend', 'copyfile')
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
    # ---------- 原九项证据封存后才创建独立原生工程，两个场景按序运行 ----------
    Copy-ProjectTree $SourceProject $NativeProject
    Copy-Item -LiteralPath $Signing -Destination (Join-Path $NativeProject 'signing.local.json5')
    $NativeEntry = Join-Path $E2e 'scripts/run-harmony-native-e2e.js'
    $env:RNU_HARMONY_REUSE_DEPENDENCIES = '0'
    Invoke-Logged 'native-healthy' $E2e 'node' @($NativeEntry, 'healthy', 'all')
    $env:RNU_HARMONY_REUSE_DEPENDENCIES = '1'
    Invoke-Logged 'native-crash' $E2e 'node' @($NativeEntry, 'crash', 'all')
} finally {
    # 复用已有 PID 归属门卫，仅回收该 checkout 启动的 Harmony server。
    $Cleanup = "const p=require('node:path'); const s=require('./e2e/harmony/server-process'); s.stopServerFromPidFile(p.resolve('.e2e-artifacts/.server.harmony.pid')).then(()=>{}).catch(()=>process.exitCode=1);"
    Push-Location -LiteralPath $E2e
    try { & node -e $Cleanup 2>&1 | Tee-Object -FilePath (Join-Path $LogRoot 'cleanup.log') }
    finally { Pop-Location }
}
