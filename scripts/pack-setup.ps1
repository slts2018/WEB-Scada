#Requires -Version 5.1
<#
  打包绿色版 + 编译 Inno Setup 安装包（Setup.exe）
  Spring Boot + 内嵌 JRE + MariaDB + InfluxDB
#>
param()

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

$packScript = Join-Path $PSScriptRoot 'pack-windows.ps1'
Write-Host '==> pack with Spring Boot + portable JRE + MariaDB + InfluxDB'
$env:SCADA_BUNDLE_JRE = '1'
$env:SCADA_BUNDLE_MYSQL = '1'
$env:SCADA_BUNDLE_INFLUX = '1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $packScript -IncludeJava
if ($LASTEXITCODE -ne 0) { throw 'pack-windows failed' }
$sourceRel = 'release\WebScada-0.1.0-win-x64-java'
$setupSuffix = ''
$sourceAbs = Join-Path $Root $sourceRel
if (-not (Test-Path $sourceAbs)) { throw "pack output missing: $sourceAbs" }

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
# Inno #define paths are relative to the .iss file location (packaging/)
$sourceForIss = '..\' + ($sourceRel -replace '/', '\')
Write-Host "==> compile $iss  SourceDir=$sourceForIss"
& $iscc "/DSourceDir=$sourceForIss" "/DSetupSuffix=$setupSuffix" $iss
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }

$setupName = if ($setupSuffix) { "WebScada-Setup-0.1.0$setupSuffix.exe" } else { 'WebScada-Setup-0.1.0.exe' }
$setup = Join-Path $Root "release\$setupName"
Write-Host ''
Write-Host "OK: $setup"
