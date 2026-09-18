#Requires -Version 5.1
param(
  [switch]$IncludeNode,
  [string]$NodeVersion = '20.18.1'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

$Version = '0.1.0'
$OutName = "WebScada-$Version-win-x64"
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

Write-Host '==> bundle server'
$Esbuild = Join-Path $Root 'node_modules\esbuild\bin\esbuild'
if (-not (Test-Path $Esbuild)) {
  $Esbuild = Join-Path $Root 'apps\web\node_modules\esbuild\bin\esbuild'
}
if (-not (Test-Path $Esbuild)) {
  throw 'esbuild not found; run pnpm install first'
}

$ServerEntry = Join-Path $Root 'apps\server\src\index.ts'
$ServerOut = Join-Path $OutDir 'server.mjs'

$externals = @(
  'fastify',
  '@fastify/cors',
  '@fastify/multipart',
  '@fastify/static',
  '@fastify/websocket',
  '@influxdata/influxdb-client',
  'dotenv',
  'mysql2',
  'ws'
)
$extArgs = foreach ($e in $externals) { "--external:$e" }

& node $Esbuild $ServerEntry `
  --bundle `
  --platform=node `
  --format=esm `
  --outfile=$ServerOut `
  @extArgs
if ($LASTEXITCODE -ne 0) { throw 'esbuild server bundle failed' }

$pkgJson = @'
{
  "name": "web-scada-release",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@fastify/cors": "^11.0.1",
    "@fastify/multipart": "^10.1.1",
    "@fastify/static": "^10.1.3",
    "@fastify/websocket": "^11.3.0",
    "@influxdata/influxdb-client": "^1.35.0",
    "dotenv": "^16.6.1",
    "fastify": "^5.2.1",
    "mysql2": "^3.24.3",
    "ws": "^8.18.1"
  },
  "overrides": {
    "content-disposition": "2.0.0"
  }
}
'@
Set-Content -Path (Join-Path $OutDir 'package.json') -Value $pkgJson -Encoding UTF8

Write-Host '==> install production dependencies'
Push-Location $OutDir
try {
  npm install --omit=dev --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'npm install in release failed' }
} finally {
  Pop-Location
}

Copy-Item (Join-Path $Tpl 'start.bat') (Join-Path $OutDir 'start.bat') -Force
Copy-Item (Join-Path $Tpl 'stop.bat') (Join-Path $OutDir 'stop.bat') -Force
Copy-Item (Join-Path $Tpl 'launch.vbs') (Join-Path $OutDir 'launch.vbs') -Force
Copy-Item (Join-Path $Tpl 'diagnose.bat') (Join-Path $OutDir 'diagnose.bat') -Force
Copy-Item (Join-Path $Tpl 'start-site.bat') (Join-Path $OutDir 'start-site.bat') -Force
Copy-Item (Join-Path $Tpl 'README-SITE.txt') (Join-Path $OutDir 'README-SITE.txt') -Force
Copy-Item (Join-Path $Tpl 'env.example') (Join-Path $OutDir '.env.example') -Force
Copy-Item (Join-Path $Tpl 'env.example') (Join-Path $OutDir '.env') -Force
Copy-Item (Join-Path $Tpl 'README.txt') (Join-Path $OutDir 'README.txt') -Force

if ($IncludeNode) {
  Write-Host "==> download portable Node $NodeVersion"
  $nodeZip = Join-Path $ReleaseRoot "node-v$NodeVersion-win-x64.zip"
  $nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
  if (-not (Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
  }
  $nodeExtract = Join-Path $ReleaseRoot "node-v$NodeVersion-win-x64"
  if (Test-Path $nodeExtract) { Remove-Item $nodeExtract -Recurse -Force }
  Expand-Archive -Path $nodeZip -DestinationPath $ReleaseRoot -Force
  $runtimeNode = Join-Path $OutDir 'runtime\node'
  New-Item -ItemType Directory -Path (Split-Path $runtimeNode) -Force | Out-Null
  if (Test-Path $runtimeNode) { Remove-Item $runtimeNode -Recurse -Force }
  Move-Item $nodeExtract $runtimeNode
}

$ZipPath = Join-Path $ReleaseRoot "$OutName.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Write-Host "==> zip $ZipPath"
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force

Write-Host ''
Write-Host "OK: $OutDir"
Write-Host "ZIP: $ZipPath"
Write-Host 'Optional: open packaging\web-scada.iss in Inno Setup to build Setup.exe'
