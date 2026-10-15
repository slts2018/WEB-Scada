#Requires -Version 5.1
<#
  Embedded InfluxDB 2.x (Windows amd64)
  Default: %LOCALAPPDATA%\WebScada\influxdb
  URL http://127.0.0.1:8086  org=web-scada  bucket=tags
  Token: web-scada-dev-token (override with -Token)
#>
param(
  [ValidateSet('Ensure', 'Start', 'Stop', 'Status', 'Env')]
  [string]$Action = 'Start',
  [string]$HomeDir = '',
  # 8087 avoids clash with other local Influx (e.g. iSPower on 8086)
  [int]$Port = 8087,
  [string]$Org = 'web-scada',
  [string]$Bucket = 'tags',
  [string]$Username = 'admin',
  [string]$Password = 'adminadmin',
  [string]$Token = 'web-scada-dev-token',
  [string]$Version = '2.7.10'
)

$ErrorActionPreference = 'Stop'

function Get-InfluxInstallDir {
  if ($HomeDir -and $HomeDir.Trim()) {
    return [IO.Path]::GetFullPath($HomeDir)
  }
  if ($env:SCADA_INFLUX_HOME -and (Test-Path (Join-Path $env:SCADA_INFLUX_HOME 'influxd.exe'))) {
    return (Resolve-Path $env:SCADA_INFLUX_HOME).Path
  }
  if ($env:SCADA_HOME) {
    $beside = Join-Path $env:SCADA_HOME 'influxdb'
    if (Test-Path (Join-Path $beside 'influxd.exe')) {
      return (Resolve-Path $beside).Path
    }
  }
  return Join-Path $env:LOCALAPPDATA 'WebScada\influxdb'
}

function Test-PortOpen([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    if ($ok -and $c.Connected) { $c.Close(); return $true }
    try { $c.Close() } catch {}
  } catch {}
  return $false
}

function Get-InfluxdPids([string]$InstallDir) {
  $norm = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  @(
    Get-CimInstance Win32_Process -Filter "name='influxd.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$norm*") } |
      Select-Object -ExpandProperty ProcessId
  )
}

function Find-Influxd([string]$InstallDir) {
  $d = Join-Path $InstallDir 'influxd.exe'
  if (Test-Path $d) { return $d }
  $nested = Get-ChildItem $InstallDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'influxd.exe') } |
    Select-Object -First 1
  if ($nested) { return (Join-Path $nested.FullName 'influxd.exe') }
  return $null
}

function Test-InfluxToken([string]$BaseUrl, [string]$Tok) {
  try {
    $headers = @{ Authorization = "Token $Tok" }
    $null = Invoke-RestMethod -Uri "$BaseUrl/api/v2/buckets?limit=1" -Headers $headers -TimeoutSec 10
    return $true
  } catch {
    return $false
  }
}

function Invoke-InfluxSetupApi(
  [string]$BaseUrl,
  [string]$User,
  [string]$Pass,
  [string]$OrgName,
  [string]$BucketName,
  [string]$Tok
) {
  if (Test-InfluxToken $BaseUrl $Tok) { return $true }

  $bodyObj = @{
    username = $User
    password = $Pass
    org      = $OrgName
    bucket   = $BucketName
    token    = $Tok
  }
  $body = $bodyObj | ConvertTo-Json -Compress
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v2/setup" `
      -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
    if ($resp -and $resp.auth -and $resp.auth.token -and ($resp.auth.token -ne $Tok)) {
      Write-Host "[WARN] setup returned different token; using configured token only if it works"
    }
  } catch {
    $msg = $_.Exception.Message
    # already onboarded — token must still validate below
    if ($msg -notmatch 'already|conflict|422|403|400') {
      Write-Host "[WARN] setup API: $msg"
    }
  }

  if (Test-InfluxToken $BaseUrl $Tok) { return $true }
  Write-Host '[WARN] token not accepted after setup; wipe data/ and retry if first install'
  return $false
}

function Ensure-InfluxDB {
  param(
    [string]$InstallDir,
    [int]$PortNum,
    [string]$OrgName,
    [string]$BucketName,
    [string]$User,
    [string]$Pass,
    [string]$Tok,
    [string]$Ver
  )

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'WebScada\cache'
  New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
  $dataDir = Join-Path $InstallDir 'data'
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

  $daemon = Find-Influxd $InstallDir
  if (-not $daemon) {
    $zipName = "influxdb2-${Ver}-windows.zip"
    $zip = Join-Path $cacheRoot $zipName
    $urls = @(
      "https://dl.influxdata.com/influxdb/releases/$zipName",
      "https://dl.influxdata.com/influxdb/releases/influxdb2-${Ver}-windows-amd64.zip",
      "https://download.influxdata.com/influxdb/releases/influxdb2-${Ver}-windows_amd64.zip"
    )
    if (-not (Test-Path $zip) -or ((Get-Item $zip).Length -lt 1MB)) {
      $ok = $false
      foreach ($url in $urls) {
        Write-Host "==> download InfluxDB $Ver"
        Write-Host "    $url"
        try {
          Invoke-WebRequest -Uri $url -OutFile $zip
          $ok = $true
          break
        } catch {
          Write-Host "[WARN] download failed: $($_.Exception.Message)"
          if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
        }
      }
      if (-not $ok) { throw "failed to download InfluxDB $Ver" }
    } else {
      Write-Host "==> use cached $zip"
    }

    $extract = Join-Path $cacheRoot "influxdb-$Ver-extract"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Write-Host '==> extract InfluxDB'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $found = Get-ChildItem $extract -Recurse -Filter 'influxd.exe' | Select-Object -First 1
    if (-not $found) { throw 'influxd.exe not found in zip' }
    $srcDir = $found.Directory.FullName
    Get-ChildItem $InstallDir -Force | Where-Object { $_.Name -ne 'data' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $srcDir '*') -Destination $InstallDir -Recurse -Force
    Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
    $daemon = Find-Influxd $InstallDir
  }

  if (-not $daemon) { throw "influxd.exe missing under $InstallDir" }

  $bolt = Join-Path $dataDir 'influxd.bolt'
  $engine = Join-Path $dataDir 'engine'
  $url = "http://127.0.0.1:$PortNum"
  $setupFlag = Join-Path $dataDir '.setup-done'

  if (-not (Test-PortOpen $PortNum)) {
    Write-Host "==> start influxd :$PortNum"
    # Avoid Start-Process -RedirectStandard* (parent waits until daemon exits).
    $argLine = "--bolt-path=`"$bolt`" --engine-path=`"$engine`" --http-bind-address=127.0.0.1:$PortNum --log-level=error"
    Start-Process -FilePath $daemon -ArgumentList $argLine -WorkingDirectory $InstallDir -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-PortOpen $PortNum)) {
      if ((Get-Date) -gt $deadline) { throw "influxd did not listen on $PortNum within 90s" }
      Start-Sleep -Milliseconds 500
    }
  } else {
    Write-Host "==> already listening :$PortNum"
  }

  $needSetup = -not (Test-Path $setupFlag)
  if (-not $needSetup -and -not (Test-InfluxToken $url $Tok)) {
    Write-Host '[WARN] setup flag present but token invalid; re-run onboarding check'
    $needSetup = $true
  }
  if ($needSetup) {
    Write-Host '==> influx onboarding API (org/bucket/token)'
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
      try {
        $h = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 2
        if ($h -and $h.status -eq 'pass') { $ready = $true; break }
      } catch {}
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { Write-Host '[WARN] /health not ready yet, still trying setup' }
    if (Invoke-InfluxSetupApi -BaseUrl $url -User $User -Pass $Pass -OrgName $OrgName -BucketName $BucketName -Tok $Tok) {
      Set-Content -Path $setupFlag -Value "ok $(Get-Date -Format o)" -Encoding ASCII
    } else {
      throw 'Influx onboarding failed (token not usable)'
    }
  }

  Write-Host "OK InfluxDB dir=$InstallDir url=$url org=$OrgName bucket=$BucketName"
}

function Stop-InfluxInstance([string]$InstallDir) {
  $pids = Get-InfluxdPids $InstallDir
  foreach ($id in $pids) {
    Write-Host "stop influxd PID $id"
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  if (-not $pids.Count) { Write-Host 'influxd not running (this install)' }
}

function Show-InfluxStatus([string]$InstallDir, [int]$PortNum) {
  [pscustomobject]@{
    installDir = $InstallDir
    influxd    = [bool](Find-Influxd $InstallDir)
    portOpen   = (Test-PortOpen $PortNum)
    port       = $PortNum
    pids       = ((Get-InfluxdPids $InstallDir) -join ',')
  } | Format-List
}

function Set-ScadaInfluxEnv(
  [int]$PortNum,
  [string]$OrgName,
  [string]$BucketName,
  [string]$Tok,
  [string]$InstallDir
) {
  $env:INFLUX_URL = "http://127.0.0.1:$PortNum"
  $env:INFLUX_TOKEN = $Tok
  $env:INFLUX_ORG = $OrgName
  $env:INFLUX_BUCKET = $BucketName
  $env:INFLUX_MEASUREMENT = 'tag_value'
  $env:INFLUX_REQUIRED = 'false'
  $env:SCADA_INFLUX_HOME = $InstallDir
  Write-Host "env INFLUX_URL=$($env:INFLUX_URL) org=$OrgName bucket=$BucketName"
}

$installDir = Get-InfluxInstallDir
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$installDir = [IO.Path]::GetFullPath($installDir)

switch ($Action) {
  { $_ -in 'Ensure', 'Start' } {
    Ensure-InfluxDB -InstallDir $installDir -PortNum $Port -OrgName $Org -BucketName $Bucket `
      -User $Username -Pass $Password -Tok $Token -Ver $Version
    Set-ScadaInfluxEnv -PortNum $Port -OrgName $Org -BucketName $Bucket -Tok $Token -InstallDir $installDir
  }
  'Stop' { Stop-InfluxInstance -InstallDir $installDir }
  'Status' { Show-InfluxStatus -InstallDir $installDir -PortNum $Port }
  'Env' {
    Set-ScadaInfluxEnv -PortNum $Port -OrgName $Org -BucketName $Bucket -Tok $Token -InstallDir $installDir
  }
}
