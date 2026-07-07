# Pateo Agent PDV

Agente local que roda na máquina **PDVTOUCH** (onde está instalado o Agile PDV) e sincroniza o faturamento do salão com o ERP Pateo da Luz.

## Como funciona

1. Ao fazer logon na máquina PDVTOUCH pela manhã, a Tarefa Agendada `PateoAgentSync` dispara `sync.js`.
2. O agente loga no **AgileReport** local (`http://localhost:8091`), baixa os 3 CSVs do dia anterior:
   - Faturamento (vendas)
   - Meios de pagamento
   - Venda de produtos
3. Parseia (UTF-16 LE → JSON), envia para o backend em `POST /integrations/agile/sync` autenticado por `X-Agile-Token`.
4. Backend agrega por dia + turno e faz upsert em `RevenueEntry` (`channel="Salão"`, `sourcePlatform="AGILE_PDV"`).
5. Log local em `C:\PateoAgent\logs\sync-YYYY-MM-DD.log`.

Se houver falha (rede, backend offline), o agente tenta novamente até 4x com 15 min de intervalo. Se a máquina estiver desligada, o próximo logon pega os dias faltantes.

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
   - Registra a Tarefa Agendada `PateoAgentSync`
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
- **Ver status da tarefa:** `Get-ScheduledTask -TaskName PateoAgentSync | Get-ScheduledTaskInfo`
- **Rodar tarefa manualmente:** `Start-ScheduledTask -TaskName PateoAgentSync`

## Segurança

- `config.json` contém segredos (senha AgileReport + token backend). Não é commitado no git.
- Token gerado uma vez no painel do Render (variável `AGILE_INGEST_TOKEN`) e replicado aqui.
- A tarefa roda com privilégios de admin apenas pra ler o AgileReport local; não abre porta nenhuma.

## Estrutura

```
agent-pdv/
├── README.md           # este arquivo
├── install.ps1         # instalador Windows
├── package.json        # metadata (zero deps runtime)
├── config.example.json # template de config
└── src/
    ├── config.js       # loader de config com validação
    ├── logger.js       # log rotativo por dia
    ├── agile-client.js # login + download CSVs do AgileReport
    ├── csv-parser.js   # UTF-16 → objetos JSON
    ├── backend-client.js # POST /integrations/agile/sync com retry
    ├── sync-core.js    # orquestrador reutilizado por sync/backfill
    ├── sync.js         # entry: D-1 (ao logon)
    └── backfill.js     # entry: N meses (one-off)
```
