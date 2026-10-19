# Instalador do Agente Keeta para a PDVTOUCH.
# Rode como Administrador uma vez. Cria:
#   - C:\PateoAgentKeeta\   com src/, package.json, config.json (modelo), logs/ e perfil/ (login salvo)
#   - Tarefa Agendada "PateoAgentKeeta": ao fazer logon e todo dia às 09:00
#
# Reexecutar é seguro: recria a tarefa, atualiza o código e NÃO sobrescreve config.json nem o perfil.

$ErrorActionPreference = "Stop"

$AgentRoot  = "C:\PateoAgentKeeta"
$RepoRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExampleCfg = Join-Path $RepoRoot "config.example.json"

Write-Host "Instalando Pateo Agent Keeta a partir de $RepoRoot" -ForegroundColor Cyan

# 1) Pastas
New-Item -ItemType Directory -Force -Path $AgentRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AgentRoot "src") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AgentRoot "logs") | Out-Null

# 2) Código
Copy-Item -Path (Join-Path $RepoRoot "src\*") -Destination (Join-Path $AgentRoot "src") -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "package.json") -Destination (Join-Path $AgentRoot "package.json") -Force

# 3) Config: cria a partir do exemplo se ainda não existir
$TargetCfg = Join-Path $AgentRoot "config.json"
if (-not (Test-Path $TargetCfg)) {
    Copy-Item -Path $ExampleCfg -Destination $TargetCfg -Force
    Write-Host "config.json criado em $TargetCfg - EDITE antes de continuar (shopId, token do ERP, e-mail e senha da Keeta)." -ForegroundColor Yellow
} else {
    Write-Host "config.json já existia, mantido" -ForegroundColor Green
}

# 4) O config.json guarda a senha da Keeta e o token do ERP: só Administradores e o usuário atual leem.
icacls $TargetCfg /inheritance:r /grant:r "Administrators:F" "$($env:USERNAME):F" | Out-Null
Write-Host "Permissões do config.json restritas a Administradores e $($env:USERNAME)" -ForegroundColor Green

# 5) Node.js
$NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$NpmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $NodeExe -or -not $NpmCmd) {
    Write-Host "ERRO: Node.js 20+ não encontrado. Instale e rode novamente." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js: $NodeExe" -ForegroundColor Green

# 6) Dependência (playwright-core, sem baixar navegador: usa o Microsoft Edge já instalado no Windows)
Push-Location $AgentRoot
& $NpmCmd install --omit=dev --no-audit --no-fund
Pop-Location

# 7) Tarefa Agendada
$TaskName = "PateoAgentKeeta"
$SyncScript = Join-Path $AgentRoot "src\sync.js"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa anterior removida" -ForegroundColor Gray
}

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$SyncScript`"" -WorkingDirectory $AgentRoot

# Dois gatilhos: ao logon (recupera dias se a máquina ficou desligada) e 09:00 (o dia anterior já fechou na Keeta).
# O ERP é idempotente: rodar mais de uma vez no dia é seguro.
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -Daily -At "09:00")
)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Roda como o usuário atual, sessão interativa: o navegador usa o perfil que está logado na Keeta.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
    -Description "Sincroniza o faturamento da Keeta com o ERP Pateo da Luz" | Out-Null

Write-Host ""
Write-Host "Pronto. Próximos passos:" -ForegroundColor Cyan
Write-Host "  1. Edite $TargetCfg"
Write-Host "  2. Entre na Keeta uma vez:   cd $AgentRoot ; node src\sync.js --login"
Write-Host "  3. Teste agora:              Start-ScheduledTask -TaskName $TaskName   (log em $AgentRoot\logs)"
