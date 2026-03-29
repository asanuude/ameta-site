# После выгрузки из 1С: синхронизация webdata -> data/, commit и push (триггер workflow в 1c-data).
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

& (Join-Path $PSScriptRoot 'sync-web1c.ps1')
if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE }

git add data/
$diff = git diff --cached --name-only
if (-not $diff) {
    Write-Host 'Изменений в data/ нет — коммит не нужен.'
    exit 0
}

$branch = (git branch --show-current).Trim()
if (-not $branch) {
    Write-Error 'Не удалось определить текущую ветку git.'
}

git commit -m "chore: sync CommerceML from 1C (web export)"
git push origin $branch
Write-Host "Готово: push в $branch — GitHub Actions обновит catalog.json в 1c-data."
