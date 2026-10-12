# Starts MegaAsset-Agentic.
#   .\start.ps1          -> production-style: builds the UI once and serves everything from http://127.0.0.1:8010
#   .\start.ps1 -Dev     -> API on :8010 plus Vite dev server with hot reload on http://localhost:5173
param([switch]$Dev)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "Creating Python environment..."
    py -3.11 -m venv (Join-Path $root "backend\.venv")
    & $py -m pip install --upgrade pip
    & $py -m pip install -r (Join-Path $root "backend\requirements.txt")
}
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
    Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
}

if ($Dev) {
    Start-Process -WorkingDirectory (Join-Path $root "backend") -FilePath $py -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload --reload-dir app"
    Push-Location (Join-Path $root "frontend"); npm run dev; Pop-Location
} else {
    Push-Location (Join-Path $root "frontend"); npm run build; Pop-Location
    Push-Location (Join-Path $root "backend")
    Write-Host "MegaAsset-Agentic running at http://127.0.0.1:8010"
    & $py -m uvicorn app.main:app --host 127.0.0.1 --port 8010
    Pop-Location
}
