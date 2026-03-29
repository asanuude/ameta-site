# Запуск из Планировщика заданий: npm catalog:sync-push + лог.
$ErrorActionPreference = 'Continue'
$Repo = 'G:\1Ctest\ameta-site'
$Npm = 'C:\Program Files\nodejs\npm.cmd'
$LogDir = Join-Path $env:LOCALAPPDATA 'AmetaSite'
$Log = Join-Path $LogDir 'catalog-sync.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
}

Write-Log '--- start scheduled-catalog-sync ---'
if (-not (Test-Path -LiteralPath $Repo)) {
    Write-Log "ERROR: repo not found: $Repo"
    exit 1
}
if (-not (Test-Path -LiteralPath $Npm)) {
    Write-Log "ERROR: npm not found: $Npm"
    exit 1
}

Set-Location -LiteralPath $Repo
try {
    & $Npm run catalog:sync-push 2>&1 | ForEach-Object { Write-Log "$_" }
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
}
$code = $LASTEXITCODE
Write-Log "--- end (exit $code) ---"
exit $code
