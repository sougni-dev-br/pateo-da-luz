# Fase 5 — Relatório final (WIP)

Progresso: Ondas B e C concluídas + revisadas visualmente. Onda D em revisão. Onda E parcial.

## Descobertas fora de escopo

Itens encontrados durante a revisão visual do Fase 5 que **não foram corrigidos neste PR**
por ficarem fora do escopo (migração de telas para primitivos do DS). Documentados aqui
como próximos passos e para dar contexto ao reviewer.

### 1. `/estoque/inventario` e `/estoque/relatorios` renderizam pixel-idêntico

**Descoberto no:** Batch 2 (Onda C).

Router em `App.tsx` está correto — passa `initialView` distinto para cada uma das 5 rotas
de estoque (`overview`, `movements`, `counting`, `inventory`, `reports`). Porém
`Inventory.tsx` internamente só distingue `activeView === "counting"` vs `!== "counting"`
(grep por outras comparações retorna zero matches). Consequência: 4 URLs renderizam a
mesma tela "Inventário operacional".

**Escopo:** requer implementação de 3-4 views distintas em `Inventory.tsx` **ou**
consolidação da sidebar (remover items redundantes) — não é fix de 1 linha do router.
Pré-existente ao PR do DS.

**Documentado em:** `docs/todos/inventory-routing.md` (diagnóstico + 2 opções de
resolução). Sugerido: branch dedicada `feat/inventory-views`, split em 4 commits (um
por view).

### 2. Helpers locais de percentual com `.toFixed(N)%` (ponto em vez de vírgula)

**Descoberto no:** Batch 2 (Onda C), em DRE Gerencial ("MARGEM FINAL 0.0%").

**Corrigido neste PR** (não é fora de escopo, mas registro aqui para completude):
- `DRE.tsx` (commit `23f2cda`) — helper local `pct` corrigido.
- Sweep preventivo em `Dashboard.tsx`, `Dishes.tsx`, `Revenue.tsx`, `CmvReal.tsx`
  (commit `dfc1e81`) — 15 sites migrados para novo util `formatPercent` em `utils/format.ts`.
- Adicionado teste de regressão anti-ponto em `utils/__tests__/format.test.ts`.

### 3. Acentos ausentes em strings hardcoded

**Descoberto no:** Batch 1 (Onda B).

Várias telas mostram texto sem acento (`Historico`, `Producao`, `Observacoes`,
`codigo`, `mes`, `Identificacao`, `Requisicao`). É bug legacy de i18n de strings
hardcoded — anterior ao PR do DS.

**Escopo:** varredura regex em `frontend/src/pages/*.tsx`, commit separado, zero
impacto de layout. Não bloqueia este PR.

## Convenções aplicadas na Fase 5

_(a preencher no fechamento do PR — não é foco desta secção)_

## Métricas de fechamento

_(a preencher no fechamento do PR — linhas removidas de global.css, número de páginas
migradas, testes verdes, etc.)_
