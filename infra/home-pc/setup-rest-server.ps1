#Requires -RunAsAdministrator
# Home PC end of the off-site backup copy (docs/operacao.md): rest-server
# in append-only mode, started at boot as SYSTEM, reachable only from the
# VPS (10.77.0.1) through the WireGuard tunnel "partneroj".
#
# Run in an elevated PowerShell (as administrator):
#   powershell -ExecutionPolicy Bypass -File setup-rest-server.ps1 -Htpasswd 'partneroj:$2y$12$...'
# The htpasswd line is a bcrypt hash made on the VPS; the password itself
# never leaves the server. Safe to run again (e.g. to upgrade).
# ASCII only: Windows PowerShell 5.1 misreads UTF-8 without a BOM.
param(
  [Parameter(Mandatory = $true)] [string] $Htpasswd,
  [string] $DataDir = 'G:\partneroj-backup'
)
$ErrorActionPreference = 'Stop'

$version = '0.14.0'
# From SHA256SUMS of the official release.
$sha256 = '98e31e33816861722e0f04c7f56811a3ff2f37e006def217ad6eda8e438c9d82'
$installDir = 'C:\Program Files\rest-server'
$configDir = 'C:\ProgramData\rest-server'
$taskName = 'Partneroj rest-server'
$exe = Join-Path $installDir 'rest-server.exe'

if ($Htpasswd -notmatch '^partneroj:\$2[aby]\$\d\d\$') {
  throw 'the htpasswd line must look like partneroj:$2y$12$...'
}

Write-Host "1/5 download and verify rest-server $version"
$zip = Join-Path $env:TEMP "rest-server_$version.zip"
$url = "https://github.com/restic/rest-server/releases/download/v$version/rest-server_${version}_windows_amd64.zip"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha256) {
  throw 'checksum mismatch: the download is not the official release'
}
$unpacked = Join-Path $env:TEMP "rest-server_$version"
Expand-Archive $zip -DestinationPath $unpacked -Force
# Stop a running copy first, or the file is locked.
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Get-Process rest-server -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Force $installDir | Out-Null
$found = Get-ChildItem $unpacked -Recurse -Filter rest-server.exe | Select-Object -First 1
Copy-Item $found.FullName $exe -Force

Write-Host "2/5 data in $DataDir, config in $configDir"
# Only SYSTEM (S-1-5-18) and Administrators (S-1-5-32-544), by SID so it
# works on a Windows in any language. A program run by your user account
# cannot change the backups.
foreach ($dir in @($DataDir, $configDir)) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $dir" }
}
$htpasswdFile = Join-Path $configDir '.htpasswd'
Set-Content -Path $htpasswdFile -Value $Htpasswd -Encoding Ascii

Write-Host '3/5 scheduled task, at boot, as SYSTEM'
# --append-only: the VPS can add snapshots but never delete or overwrite
# them, so a compromised server cannot destroy this copy.
# --private-repos: the user partneroj only reaches /partneroj/.
$arguments = @(
  "--path `"$DataDir`"",
  '--listen :8000',
  '--append-only',
  '--private-repos',
  "--htpasswd-file `"$htpasswdFile`"",
  "--log `"$(Join-Path $configDir 'access.log')`""
) -join ' '
$action = New-ScheduledTaskAction -Execute $exe -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host '4/5 firewall: port 8000 only from the VPS, only on the tunnel'
Get-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $taskName -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8000 -RemoteAddress 10.77.0.1 -InterfaceAlias 'partneroj' `
  -Program $exe -Profile Any | Out-Null

Write-Host '5/5 check'
Start-Sleep -Seconds 3
$listening = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) { throw 'rest-server is not listening on port 8000' }
Write-Host "done: rest-server $version is listening on port 8000"
