# 99 Food — Checklist de validação (passo 2)

> Valida o sync financeiro (passo 1 + 2) ponta-a-ponta antes de habilitar em
> produção. Ordem pensada pra falhar barato: resolve a maior incerteza primeiro.
> Nada aqui é deploy — é validação. Deploy só com autorização explícita do Eli.

## O que já existe (não recriar)
- **App de teste (Sandbox):** APP ID `5764607767279568791` (tipo POS/OpenAPI).
- **Loja de teste bindada:** AppShopID `TESTE-PATEO-01` ↔ Shop ID `5764616440738483369`.
- Fluxo de **pedido** já validado em sandbox (auth por loja, upload de menu, callback `orderNew` → `NoventaNoveSale`).
- **Novo (a validar):** a **Financial API** (`getFinancialAccessToken` / `getBillDetails` / `getSettlements`) — nunca exercida ainda.

---

## ⚠️ Incerteza-chave (resolver ANTES de tudo)
O cliente financeiro bate em `openapi.99food.com` (**não há host sandbox documentado**). Duas perguntas em aberto:
1. O **app de teste** consegue autenticar e ler a Financial API em `openapi.99food.com`?
2. O **sandbox gera dados** de repasse/bill, ou só produção tem?

Se o sandbox não tiver dados financeiros, a validação de valores/sinais migra pro **pilot em produção com 1 loja** (Fase 5).

---

## Fase 0 — Smoke test do cliente financeiro (barato, ~15 min)
Objetivo: provar que auth + endpoints respondem, sem depender da UI.

- [ ] Rodar o **smoke test** `backend/_smoke_99_financial.ts` (standalone — NÃO toca no banco; só precisa do app_id/app_secret do app de teste). Testa auth financeiro + `getBillDetails` + `getSettlements` de uma vez:
  ```powershell
  cd backend
  $env:SMOKE_APP_ID = "5764607767279568791"
  $env:SMOKE_APP_SECRET = "<app_secret do app de teste>"
  npx tsx _smoke_99_financial.ts TESTE-PATEO-01 20260701 20260731
  ```
  Esperado: `auth OK` + veredito dizendo se veio **dado ou vazio** no período (com a distribuição de `orderType`, pra ver se há estornos).
- [ ] **Interpretar o resultado:**
  - `auth OK` + **com dados** → segue Fases 1–4 no sandbox.
  - `auth OK` + **vazio** → encanamento (auth+endpoints) OK; validação de valores/sinais vai pro pilot em produção (Fase 5). Tente outro período se houver histórico.
  - **Erro de auth/whitelist** → o app de teste não acessa a Financial API em `openapi.99food.com` (reportar à 99).

---

## Fase 1 — Configurar o ERP (loja + empresa)
- [ ] Substituir **um** `PENDENTE-99-*` pela loja real de teste: externalId = `TESTE-PATEO-01`, apelido claro.
- [ ] **Vincular a Empresa (companyId)** dessa loja — sem isso, `reflectSalesIntoRevenueEntries` não lança no DRE (é esperado, mas queremos testar o DRE).
- [ ] Confirmar `/status` do módulo: loja aparece como real (não placeholder).

---

## Fase 2 — Ter dados pra reconciliar
- [ ] Simular pedido(s) no portal sandbox → confirmar que chega `orderNew` → grava `NoventaNoveSale` (fluxo já validado antes).
- [ ] Confirmar (Fase 0) se há bill/settlement pro período. Se não houver no sandbox, pular pra Fase 5.

---

## Fase 3 — Rodar o sync e conferir a persistência
Disparar **Sincronizar** (mês do teste). ⚠️ **A tela do 99 hoje NÃO mostra o resultado por-loja** (só um alerta genérico) — conferir via **Prisma Studio** (`npm run prisma:studio`) ou query. Verificar:

- [ ] `NoventaNoveSale` — pedidos do período, com `noventaNoveFeeAmount` = comissão **real** (não a estimativa por %).
- [ ] `NoventaNoveSettlement` — repasses, com `netAmount` = `withdrawAmount`/100, e `grossAmount`/`totalFees` compostos (ou aviso de incompleto).
- [ ] `Receivable` — 1 por settlement, `sourceType = NOVENTA_NOVE_SETTLEMENT`, valores conferem.
- [ ] `RevenueEntry` — faturamento por dia (`sourcePlatform = NOVENTA_NOVE`), só se a loja tem companyId.
- [ ] `NoventaNoveMonthlyExpense` — taxas do mês (Contas a Pagar).
- [ ] `NoventaNoveSyncLog` — status `SUCCESS`/`PARTIAL` e `itemsProcessed`.

---

## Fase 4 — Validar os pontos que ficaram em aberto no código
- [ ] **Unidade monetária:** um valor conhecido bate ÷100? (ex.: pedido de R$ 15,00 → `orderAmount` 1500).
- [ ] **`orderId` casa** entre o `orderNew` (webhook) e o `getShopBillDetail`? Se não casar, duplica a venda (uma do webhook, uma do bill) — checar duplicatas em `NoventaNoveSale`.
- [ ] **`commissionRate`:** base 10000? (ex.: `3500` = 35%). Conferir contra a comissão real.
- [ ] **⚠️ SINAIS do estorno (o ponto mais importante):** gerar um **reembolso** no sandbox (total e parcial) e conferir:
  - `grossAmount`/`netAmount` do estorno entram **negativos** (reduzem faturamento)?
  - a **comissão** do estorno reverte corretamente (não infla a despesa)? (Na doc, `commissionAmount` de estorno aparece **positivo** — precisamos ver o comportamento real.)
  - o `RevenueEntry` do período fica com o **líquido** correto (venda − estorno)?

---

## Fase 5 — Idempotência + bordas
- [ ] Rodar o sync **2× seguidas** no mesmo mês → contagens e valores **não mudam** (converge, não duplica/dobra).
- [ ] **Virada de mês:** se houver repasse semanal cruzando o mês, conferir que o bruto/taxas foram compostos (borda anterior de 8 dias) — ou que o aviso de "repasse incompleto" apareceu.

---

## Fase 6 — Go/No-go pra produção (só após Fases 0–5 ok)
- [ ] Criar o **app de PRODUÇÃO** no portal (⚠️ irreversível: cada loja faz bind em só 1 app prod).
- [ ] **Bind de 1 loja real** (pilot) via `/stores/:id/authorization-url` — o dono autoriza.
- [ ] Trocar a credencial do ERP pra produção (environment `PRODUCTION`).
- [ ] Rodar o sync do pilot e repetir Fases 3–4 com dados reais.
- [ ] Confirmar os sinais de estorno com dados reais **antes** de confiar no Contas a Pagar.
- [ ] Só então: bind das demais lojas.

---

## Melhorias que valem antes/durante (deferidas, opcionais)
- **Refletir o resultado do sync na tela do 99** (espelhar `IfoodSettings.tsx`) — hoje os avisos `PARTIAL`/"repasse incompleto" só aparecem via banco/log. Torna a validação visual do Eli viável sem Prisma Studio.
- Tratar a race do upsert do Receivable **antes** do cron (passo 3).
