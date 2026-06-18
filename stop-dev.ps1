# Stop dev services: backend (8000) + frontend (5173)
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot
$BackendPort = 8000
$FrontendPorts = @(5173, 5174)

function Stop-PortListeners {
    param([int[]]$Ports)

    $killed = @()
    foreach ($port in $Ports) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            $procId = $conn.OwningProcess
            if ($procId -gt 0 -and $killed -notcontains $procId) {
                $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
                $label = if ($proc) { $proc.Name } else { "pid=$procId" }
                Write-Host "STOP: port $port -> $label ($procId)" -ForegroundColor Yellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                $killed += $procId
            }
        }
    }
    return $killed.Count
}

function Stop-ProjectProcesses {
    param([string]$Pattern, [string]$Label)

    $count = 0
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match 'song-to-tab' -and
            $_.CommandLine -match $Pattern
        } |
        ForEach-Object {
            Write-Host "STOP: $Label -> pid $($_.ProcessId)" -ForegroundColor Yellow
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            $count++
        }
    return $count
}

function Test-PortInUse([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "song-to-tab stop" -ForegroundColor Cyan
Write-Host ""

$stopped = 0

if (-not $FrontendOnly) {
    $stopped += Stop-PortListeners -Ports @($BackendPort)
    $stopped += Stop-ProjectProcesses -Pattern 'uvicorn|app\.main' -Label 'backend'
}

if (-not $BackendOnly) {
    $stopped += Stop-PortListeners -Ports $FrontendPorts
    $stopped += Stop-ProjectProcesses -Pattern 'vite|npm run dev' -Label 'frontend'
}

if ($stopped -eq 0) {
    Write-Host "Nothing to stop (no matching processes or ports in use)." -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "Stopped $stopped process(es)." -ForegroundColor Green
}

Write-Host ""
if (-not $FrontendOnly -and (Test-PortInUse $BackendPort)) {
    Write-Host "WARN: backend port $BackendPort still in use" -ForegroundColor Red
}
if (-not $BackendOnly -and (Test-PortInUse 5173)) {
    Write-Host "WARN: frontend port 5173 still in use" -ForegroundColor Red
}
if (-not $BackendOnly -and (Test-PortInUse 5174)) {
    Write-Host "WARN: frontend port 5174 still in use" -ForegroundColor Red
}
Write-Host ""
