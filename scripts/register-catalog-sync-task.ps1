# Один раз от администратора НЕ обязательно — от вашей учётной записи достаточно (git push + сетевой G:).
# Запуск: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-catalog-sync-task.ps1
#
# Где смотреть задачу: Планировщик заданий → Библиотека планировщика заданий (не «Все выполняемые задачи»).

$ErrorActionPreference = 'Stop'
$taskName = 'AmetaSite-CatalogSync'
$scriptPath = Join-Path $PSScriptRoot 'scheduled-catalog-sync.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Не найден: $scriptPath"
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# Каждый день с 9:00 до ~17:40, шаг 40 мин (14 запусков). PS 5.1 не даёт Daily+Repetition в одном триггере.
$triggers = @()
for ($i = 0; $i -lt 14; $i++) {
    $totalMin = 9 * 60 + 40 * $i
    $h = [int][math]::Floor($totalMin / 60)
    $m = $totalMin % 60
    $timeStr = '{0:D2}:{1:D2}' -f $h, $m
    $triggers += New-ScheduledTaskTrigger -Daily -At $timeStr
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

$description = @'
CommerceML: G:\web1C\webdata -> G:\1Ctest\ameta-site\data, git push -> GitHub Actions -> 1c-data.
Лог: %LOCALAPPDATA%\AmetaSite\catalog-sync.log
'@

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description $description.Trim()

Write-Host "Задача создана: $taskName"
Write-Host "Путь: Планировщик заданий → Библиотека планировщика заданий → $taskName"
Write-Host "Лог: $env:LOCALAPPDATA\AmetaSite\catalog-sync.log"
Write-Host "Проверка вручную: ПКМ по задаче → Выполнить"
