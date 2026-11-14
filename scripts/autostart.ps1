# Puts a shortcut in the Startup folder so the drop service starts at sign-in,
# and starts it now if it is not already answering. Safe to run again.
# -Remove deletes the shortcut (does not stop a running service).
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs     = Join-Path $root 'scripts\start-hidden.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk     = Join-Path $startup 'power-right-click.lnk'

if ($Remove) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "removed $lnk" } else { Write-Host 'no shortcut to remove' }
    exit 0
}

if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Host 'No .env yet. Run "npm run init" first.' -ForegroundColor Yellow
    exit 1
}

$port = 4470
foreach ($line in Get-Content (Join-Path $root '.env')) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)') { $port = [int]$matches[1] }
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$sc.Arguments = '"' + $vbs + '"'
$sc.WorkingDirectory = $root
$sc.Save()
Write-Host "startup shortcut: $lnk"

function Test-Up {
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/health").StatusCode -eq 200 } catch { return $false }
}

if (Test-Up) {
    Write-Host "already running on port $port"
} else {
    Start-Process -FilePath $sc.TargetPath -ArgumentList $sc.Arguments -WorkingDirectory $root
    $up = $false
    foreach ($i in 1..20) { Start-Sleep -Milliseconds 300; if (Test-Up) { $up = $true; break } }
    if (-not $up) {
        Write-Host "did not come up on port $port - see server.log in $root" -ForegroundColor Red
        exit 1
    }
    Write-Host "started on port $port"
}

$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Write-Host "PID $($conn.OwningProcess), log: $(Join-Path $root 'server.log')" }
Write-Host "setup page: http://127.0.0.1:$port/setup"
