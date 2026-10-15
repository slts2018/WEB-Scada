#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$JavaApp = Join-Path $Root 'apps\server-java'
$Jar = Join-Path $JavaApp 'target\web-scada-server-0.1.0-SNAPSHOT.jar'
$Data = Join-Path $Root 'apps\data'

if (-not $env:JAVA_HOME) {
  $jdk = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
  if (Test-Path $jdk) { $env:JAVA_HOME = $jdk }
}
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  throw 'JAVA_HOME not set / JDK 17+ not found'
}

if (-not $env:SCADA_DATA) { $env:SCADA_DATA = $Data }
if (-not $env:PORT) { $env:PORT = '8787' }
if (-not $env:HOST) { $env:HOST = '0.0.0.0' }

New-Item -ItemType Directory -Path $Data -Force | Out-Null

# Embedded MariaDB (set SCADA_SKIP_EMBEDDED_MYSQL=1 to skip)
if ($env:SCADA_SKIP_EMBEDDED_MYSQL -ne '1') {
  $emb = Join-Path $PSScriptRoot 'embedded-mysql.ps1'
  Write-Host '==> ensure embedded MySQL'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $emb -Action Start
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[WARN] embedded MySQL failed; continuing (file fallback may apply)'
  }
}

# Embedded InfluxDB 2.x (set SCADA_SKIP_EMBEDDED_INFLUX=1 to skip)
if ($env:SCADA_SKIP_EMBEDDED_INFLUX -ne '1') {
  $embInf = Join-Path $PSScriptRoot 'embedded-influx.ps1'
  Write-Host '==> ensure embedded InfluxDB'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $embInf -Action Start
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[WARN] embedded InfluxDB failed; continuing without history'
  }
  # child process cannot export env — set known defaults for Spring
  if (-not $env:INFLUX_URL) { $env:INFLUX_URL = 'http://127.0.0.1:8087' }
  if (-not $env:INFLUX_TOKEN) { $env:INFLUX_TOKEN = 'web-scada-dev-token' }
  if (-not $env:INFLUX_ORG) { $env:INFLUX_ORG = 'web-scada' }
  if (-not $env:INFLUX_BUCKET) { $env:INFLUX_BUCKET = 'tags' }
  if (-not $env:INFLUX_MEASUREMENT) { $env:INFLUX_MEASUREMENT = 'tag_value' }
  if (-not $env:INFLUX_REQUIRED) { $env:INFLUX_REQUIRED = 'false' }
}

if (-not (Test-Path $Jar)) {
  Write-Host '==> building server.jar (first run)'
  $Mvn = Join-Path $env:LOCALAPPDATA 'apache-maven-3.9.9\bin\mvn.cmd'
  if (-not (Test-Path $Mvn)) {
    $cmd = Get-Command mvn -ErrorAction SilentlyContinue
    if ($cmd) { $Mvn = $cmd.Source } else { throw 'Maven not found' }
  }
  Push-Location $JavaApp
  try {
    & $Mvn -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw 'mvn package failed' }
  } finally {
    Pop-Location
  }
}

$java = Join-Path $env:JAVA_HOME 'bin\java.exe'
Write-Host "==> Spring Boot on :$($env:PORT) data=$($env:SCADA_DATA) mysql=$($env:MYSQL_HOST):$($env:MYSQL_PORT) influx=$($env:INFLUX_URL)"
Set-Location $JavaApp
& $java -jar $Jar
