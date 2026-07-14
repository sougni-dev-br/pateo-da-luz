# Arquitetura CMV & DRE v2 — separação Ciclo Operacional vs Mês Contábil

> **Status:** especificação, ainda não implementada.
> **Autor:** discutido entre Eli e Claude em 2026-07-14, decisões consolidadas nesta sessão.
> **Contexto:** Pateo da Luz opera dentro do Shopping Frei Caneca, com eventos que atrasam contagens físicas de estoque. Datas fixas de 01 e 30/31 do mês não refletem a operação real. O sistema atual (v1) mistura conceitos de competência contábil com ciclo operacional, gerando distorções no CMV%.

## Problema em uma linha

O sistema mistura **quando a operação contou o estoque** (evento físico, data flexível) com **em que mês contábil isso conta** (calendário fiscal). O CMV Real precisa da primeira; o DRE precisa da segunda; hoje o código cruza os dois na mesma fórmula.

## Modelo v2 — duas dimensões

### Dimensão A — Mês Contábil (competência)

| Característica | Valor |
|---|---|
| Fronteiras | Sempre 01 → último dia do mês calendário |
| Campo modelo | `Purchase.competenceMonth/Year`, `RevenueEntry.competenceMonth/Year` |
| Uso | DRE mensal, impostos (DAS/ISS/INSS/FGTS), despesas fixas (aluguel, folha, contador), relatórios para o contador |
| Regra | Rígida. Cada lançamento pertence a exatamente um mês contábil. |

### Dimensão B — Ciclo Operacional de CMV

| Característica | Valor |
|---|---|
| Fronteiras | `snapshotInicial.countDate` → `snapshotFinal.countDate` (datas reais das contagens físicas) |
| Campo modelo | `CmvPeriod.dataInicial/dataFinal` (já existe) |
| Uso | CMV Real, margem operacional, análise de perdas/desvios |
| Regra | Flexível. Ciclo pode extrapolar meses, pode ter comprimento variável, pode ter gaps entre ciclos consecutivos (embora ideal seja sequencial sem gap). |

## Regra chave

> **DRE → mês calendário (competência).**
> **CMV Real → data efetiva das contagens (ciclo).**
> **Nunca cruzar os dois filtros na mesma fórmula.**

## Fórmulas alinhadas

### CMV Real (dimensão B)

```
CMV Real = EI + Compras_ciclo − EF

Onde:
  EI              = snapshotInicial.totalValue
  EF              = snapshotFinal.totalValue
  Compras_ciclo   = SUM(PurchaseItem.totalPrice)
                    WHERE purchaseDate > snapshotInicial.countDate
                      AND purchaseDate <= snapshotFinal.countDate
                      AND dreGroup IN (accounting | managerial predicate)

Faturamento_ciclo = SUM(RevenueEntry.netAmount)
                    WHERE date > snapshotInicial.countDate
                      AND date <= snapshotFinal.countDate

CMV %           = CMV Real / Faturamento_ciclo
Margem bruta    = Faturamento_ciclo − CMV Real
```

**Mudança-chave vs v1:** compras filtradas por `purchaseDate` (real), não por `MAKE_DATE(competenceYear, competenceMonth, 1)` (mês inteiro).

### Fechamento Contábil Mensal (dimensão A) — nova tela

```
Compras_mês       = SUM WHERE competenceMonth = M AND competenceYear = Y
Faturamento_mês   = SUM(netAmount) WHERE date within calendar month
Despesas_fixas    = expenses lançadas com competência do mês
Impostos          = TaxPayment com competenceDate no mês
CMV_atribuído_mês = SUM sobre CmvPeriods que interceptam o mês, rateado

Rateio: por dias corridos.
  Para cada CmvPeriod que intercepta o mês M:
    dias_no_mês = min(cycleEnd, mesEnd) − max(cycleStart, mesStart) + 1
    dias_totais_ciclo = cycleEnd − cycleStart + 1
    contribuição = cmv_do_ciclo × (dias_no_mês / dias_totais_ciclo)
  CMV_atribuído_mês = soma das contribuições
```

**Decisão 1 (Eli, 2026-07-14):** rateio por dias corridos, não por faturamento nem por 100% num mês só.

## Migração e comportamento

### Recálculo retroativo

**Decisão 3 (Eli, 2026-07-14):** ao aplicar o refactor, todos os `CmvPeriod` existentes são recalculados com a nova regra. Cada apuração recebe uma flag ou linha de audit indicando "recalculado pelo refactor CMV-v2 em YYYY-MM-DD".

Efeito prático:
- CMV-2026-0001 (abril) e CMV-2026-0002 (junho) recebem novos valores de compras (por data, não por competência)
- Snapshots iniciais/finais não mudam
- Faturamento_ciclo não muda (já era por data)
- CMV% atualiza automaticamente

O audit log preserva os valores antigos.

### Alerta de fronteira de mês

**Decisão 2 (Eli, 2026-07-14):** se um `CmvPeriod` cruza fronteira de mês (ex.: `dataInicial` em jun, `dataFinal` em jul), o sistema **alerta** o usuário na tela mas **não bloqueia** a operação. Usuário decide caso a caso se aceita ou refaz.

Alerta sugerido:
> ⚠️ Este ciclo atravessa dois meses contábeis (junho e julho). O CMV será rateado por dias corridos: X dias em jun + Y dias em jul. Confirme ou ajuste as datas antes de fechar.

## Impacto por tela

### Tela CMV Real (existente)

- Renomear/subtítulo: "Ciclo operacional entre contagens"
- Aviso proeminente: "Este é o CMV entre contagens físicas, não o CMV mensal do DRE. Para DRE, veja Fechamento Contábil Mensal."
- Dropdown "Estoque inicial/final" filtrado apenas por `InventorySnapshot ACTIVE tipo INVENTARIO_INICIAL/INVENTARIO_FINAL` e `OperationalInventory FECHADO tipo FINAL_CMV` — sessões individuais só via toggle "avançado" (ver task #14)
- Ao selecionar snapshotInicialId, autopreencher dataInicial = `snapshot.countDate`. Override exige justificativa (task #20)
- Alerta se ciclo cruza fronteira de mês (decisão 2)
- PDF de CMV Real ganha aviso de canais faltantes (task #19)

### Tela Fechamento Contábil Mensal (nova)

Rota sugerida: `/fechamento-mensal/YYYY-MM`

Painel único com checklist visual (task #17):
```
Compras contábeis (competência)        R$ ✅
Faturamento contábil (mês calendário)  R$ ✅
Despesas fixas do mês                  R$ ⏳
Impostos do mês                        R$ ⏳
CMV atribuído ao mês (rateio)          R$ (calculado)
Justificativas registradas             lista
[Travar mês]
```

### Tela CMV Ciclos (nova, opcional)

Timeline horizontal de todos os `CmvPeriod` com datas, ciclos e CMV%. Ajuda o Eli a visualizar continuidade e detectar gaps.

## Refactors de código

### Backend

1. **`cmv-purchase-base.service.ts`** — reescrever as funções `getCmvPurchase*ByCompetenceRange` para filtrarem por `purchaseDate BETWEEN startDate AND endDate` em vez de `MAKE_DATE(competenceYear, competenceMonth, 1)`. Manter as funções por competência (`getCmvPurchaseTotalByCompetenceMonth`) para uso do Fechamento Mensal.

2. **`cmv-real.service.ts`** — `revenueTotals`, `purchaseTotals`, `revenueByChannel` já usam `startDate+1 → endDate`; verificar que estão coerentes e ajustar labels ("Movimentos considerados: X a Y" onde X e Y são as datas efetivas dos snapshots).

3. **Novo módulo `fechamento-mensal/`** — endpoint que agrega compras (competência), faturamento (mês calendário), despesas fixas, impostos, e CMV rateado. Persiste em `MonthlyCmv` (renomear conceitualmente).

4. **Rateio de CmvPeriod → mês** — função nova `getCmvAttributedToMonth(year, month)` que soma contribuições rateadas de todos os CmvPeriods que interceptam o mês.

5. **Alerta de cruzamento de mês** — validação no create/update de CmvPeriod: se `dataInicial.month !== dataFinal.month || dataInicial.year !== dataFinal.year`, retornar warning (não erro).

6. **Recálculo em massa** — script único que reprocessa CmvPeriods existentes com a nova regra, populando um campo `recalculadoEm` e mantendo `cmvRealAntigo` no audit para rastreabilidade.

### Frontend

1. Renomear/re-subtitular tela CMV Real conforme acima
2. Filtrar dropdowns (task #14)
3. Auto-fill dataInicial ao escolher snapshot (task #20)
4. Nova tela `/fechamento-mensal/YYYY-MM` (task #17)
5. Nova tela `/cmv/ciclos` opcional (timeline)

### Prisma schema

- Adicionar `CmvPeriod.recalculadoEm DateTime?` e `CmvPeriod.recalculoVersao String?`
- Adicionar `MonthlyCmv.cmvAtribuido Decimal @db.Decimal(14, 2)` (separado de `realCmvValue` que era do ciclo)
- Adicionar `MonthlyCmv.rateioDetalhado Json?` (breakdown por ciclo contribuinte)

## Não-objetivos deste refactor

- Não mudar como Purchase captura competenceMonth/Year (continua sendo campo manual do lançamento)
- Não introduzir novo tipo de inventário
- Não mudar o fluxo de consolidação de contagens setoriais
- Não bloquear ciclos que cruzam mês (só alertar)

## Doc relacionado

- [regra-fechamento-cmv-dre.md](regra-fechamento-cmv-dre.md) — checklist normativo original (será atualizado para refletir v2 após implementação)

## Tasks associadas

Ver task list do agente:
- #14 UX CMV Real: filtrar dropdowns
- #17 Painel de Fechamento Mensal
- #18 Fix filtro compras vs faturamento
- #19 Alerta de canais zerados no PDF
- #20 Alinhar dataInicial ao snapshot
- #21 Arquitetural: separar Ciclo CMV de Mês Contábil (este doc)

Todas as tasks acima serão executadas juntas como um pacote coerente quando Eli autorizar a próxima sessão de implementação.
