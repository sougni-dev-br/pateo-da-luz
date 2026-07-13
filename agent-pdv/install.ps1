# Instalador do Agente Pateo PDV para PDVTOUCH.
# Rode como Administrador uma vez. Cria:
#   - C:\PateoAgent\   com src/, config.json (vazio), logs/
#   - Tarefa Agendada "PateoAgentSync"  gatilho: "ao logon" + retry 15min
#
# Reexecutar é seguro: remove a tarefa existente e recria; NÃO sobrescreve
# config.json se já existir.

$ErrorActionPreference = "Stop"

$AgentRoot = "C:\PateoAgent"
$RepoRoot  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir    = Join-Path $RepoRoot "src"
$PkgFile   = Join-Path $RepoRoot "package.json"
$ExampleCfg = Join-Path $RepoRoot "config.example.json"

Write-Host "Instalando Pateo Agent PDV a partir de $RepoRoot" -ForegroundColor Cyan

# 1) Pastas
New-Item -ItemType Directory -Force -Path $AgentRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AgentRoot "src") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AgentRoot "logs") | Out-Null

# 2) Copia src/ e package.json
Copy-Item -Path (Join-Path $SrcDir "*") -Destination (Join-Path $AgentRoot "src") -Recurse -Force
Copy-Item -Path $PkgFile -Destination (Join-Path $AgentRoot "package.json") -Force

# 3) Config: cria a partir do exemplo se ainda não existir
$TargetCfg = Join-Path $AgentRoot "config.json"
if (-not (Test-Path $TargetCfg)) {
    Copy-Item -Path $ExampleCfg -Destination $TargetCfg -Force
    Write-Host "config.json criado em $TargetCfg - EDITE antes de continuar!" -ForegroundColor Yellow
} else {
    Write-Host "config.json já existia, mantido" -ForegroundColor Green
}

# 4) Localiza Node.js
$NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    Write-Host "ERRO: Node.js não encontrado. Instale Node 20+ e rode novamente." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js: $NodeExe" -ForegroundColor Green

# 5) Cria a Tarefa Agendada
$TaskName = "PateoAgentSync"
$SyncScript = Join-Path $AgentRoot "src\sync.js"

# Remove tarefa anterior se existir
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa anterior removida" -ForegroundColor Gray
}

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$SyncScript`"" -WorkingDirectory $AgentRoot

# Dois gatilhos:
#   1. Ao fazer logon — pega dias perdidos se a maquina ficou desligada.
#   2. Diario as 22:00 — sincroniza o dia corrente ao fim do 2o turno,
#      garantindo que os dados do dia estejam no ERP na mesma noite.
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -Daily -At "22:00")
)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description "Sincroniza faturamento do Agile PDV com o ERP Pateo da Luz" `
    -RunLevel Highest | Out-Null

Write-Host "" -ForegroundColor Green
Write-Host "Instalação concluída." -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "Próximos passos:" -ForegroundColor Cyan
Write-Host "  1. Editar C:\PateoAgent\config.json com os valores reais" -ForegroundColor White
Write-Host "  2. Rodar backfill (uma vez):  node C:\PateoAgent\src\backfill.js --meses=6" -ForegroundColor White
Write-Host "  3. Testar sync do dia:        node C:\PateoAgent\src\sync.js" -ForegroundColor White
Write-Host "  4. Logout/login para o Agendador disparar o primeiro sync" -ForegroundColor White
Write-Host "" -ForegroundColor Green
Write-Host "Logs em: C:\PateoAgent\logs\sync-YYYY-MM-DD.log" -ForegroundColor Gray
