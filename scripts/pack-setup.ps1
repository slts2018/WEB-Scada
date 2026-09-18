#Requires -Version 5.1
<#
  内嵌 Node + 编译 Inno Setup 安装包
  用法: pnpm pack:setup
#>
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

Write-Host '==> pack with embedded Node'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pack-windows.ps1') -IncludeNode
if ($LASTEXITCODE -ne 0) { throw 'pack-windows failed' }

$iscc = Join-Path $Root 'release\tools\InnoSetup\ISCC.exe'
if (-not (Test-Path $iscc)) {
  $isccCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  )
  foreach ($c in $isccCandidates) {
    if (Test-Path $c) { $iscc = $c; break }
  }
}
if (-not (Test-Path $iscc)) {
  throw 'ISCC.exe not found. Install Inno Setup 6, or keep release\tools\InnoSetup from previous setup build.'
}

$iss = Join-Path $Root 'packaging\web-scada.iss'
Write-Host "==> compile $iss"
& $iscc $iss
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }

$setup = Join-Path $Root 'release\WebScada-Setup-0.1.0.exe'
Write-Host ''
Write-Host "OK: $setup"
