# Копирует выгрузку CommerceML из папки 1С в ./data (для catalog:build и GitHub Actions).
# Источник по умолчанию: G:\web1C\webdata
# Переопределение: $env:WEB1C_DATA = "D:\path\webdata"

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Dest = Join-Path $RepoRoot 'data'
$Source = if ($env:WEB1C_DATA) { $env:WEB1C_DATA.TrimEnd('\', '/') } else { 'G:\web1C\webdata' }

if (-not (Test-Path -LiteralPath $Source)) {
    Write-Error "Папка выгрузки не найдена: $Source (задайте WEB1C_DATA или проверьте путь)."
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "Копирование: $Source -> $Dest"

# Robocopy: 0–7 = успех; ≥8 = ошибка
robocopy $Source $Dest /E /NFL /NDL /NJH /NJS | Out-Host
$rc = $LASTEXITCODE
if ($rc -ge 8) {
    exit $rc
}
exit 0
