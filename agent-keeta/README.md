# Pateo Agent Keeta

Agente local que roda na **PDVTOUCH** (a mesma máquina do agente do Agile) e sincroniza o faturamento
da **Keeta** com o ERP. A Keeta não tem integração oficial; o agente faz o que uma pessoa faria no portal
(`merchant.mykeeta.com`): pede o relatório "Dados do restaurante", espera ficar pronto, baixa o `.xlsx`
e envia ao ERP, que importa pelo mesmo caminho da tela **Delivery → Keeta → Importar do portal**.

## Como funciona

1. A Tarefa Agendada `PateoAgentKeeta` roda **ao fazer logon** e **todo dia às 09:00**.
2. O agente abre o Microsoft Edge (sem janela) com um **perfil próprio** que guarda o login da Keeta.
3. Pede o relatório do mês corrente (e do mês anterior nos 5 primeiros dias do mês, porque a Keeta
   ainda ajusta o fim dele). O período vai até **ontem**: o dia de hoje ainda não fechou.
4. Baixa o `.xlsx` e envia para `POST /integrations/keeta-agente/sync`, autenticado por `X-Keeta-Token`.
5. Manda um **sinal de vida** para o ERP (`/heartbeat`). O cartão da Keeta no painel de cobertura
   (Faturamento) mostra se o agente está ativo ou se pediu login.

O ERP é idempotente: dia já lançado é atualizado no lugar, nada duplica, mês com fechamento travado é
pulado e dia com valores estranhos vira aviso na prévia. Rodar duas vezes no mesmo dia é seguro.

## O que precisa acontecer quando o login da Keeta cair

A Keeta pede e-mail e senha de tempos em tempos. Se `portal.email` e `portal.senha` estiverem no
`config.json`, o agente tenta entrar sozinho. Se a Keeta pedir **código de verificação ou captcha**, ele
não consegue: **para, avisa o ERP** ("Keeta pediu login") e sai com código 2. Nesse dia, abra a PDVTOUCH e rode:

```powershell
cd C:\PateoAgentKeeta
node src\sync.js --login
```

Uma janela do Edge abre. Entre na Keeta, espere a mensagem "Sessão da Keeta salva" e feche a janela.

## Requisitos

- Windows 10/11 com **Microsoft Edge** (já vem instalado) e **Node.js 20+**
- Internet estável
- No servidor (Render): variável `KEETA_INGEST_TOKEN` (mínimo 16 caracteres, aleatório)

## Instalação (via TeamViewer na PDVTOUCH)

1. Copie a pasta `agent-keeta/` para a PDVTOUCH.
2. PowerShell **como Administrador**: `cd` na pasta e `.\install.ps1`.
3. Edite `C:\PateoAgentKeeta\config.json`:
   - `portal.shopId`: número da loja na Keeta (o mesmo do `s...` do usuário do portal; ex.: o portal mostra o ID do restaurante)
   - `portal.email` e `portal.senha`: login da Keeta (opcionais; sem eles o agente só avisa)
   - `backend.ingestToken`: o mesmo valor de `KEETA_INGEST_TOKEN` no Render
4. `node src\sync.js --login` e entre na Keeta uma vez.
5. Teste: `Start-ScheduledTask -TaskName PateoAgentKeeta` e leia `C:\PateoAgentKeeta\logs\keeta-AAAA-MM-DD.log`.

O `config.json` guarda a senha da Keeta e o token do ERP. O instalador restringe a leitura a
Administradores e ao usuário atual. **Nunca** coloque esse arquivo no repositório (está no `.gitignore`).

## Códigos de saída

| Código | Significado |
|---|---|
| 0 | Sincronizou |
| 1 | Erro (rede, ERP, relatório). O ERP recebe heartbeat de erro com a mensagem |
| 2 | A Keeta pediu login que o agente não resolve sozinho |

## Testes

```powershell
npm test
```

Cobrem só as regras puras (`src/logica.js`): períodos, pedido do relatório, escolha do arquivo pronto,
cabeçalhos reaproveitados. A parte do navegador precisa de uma sessão real da Keeta e é validada na máquina.

## Limites conhecidos

- O protocolo do portal (`/api/operate/data/download/...`) **não é uma API oficial**. Se a Keeta mudar a
  tela ou as rotas, o agente falha com mensagem clara e o painel de cobertura mostra "Atrasado". O plano
  é trocar este agente pela API oficial (webhooks de pedido) quando a Keeta liberar o acesso.
- Os campos de login (e-mail, "Continuar", senha) são localizados pelo que a tela mostra. Se mudarem, o
  agente salva uma imagem de diagnóstico em `logs/` e pede login manual.
