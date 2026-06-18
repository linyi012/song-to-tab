# Dev launcher: backend (8000) + frontend (5173)
param(
    [switch]$Install,
    [switch]$InstallDemucs,
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$Uvicorn = Join-Path $BackendDir ".venv\Scripts\uvicorn.exe"
$BackendPort = 8000
$FrontendPort = 5173

function Test-PortInUse([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-DevWindow([string]$Title, [string]$WorkDir, [string]$Command) {
    $encoded = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes(
            "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
        )
    )
    Start-Process powershell -ArgumentList "-NoExit", "-EncodedCommand", $encoded | Out-Null
}

Write-Host ""
Write-Host "song-to-tab dev" -ForegroundColor Cyan
Write-Host ""

if (-not $FrontendOnly) {
    if (-not (Test-Path $Uvicorn)) {
        Write-Host "ERROR: backend/.venv not found" -ForegroundColor Red
        Write-Host "Setup:" -ForegroundColor Yellow
        Write-Host "  cd backend"
        Write-Host "  python -m venv .venv"
        Write-Host "  .\.venv\Scripts\pip install -r requirements.txt"
        exit 1
    }

    if ($Install) {
        Write-Host "Installing backend deps..." -ForegroundColor Yellow
        & (Join-Path $BackendDir ".venv\Scripts\pip.exe") install -r (Join-Path $BackendDir "requirements.txt")
    }

    if ($InstallDemucs) {
        $Pip = Join-Path $BackendDir ".venv\Scripts\pip.exe"
        Write-Host "Installing Demucs (torch first, then demucs)..." -ForegroundColor Yellow
        & $Pip install torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cpu
        & $Pip install demucs
        Write-Host "Verifying Demucs..." -ForegroundColor Yellow
        & (Join-Path $BackendDir ".venv\Scripts\python.exe") -c "from app.separate import separate_available, separate_unavailable_reason as r; ok=separate_available(); print('separate_available:', ok); print(r() or 'OK')"
        Write-Host "If separate_available is False, see README Demucs section." -ForegroundColor DarkGray
    }

    if (Test-PortInUse $BackendPort) {
        Write-Host "SKIP: backend port $BackendPort already in use" -ForegroundColor Yellow
        Write-Host "      http://127.0.0.1:$BackendPort/docs" -ForegroundColor Yellow
        if ($Install -or $InstallDemucs) {
            Write-Host "WARN: close the old backend window and re-run dev.ps1 so new deps take effect." -ForegroundColor Yellow
        }
    } else {
        Write-Host "START: backend -> http://127.0.0.1:$BackendPort" -ForegroundColor Green
        Start-DevWindow "song-to-tab backend" $BackendDir "& '$Uvicorn' app.main:app --reload --port $BackendPort"
    }
}

if (-not $BackendOnly) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: npm not found" -ForegroundColor Red
        exit 1
    }

    $nodeModules = Join-Path $FrontendDir "node_modules"
    if (-not (Test-Path $nodeModules) -or $Install) {
        Write-Host "Installing frontend deps..." -ForegroundColor Yellow
        Push-Location $FrontendDir
        npm install
        Pop-Location
    }

    if (Test-PortInUse $FrontendPort) {
        Write-Host "SKIP: frontend port $FrontendPort already in use" -ForegroundColor Yellow
        Write-Host "      http://localhost:$FrontendPort"
    } else {
        Write-Host "START: frontend -> http://localhost:$FrontendPort" -ForegroundColor Green
        Start-DevWindow "song-to-tab frontend" $FrontendDir "npm run dev"
    }
}

Write-Host ""
Write-Host "Each service runs in its own window. Close the window to stop it." -ForegroundColor DarkGray
Write-Host ""
