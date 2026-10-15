#Requires -Version 5.1
<#
  内置 MariaDB（Windows x64 绿色版）
  - 默认装到 %LOCALAPPDATA%\WebScada\mysql（避开中文工程路径）
  - 端口 3306，账号 root/root，库 web_scada
  用法:
    powershell -File scripts/embedded-mysql.ps1 -Action Start
    powershell -File scripts/embedded-mysql.ps1 -Action Stop
    powershell -File scripts/embedded-mysql.ps1 -Action Status
#>
param(
  [ValidateSet('Ensure', 'Start', 'Stop', 'Status', 'Env')]
  [string]$Action = 'Start',
  [string]$HomeDir = '',
  [int]$Port = 3306,
  [string]$RootPassword = 'root',
  [string]$Database = 'web_scada',
  [string]$Version = '11.4.4'
)

$ErrorActionPreference = 'Stop'

function Get-MysqlInstallDir {
  if ($HomeDir -and $HomeDir.Trim()) {
    return [IO.Path]::GetFullPath($HomeDir)
  }
  if ($env:SCADA_MYSQL_HOME -and (Test-Path (Join-Path $env:SCADA_MYSQL_HOME 'bin\mysqld.exe'))) {
    return (Resolve-Path $env:SCADA_MYSQL_HOME).Path
  }
  if ($env:SCADA_HOME) {
    $beside = Join-Path $env:SCADA_HOME 'mysql'
    if (Test-Path (Join-Path $beside 'bin\mysqld.exe')) {
      return (Resolve-Path $beside).Path
    }
  }
  return Join-Path $env:LOCALAPPDATA 'WebScada\mysql'
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

function Get-MysqldPids([string]$InstallDir) {
  $norm = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  @(
    Get-CimInstance Win32_Process -Filter "name='mysqld.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$norm*") } |
      Select-Object -ExpandProperty ProcessId
  )
}

function Write-MyIni([string]$InstallDir, [string]$DataDir, [int]$PortNum) {
  $basedir = ($InstallDir -replace '\\', '/')
  $data = ($DataDir -replace '\\', '/')
  $ini = @"
[client]
port=$PortNum
default-character-set=utf8mb4

[mysqld]
port=$PortNum
basedir=$basedir
datadir=$data
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
default-storage-engine=InnoDB
innodb_buffer_pool_size=128M
skip-log-bin
max_connections=50
"@
  $iniPath = Join-Path $InstallDir 'my.ini'
  Set-Content -Path $iniPath -Value $ini -Encoding ASCII
  return $iniPath
}

function Invoke-MysqlSql([string]$MysqlExe, [int]$PortNum, [string]$Password, [string]$Sql) {
  $argSets = @()
  if ([string]::IsNullOrEmpty($Password)) {
    $argSets += , @('-uroot', "--port=$PortNum", '-h', '127.0.0.1', '-e', $Sql)
  } else {
    $argSets += , @('-uroot', "--port=$PortNum", '-h', '127.0.0.1', "-p$Password", '-e', $Sql)
    $argSets += , @('-uroot', "--port=$PortNum", '-h', '127.0.0.1', '-e', $Sql)
  }
  foreach ($a in $argSets) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $MysqlExe @a 1>$null 2>$null
      if ($LASTEXITCODE -eq 0) { return $true }
    } catch {
      # mysql may write warnings to stderr; ignore
    } finally {
      $ErrorActionPreference = $prev
    }
  }
  return $false
}

function Ensure-MariaDB {
  param(
    [string]$InstallDir,
    [int]$PortNum,
    [string]$Password,
    [string]$DbName,
    [string]$Ver
  )

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $mysqld = Join-Path $InstallDir 'bin\mysqld.exe'
  $mysqlExe = Join-Path $InstallDir 'bin\mysql.exe'
  $dataDir = Join-Path $InstallDir 'data'
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'WebScada\cache'
  New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null

  if (-not (Test-Path $mysqld)) {
    $zipName = "mariadb-$Ver-winx64.zip"
    $zip = Join-Path $cacheRoot $zipName
    $url = "https://archive.mariadb.org/mariadb-$Ver/winx64-packages/$zipName"
    if (-not (Test-Path $zip)) {
      Write-Host "==> download MariaDB $Ver (~300MB, first time)"
      Write-Host "    $url"
      Invoke-WebRequest -Uri $url -OutFile $zip
    } else {
      Write-Host "==> use cached $zip"
    }
    $extract = Join-Path $cacheRoot "mariadb-$Ver-extract"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Write-Host '==> extract MariaDB'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $inner = Get-ChildItem $extract -Directory | Select-Object -First 1
    if (-not $inner) { throw 'MariaDB zip layout unexpected' }
    Get-ChildItem $InstallDir -Force | Where-Object { $_.Name -ne 'data' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $InstallDir -Recurse -Force
    Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $mysqld)) { throw "mysqld missing: $mysqld" }

  $ini = Write-MyIni -InstallDir $InstallDir -DataDir $dataDir -PortNum $PortNum

  if (-not (Test-Path (Join-Path $dataDir 'mysql'))) {
    Write-Host '==> initialize datadir (mysql_install_db)'
    if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $installDb = Join-Path $InstallDir 'bin\mysql_install_db.exe'
    if (-not (Test-Path $installDb)) {
      $installDb = Join-Path $InstallDir 'bin\mariadb-install-db.exe'
    }
    if (-not (Test-Path $installDb)) { throw 'mysql_install_db.exe missing' }
    & $installDb --datadir=$dataDir --password=$Password --port=$PortNum --default-user --silent
    if (-not (Test-Path (Join-Path $dataDir 'mysql'))) {
      throw 'mysql_install_db failed (datadir/mysql missing)'
    }
  }

  if (-not (Test-PortOpen $PortNum)) {
    Write-Host "==> start mysqld :$PortNum"
    $log = Join-Path $InstallDir 'mysqld-err.log'
    if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }
    Start-Process -FilePath $mysqld -ArgumentList @("--defaults-file=$ini") -WindowStyle Hidden `
      -RedirectStandardError $log | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-PortOpen $PortNum)) {
      if ((Get-Date) -gt $deadline) {
        if (Test-Path $log) { Get-Content $log -Tail 60 | Write-Host }
        throw "mysqld did not listen on $PortNum within 60s"
      }
      Start-Sleep -Milliseconds 500
    }
  } else {
    Write-Host "==> already listening :$PortNum"
  }

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $ok = Invoke-MysqlSql $mysqlExe $PortNum $Password "CREATE DATABASE IF NOT EXISTS $DbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    if (-not $ok) {
      $ok = Invoke-MysqlSql $mysqlExe $PortNum '' "ALTER USER 'root'@'localhost' IDENTIFIED BY '$Password'; CREATE DATABASE IF NOT EXISTS $DbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    }
    if (-not $ok) {
      Write-Host '[WARN] could not ensure database (may already be configured)'
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }

  Write-Host "OK MariaDB dir=$InstallDir port=$PortNum user=root/$Password db=$DbName"
}

function Stop-MariaDBInstance([string]$InstallDir) {
  $pids = Get-MysqldPids $InstallDir
  foreach ($id in $pids) {
    Write-Host "stop mysqld PID $id"
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  if (-not $pids.Count) { Write-Host 'mysqld not running (this install)' }
}

function Show-MysqlStatus([string]$InstallDir, [int]$PortNum) {
  [pscustomobject]@{
    installDir = $InstallDir
    mysqld     = (Test-Path (Join-Path $InstallDir 'bin\mysqld.exe'))
    portOpen   = (Test-PortOpen $PortNum)
    port       = $PortNum
    pids       = ((Get-MysqldPids $InstallDir) -join ',')
  } | Format-List
}

function Set-ScadaMysqlEnv([int]$PortNum, [string]$Password, [string]$DbName, [string]$InstallDir) {
  $env:MYSQL_HOST = '127.0.0.1'
  $env:MYSQL_PORT = "$PortNum"
  $env:MYSQL_USER = 'root'
  $env:MYSQL_PASSWORD = $Password
  $env:MYSQL_DATABASE = $DbName
  $env:MYSQL_FALLBACK_FILE = 'false'
  $env:SCADA_MYSQL_HOME = $InstallDir
  Write-Host "env MYSQL=$($env:MYSQL_HOST):$($env:MYSQL_PORT) SCADA_MYSQL_HOME=$InstallDir"
}

$installDir = Get-MysqlInstallDir
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$installDir = [IO.Path]::GetFullPath($installDir)

switch ($Action) {
  { $_ -in 'Ensure', 'Start' } {
    Ensure-MariaDB -InstallDir $installDir -PortNum $Port -Password $RootPassword -DbName $Database -Ver $Version
    Set-ScadaMysqlEnv -PortNum $Port -Password $RootPassword -DbName $Database -InstallDir $installDir
  }
  'Stop' { Stop-MariaDBInstance -InstallDir $installDir }
  'Status' { Show-MysqlStatus -InstallDir $installDir -PortNum $Port }
  'Env' { Set-ScadaMysqlEnv -PortNum $Port -Password $RootPassword -DbName $Database -InstallDir $installDir }
}
