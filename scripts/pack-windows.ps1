#Requires -Version 5.1
param(
  [switch]$IncludeJava,
  [switch]$IncludeNode
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

if ($IncludeNode) {
  throw 'Node backend was removed. Pack with: pnpm pack:win'
}

$Version = '0.1.0'
$OutName = "WebScada-$Version-win-x64-java"
$ReleaseRoot = Join-Path $Root 'release'
$OutDir = Join-Path $ReleaseRoot $OutName
$Tpl = Join-Path $Root 'packaging\templates'

Write-Host "==> clean $OutDir"
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'public') | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'data') | Out-Null

Write-Host '==> build web'
pnpm --filter @web-scada/web build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }

Copy-Item -Path (Join-Path $Root 'apps\web\dist\*') -Destination (Join-Path $OutDir 'public') -Recurse -Force

Write-Host '==> build Spring Boot server.jar'
  $Mvn = Join-Path $env:LOCALAPPDATA 'apache-maven-3.9.9\bin\mvn.cmd'
  if (-not (Test-Path $Mvn)) {
    $MvnCmd = Get-Command mvn -ErrorAction SilentlyContinue
    if ($MvnCmd) { $Mvn = $MvnCmd.Source } else { throw 'Maven not found (expected %LOCALAPPDATA%\apache-maven-3.9.9 or mvn on PATH)' }
  }
  if (-not $env:JAVA_HOME) {
    $jdk = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
    if (Test-Path $jdk) { $env:JAVA_HOME = $jdk }
  }
  Push-Location (Join-Path $Root 'apps\server-java')
  try {
    & $Mvn -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw 'mvn package failed' }
  } finally {
    Pop-Location
  }
  $Jar = Join-Path $Root 'apps\server-java\target\web-scada-server-0.1.0-SNAPSHOT.jar'
  if (-not (Test-Path $Jar)) { throw "jar missing: $Jar" }
  Copy-Item $Jar (Join-Path $OutDir 'server.jar') -Force

  Copy-Item (Join-Path $Tpl 'start-java.bat') (Join-Path $OutDir 'start-java.bat') -Force
  Copy-Item (Join-Path $Tpl 'start-java.bat') (Join-Path $OutDir 'start.bat') -Force
  Copy-Item (Join-Path $Tpl 'start-site.bat') (Join-Path $OutDir 'start-site.bat') -Force
  Copy-Item (Join-Path $Tpl 'stop.bat') (Join-Path $OutDir 'stop.bat') -Force
  Copy-Item (Join-Path $Tpl 'launch.vbs') (Join-Path $OutDir 'launch.vbs') -Force
  Copy-Item (Join-Path $Tpl 'diagnose.bat') (Join-Path $OutDir 'diagnose.bat') -Force
  Copy-Item (Join-Path $Tpl 'README-SITE.txt') (Join-Path $OutDir 'README-SITE.txt') -Force
  Copy-Item (Join-Path $Tpl 'env.example') (Join-Path $OutDir '.env.example') -Force
  Copy-Item (Join-Path $Tpl 'env.example') (Join-Path $OutDir '.env') -Force
  Copy-Item (Join-Path $Tpl 'README.txt') (Join-Path $OutDir 'README.txt') -Force

  # Optional portable JRE: set SCADA_BUNDLE_JRE=1 to download Temurin JRE 17
  if ($env:SCADA_BUNDLE_JRE -eq '1') {
    Write-Host '==> download portable JRE 17 (Temurin)'
    $jreZip = Join-Path $ReleaseRoot 'OpenJDK17U-jre_x64_windows_hotspot.zip'
    $jreUrl = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse'
    if (-not (Test-Path $jreZip)) {
      Invoke-WebRequest -Uri $jreUrl -OutFile $jreZip
    }
    $jreExtract = Join-Path $ReleaseRoot 'jre-extract'
    if (Test-Path $jreExtract) { Remove-Item $jreExtract -Recurse -Force }
    Expand-Archive -Path $jreZip -DestinationPath $jreExtract -Force
    $inner = Get-ChildItem $jreExtract -Directory | Select-Object -First 1
    $jreDest = Join-Path $OutDir 'jre'
    if (Test-Path $jreDest) { Remove-Item $jreDest -Recurse -Force }
    Move-Item $inner.FullName $jreDest
    Remove-Item $jreExtract -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host '==> skip portable JRE (set SCADA_BUNDLE_JRE=1 to embed)'
  }

  # Optional embedded MariaDB / InfluxDB
  Copy-Item (Join-Path $Tpl 'start-mysql.bat') (Join-Path $OutDir 'start-mysql.bat') -Force
  Copy-Item (Join-Path $Tpl 'start-influx.bat') (Join-Path $OutDir 'start-influx.bat') -Force
  New-Item -ItemType Directory -Path (Join-Path $OutDir 'tools') -Force | Out-Null
  Copy-Item (Join-Path $Root 'scripts\embedded-mysql.ps1') (Join-Path $OutDir 'tools\embedded-mysql.ps1') -Force
  Copy-Item (Join-Path $Root 'scripts\embedded-influx.ps1') (Join-Path $OutDir 'tools\embedded-influx.ps1') -Force
  if ($env:SCADA_BUNDLE_MYSQL -eq '1') {
    Write-Host '==> download / stage portable MariaDB'
    $emb = Join-Path $Root 'scripts\embedded-mysql.ps1'
    $stage = Join-Path $env:LOCALAPPDATA 'WebScada\mysql'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $emb -Action Ensure -HomeDir $stage
    if ($LASTEXITCODE -ne 0) { throw 'embedded MariaDB ensure failed' }
    $mysqlDest = Join-Path $OutDir 'mysql'
    if (Test-Path $mysqlDest) { Remove-Item $mysqlDest -Recurse -Force }
    Write-Host "==> copy MariaDB -> $mysqlDest (without live datadir lock)"
    New-Item -ItemType Directory -Path $mysqlDest -Force | Out-Null
    Get-ChildItem $stage -Force | Where-Object { $_.Name -ne 'data' } |
      ForEach-Object { Copy-Item $_.FullName -Destination $mysqlDest -Recurse -Force }
  } else {
    Write-Host '==> skip portable MariaDB (set SCADA_BUNDLE_MYSQL=1 to embed)'
  }
  if ($env:SCADA_BUNDLE_INFLUX -eq '1') {
    Write-Host '==> download / stage portable InfluxDB'
    $embInf = Join-Path $Root 'scripts\embedded-influx.ps1'
    $stageInf = Join-Path $env:LOCALAPPDATA 'WebScada\influxdb'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $embInf -Action Ensure -HomeDir $stageInf
    if ($LASTEXITCODE -ne 0) { throw 'embedded InfluxDB ensure failed' }
    $infDest = Join-Path $OutDir 'influxdb'
    if (Test-Path $infDest) { Remove-Item $infDest -Recurse -Force }
    Write-Host "==> copy InfluxDB -> $infDest (without live datadir)"
    New-Item -ItemType Directory -Path $infDest -Force | Out-Null
    Get-ChildItem $stageInf -Force | Where-Object { $_.Name -ne 'data' } |
      ForEach-Object { Copy-Item $_.FullName -Destination $infDest -Recurse -Force }
  } else {
    Write-Host '==> skip portable InfluxDB (set SCADA_BUNDLE_INFLUX=1 to embed)'
  }

$ZipPath = Join-Path $ReleaseRoot "$OutName.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Write-Host "==> zip $ZipPath"
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force

Write-Host ''
Write-Host "OK: $OutDir"
Write-Host "ZIP: $ZipPath"
Write-Host 'Optional: open packaging\web-scada.iss in Inno Setup to build Setup.exe'
