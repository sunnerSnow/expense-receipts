#requires -Version 5.1
<#
.SYNOPSIS
  把報帳系統註冊成「登入就自動啟動」,不必每次手動開兩個終端機。

.DESCRIPTION
  註冊兩個工作排程(以目前使用者身分執行,不需要系統管理員權限):

    expense-receipts-web      網頁伺服器(next start)
    expense-receipts-worker   背景工作(AI 辨識、月結匯出)

  PostgreSQL 不在這裡處理 —— 它在 Docker 裡,docker-compose.yml 已設
  restart: unless-stopped,Docker Desktop 一啟動就會把它帶起來。

  兩個工作都設定成:視窗隱藏、沒有執行時間上限、失敗後每分鐘重試三次、
  用電池時也照跑。登入後延遲 30 秒才啟動,讓 Docker Desktop 先就緒
  (worker 自己也會等資料庫,這個延遲只是減少無謂的等待訊息)。

.PARAMETER Remove
  移除這兩個工作排程。

.EXAMPLE
  pwsh -File scripts\install-autostart.ps1

.EXAMPLE
  pwsh -File scripts\install-autostart.ps1 -Remove
#>
[CmdletBinding()]
param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot

$tasks = @(
  @{ Name = 'expense-receipts-web'; Script = 'start:web'; Desc = '報帳系統:網頁伺服器' },
  @{ Name = 'expense-receipts-worker'; Script = 'start:worker'; Desc = '報帳系統:背景工作(AI 辨識、月結匯出)' }
)

if ($Remove) {
  foreach ($t in $tasks) {
    if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
      Write-Host "已移除 $($t.Name)"
    }
    else {
      Write-Host "$($t.Name) 本來就不存在,略過"
    }
  }
  return
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'PATH 上找不到 pnpm —— 工作排程會用同一組 PATH,現在找不到之後也不會動'
}

# next start 需要 production build;只有 dev 產物時 BUILD_ID 不存在
if (-not (Test-Path (Join-Path $repo 'apps\web\.next\BUILD_ID'))) {
  Write-Warning '還沒有 production build,網頁會起不來。註冊完請先執行:pnpm build'
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew
$settings.Hidden = $true

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c pnpm run $($t.Script)" `
    -WorkingDirectory $repo

  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $trigger.Delay = 'PT30S'

  Register-ScheduledTask `
    -TaskName $t.Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description $t.Desc `
    -Force | Out-Null

  Write-Host "已註冊 $($t.Name)  →  pnpm run $($t.Script)"
}

Write-Host ''
Write-Host '現在可以手動先跑一次看看:'
Write-Host '  Start-ScheduledTask -TaskName expense-receipts-web'
Write-Host '  Start-ScheduledTask -TaskName expense-receipts-worker'
Write-Host ''
Write-Host '狀態:Get-ScheduledTask -TaskName expense-receipts-*'
Write-Host '移除:pwsh -File scripts\install-autostart.ps1 -Remove'
