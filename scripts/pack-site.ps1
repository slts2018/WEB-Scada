#Requires -Version 5.1
<#
  Build a deployable Site package (Runtime-first) with one project embedded.
  Usage:
    pnpm pack:site
    pnpm pack:site -- -ProjectId prj_xxx
    pnpm pack:site -- -SkipPack -ProjectId prj_xxx   # reuse existing win-x64-java folder
#>
param(
  [string]$ProjectId = '',
  [switch]$SkipPack
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

$Version = '0.1.0'
$BaseName = "WebScada-$Version-win-x64-java"
$SiteName = "WebScada-Site-$Version-win-x64"
$ReleaseRoot = Join-Path $Root 'release'
$BaseDir = Join-Path $ReleaseRoot $BaseName
$OutDir = Join-Path $ReleaseRoot $SiteName
$Tpl = Join-Path $Root 'packaging\templates'
$DataRoot = Join-Path $Root 'apps\data'

if (-not $SkipPack) {
  Write-Host '==> pack base (Spring Boot)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pack-windows.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'pack-windows failed' }
}

if (-not (Test-Path (Join-Path $BaseDir 'server.jar'))) {
  throw "Base pack missing: $BaseDir (run without -SkipPack, or pnpm pack:win first)"
}

Write-Host "==> prepare site dir $OutDir"
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir | Out-Null

# Copy all except data (we rebuild data for one project)
Get-ChildItem -LiteralPath $BaseDir -Force | ForEach-Object {
  if ($_.Name -eq 'data') { return }
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $OutDir $_.Name) -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $OutDir 'data\projects') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'data\publishes') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'data\resources') -Force | Out-Null

# Resolve project id
$metaPath = Join-Path $DataRoot 'meta.json'
if (-not $ProjectId) {
  if (Test-Path $metaPath) {
    $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
    $ProjectId = [string]$meta.lastProjectId
  }
}
if (-not $ProjectId) {
  $pubDir = Join-Path $DataRoot 'publishes'
  if (Test-Path $pubDir) {
    $first = Get-ChildItem $pubDir -Filter '*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($first) { $ProjectId = [IO.Path]::GetFileNameWithoutExtension($first.Name) }
  }
}
if (-not $ProjectId) {
  throw 'No ProjectId. Pass -ProjectId or publish a project into apps/data first.'
}

$projFile = Join-Path $DataRoot "projects\$ProjectId.json"
$pubFile = Join-Path $DataRoot "publishes\$ProjectId.json"
if (-not (Test-Path $projFile)) { throw "Project not found: $projFile" }
if (-not (Test-Path $pubFile)) {
  Write-Host "WARN: no publish for $ProjectId — copying project as publish snapshot"
  $doc = Get-Content $projFile -Raw | ConvertFrom-Json
  $pkg = @{
    manifest = @{
      projectId = $doc.meta.id
      projectName = $doc.meta.name
      publishVersion = $doc.meta.version
      publishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      homePageId = $doc.homePageId
      documentPath = 'document.json'
      resourceIndex = @()
    }
    document = $doc
  }
  ($pkg | ConvertTo-Json -Depth 100) | Set-Content -Path (Join-Path $OutDir "data\publishes\$ProjectId.json") -Encoding UTF8
} else {
  Copy-Item $pubFile (Join-Path $OutDir "data\publishes\$ProjectId.json") -Force
}

Copy-Item $projFile (Join-Path $OutDir "data\projects\$ProjectId.json") -Force
@{ lastProjectId = $ProjectId } | ConvertTo-Json | Set-Content (Join-Path $OutDir 'data\meta.json') -Encoding UTF8

$resSrc = Join-Path $DataRoot "resources\$ProjectId"
$resDst = Join-Path $OutDir "data\resources\$ProjectId"
if (Test-Path $resSrc) {
  New-Item -ItemType Directory -Path $resDst -Force | Out-Null
  Copy-Item (Join-Path $resSrc '*') $resDst -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($name in @('tags.json', 'devices.json')) {
  $src = Join-Path $DataRoot $name
  if (Test-Path $src) { Copy-Item $src (Join-Path $OutDir "data\$name") -Force }
}

Copy-Item (Join-Path $Tpl 'start-site.bat') (Join-Path $OutDir 'start.bat') -Force
Copy-Item (Join-Path $Tpl 'start-site.bat') (Join-Path $OutDir 'start-site.bat') -Force
Copy-Item (Join-Path $Tpl 'README-SITE.txt') (Join-Path $OutDir 'README.txt') -Force
Copy-Item (Join-Path $Tpl 'README-SITE.txt') (Join-Path $OutDir 'README-SITE.txt') -Force

$ZipPath = Join-Path $ReleaseRoot "$SiteName.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Write-Host "==> zip $ZipPath"
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force

Write-Host ''
Write-Host "OK: $OutDir"
Write-Host "ZIP: $ZipPath"
Write-Host "ProjectId: $ProjectId"
Write-Host 'Start: start.bat  ->  http://127.0.0.1:8787/runtime'
Write-Host 'LAN:   http://SERVER_IP:8787/runtime'
