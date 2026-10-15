# Pateo Agent PDV

Agente local que roda na máquina **PDVTOUCH** (onde está instalado o Agile PDV) e sincroniza o faturamento do salão com o ERP Pateo da Luz.

## Como funciona

A Tarefa Agendada `PateoAgentSync` dispara em **três momentos**:

1. **Ao fazer logon** — recupera dias que ficaram para trás quando a máquina esteve desligada.
2. **Diariamente às 16:00** — meio da tarde, garante que o dia do almoço já esteja no ERP.
3. **Diariamente às 22:00** — fim do jantar, garante o dia corrente completo.

Cada execução sincroniza os **últimos 5 dias** (não só D-1). O backend é idempotente (deduplica automaticamente), então rodar múltiplas vezes é seguro e faz o sistema convergir mesmo com falhas intermitentes.

### Reconciliação semanal (30 dias)

A Tarefa Agendada `PateoAgentSync30d` roda **toda segunda-feira às 10:00** (`sync.js --dias=30`). Ela corrige o que mudou depois da janela de 5 dias: cancelamentos, estornos e ajustes feitos em dias antigos. Se a máquina estiver desligada na segunda, roda quando ligar (`StartWhenAvailable`). Algo alterado há mais de 30 dias fica fora da janela; use o backfill nesse caso.

### O que o agente faz em cada execução

- Loga no **AgileReport** local (`http://localhost:8091`), baixa os 3 CSVs (Faturamento, Meios de pagamento, Venda de produtos).
- Parseia (UTF-16 LE → JSON), envia para o backend em `POST /integrations/agile/sync` autenticado por `X-Agile-Token`.
- Backend agrega por dia + turno e faz upsert em `RevenueEntry` (`channel="Salão"`, `sourcePlatform="AGILE_PDV"`).
- Ao terminar (com sucesso ou erro), envia o **heartbeat** (ver abaixo) e grava `C:\PateoAgent\status.json`.
- Log local em `C:\PateoAgent\logs\sync-YYYY-MM-DD.log`. O resultado final (`Backend: sync OK` / `Sync falhou`) é gravado antes de o processo encerrar.

Se houver falha (rede, backend offline), o agente tenta novamente até 4x com 15 min de intervalo. Se a máquina estiver desligada às 22:00 e no dia seguinte, o próximo logon pega os dias faltantes.

### Heartbeat

No fim de cada execução o agente envia `POST /integrations/agile/heartbeat` (mesmo header `X-Agile-Token`) para o ERP saber se o sync está rodando e avisar quando parar.

- Corpo: `status` (`ok` ou `erro`), `mensagem` (erro, até 500 caracteres), `periodoInicio`, `periodoFim`, `batchId`, `diasImportados`, `totalBruto`, `duracaoMs`, `agenteVersion`, `agenteHost`, `ocorridoEm`.
- Uma tentativa só, timeout de 15 s. **Falha de heartbeat nunca derruba o sync**: vira apenas um `WARN` no log.
- O mesmo conteúdo é gravado em `C:\PateoAgent\status.json` (útil para conferir o último resultado sem abrir o log).
- No ERP, o aviso aparece se o último status for `erro` ou se o último `ok` tiver mais de 26 h (crítico acima de 48 h).

### Campos enviados

Além dos valores das vendas, o agente envia `modo_venda` (hoje sempre `mesa`), e, como colunas opcionais do CSV, `hora`, `func_cancelou`, `motivo_cancelamento` (vendas) e `func_lancou` (itens). Se o AgileReport não trouxer uma coluna opcional, o valor vai como `null`, sem erro. Colunas obrigatórias ausentes, ou linhas com número de colunas diferente do cabeçalho, fazem o sync falhar com mensagem clara (e o heartbeat reporta `erro`).

## Requisitos na PDVTOUCH

- Windows 10/11
- Node.js 20+ ([nodejs.org](https://nodejs.org))
- AgileReport rodando em `http://localhost:8091` (padrão do Agile PDV Touch)
- Conexão de internet estável

## Instalação (via TeamViewer no PDV)

1. **Copiar a pasta `agent-pdv/`** para o PDV (ex.: via TeamViewer file transfer para `C:\Users\...\Downloads\agent-pdv\`).
2. Abrir **PowerShell como Administrador** e rodar:
   ```powershell
   cd C:\Users\...\Downloads\agent-pdv
   .\install.ps1
   ```
   O script:
   - Cria `C:\PateoAgent\` com `src/`, `config.json` (template), `logs/`
   - Registra as Tarefas Agendadas `PateoAgentSync` (logon, 16:00 e 22:00) e `PateoAgentSync30d` (segunda 10:00, 30 dias)
3. **Editar `C:\PateoAgent\config.json`** com os valores reais:
   ```json
   {
     "agileReport": {
       "baseUrl": "http://localhost:8091",
       "usuario": "SISTEMA",
       "senha": "<senha do AgileReport aqui>"
     },
     "backend": {
       "baseUrl": "https://pateo-backend.onrender.com",
       "ingestToken": "<token vindo do painel Render aqui>"
     },
     "sync": {
       "retryMaxAttempts": 4,
       "retryDelayMs": 900000
     }
   }
   ```
4. **Rodar backfill** (uma vez, para trazer 6 meses de histórico):
   ```powershell
   node C:\PateoAgent\src\backfill.js --meses=6
   ```
5. **Testar sync manual** (opcional):
   ```powershell
   node C:\PateoAgent\src\sync.js
   ```
6. **Reiniciar / fazer logout+login** — o Agendador vai disparar automaticamente.

## Debug

- **Logs por dia:** `C:\PateoAgent\logs\sync-YYYY-MM-DD.log`
- **Forçar um dia específico:** `node C:\PateoAgent\src\sync.js --data=2026-07-05`
- **Backfill de intervalo custom:** `node C:\PateoAgent\src\backfill.js --inicio=2026-01-01 --fim=2026-01-31`
- **Último resultado:** `Get-Content C:\PateoAgent\status.json`
- **Ver status das tarefas:** `Get-ScheduledTask -TaskName PateoAgentSync,PateoAgentSync30d | Get-ScheduledTaskInfo`
- **Rodar tarefa manualmente:** `Start-ScheduledTask -TaskName PateoAgentSync` (ou `PateoAgentSync30d`)
- **Últimos N dias:** `node C:\PateoAgent\src\sync.js --dias=30`
- **`Heartbeat: backend não aceitou` com status 404:** o backend ainda não tem o endpoint de heartbeat; o sync não é afetado.

## Segurança

- `config.json` contém segredos (senha AgileReport + token backend). Não é commitado no git.
- Token gerado uma vez no painel do Render (variável `AGILE_INGEST_TOKEN`) e replicado aqui.
- O agente só faz HTTP para o AgileReport local e para o backend; não abre porta nenhuma. O `install.ps1` registra a tarefa diária com nível elevado, mas o sync não depende disso (a tarefa semanal pode rodar sem elevação).
- As tarefas rodam como "Interativo" (usuário logado). Para a PDV sincronizar depois de um reinício sem ninguém na máquina, habilite o login automático do usuário.
- `status.json` e logs não contêm segredos.

## Estrutura

```
agent-pdv/
├── README.md           # este arquivo
├── install.ps1         # instalador Windows (tarefas diária e semanal)
├── package.json        # metadata (zero deps runtime)
├── config.example.json # template de config
└── src/
    ├── config.js       # loader de config com validação
    ├── logger.js       # log por dia; flush() antes de encerrar o processo
    ├── agile-client.js # login + download CSVs do AgileReport
    ├── csv-parser.js   # UTF-16 → objetos JSON (valida colunas e linhas)
    ├── backend-client.js # POST /sync com retry e POST /heartbeat
    ├── sync-core.js    # orquestrador reutilizado por sync/backfill
    ├── sync.js         # entry: últimos 5 dias (--dias=N), heartbeat e status.json
    └── backfill.js     # entry: N meses (one-off)
```
