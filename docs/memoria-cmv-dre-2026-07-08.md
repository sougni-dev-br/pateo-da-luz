# Memoria de Trabalho - CMV e DRE

Data: 2026-07-08
Projeto: Pateo da Luz
Ambiente principal validado: producao (`https://pateo.sougni.com`)

## Objetivo

Concluir e sanear a base da logica de CMV, mantendo uma regra unica por produto, e refletir isso corretamente no DRE e nas telas de acompanhamento.

Base definida para o calculo:

`Estoque inicial + Compras do mes - Estoque final`

## Regras de negocio consolidadas

1. Cada produto passa a carregar sua classificacao a partir da categoria de DRE do proprio cadastro.
2. O criterio de CMV do produto ja e suficiente para distinguir o que entra como produto/CMV e o que e despesa.
3. `Setor` e usado como direcional operacional da contagem de estoque, nao como regra final contabil.
4. Itens de limpeza e descartaveis podem entrar no CMV na visao gerencial por decisao de gestao.
5. Foi mantida a convivencia de duas visoes:
   - `Visao atual` / contabil
   - `Visao gerencial`

## Decisoes de classificacao tratadas durante o trabalho

Exemplos confirmados pelo usuario:

- `1197 COPO 200ML 50 UNI CX/20X50` -> `Descartaveis / Delivery` (`CMV_COMPRAS`)
- `1196 COPO ISOPOR 118ML C/20 CX. C50X20` -> `Descartaveis / Delivery` (`CMV_COMPRAS`)
- `1200 STELLA ARTOIS 600ML PURE GOLD` -> `Bebidas` (`CMV_COMPRAS`)
- `1198 RABO SALGADO` -> `Custo de Alimentos` (`CMV_COMPRAS`)
- `1203 QUEROSENE` -> `Material de Limpeza` (`DESPESAS_GERAIS`)
- `1199 BISCOITO PIRAQUE MAISENA` -> `Custo de Alimentos` (`CMV_COMPRAS`)
- `1204 BISCOITO RECHEADO` -> `Custo de Alimentos` (`CMV_COMPRAS`)
- `768 CO2 Gas Alim...` -> `Despesas Gerais`
- `947 Embalagens Diversas` -> `Despesas Gerais`
- `954 Pao Brioche` -> `Custo de Alimentos`
- `942 Forminha Papel Branca Lisa` -> entra na contagem
- `793 Doritos Nacho 75g` -> entra na contagem
- `1074 Merengue Orig. Master` -> entra na contagem
- `1076 Refresco em Po Tang 18g` -> entra na contagem
- `1059 COPO DE PAPEL DESCARTAVEL 110ML - C/50` -> `Descartaveis` e nao `Delivery`

Observacao importante:

- Mesmo quando um item e `Descartaveis` ou `Material de Limpeza`, ele pode entrar no CMV na visao gerencial, conforme decisao da gestao.

## Trabalho de saneamento da base

Foi conduzida analise para evitar "dado burro", com scripts auxiliares de auditoria/classificacao e exportacao de filas de revisao no backend.

Arquivos de apoio gerados no workspace:

- `backend/scripts/audit-cmv-base.ts`
- `backend/scripts/export-cmv-review-queues.ts`
- `backend/scripts/export-cmv-sanitization-report.ts`
- outros scripts de inspeção/classificacao em `backend/scripts/`

Artefatos exportados:

- `exports/cmv-base-sanitization-report-2026-07-08.md`
- `exports/cmv-lote1-proposta-2026-07-08.md`
- `exports/cmv-review-queues-2026-07-08/`

## Implementacao tecnica

### 1. Duas visoes de CMV

Foi implementada a separacao entre:

- `accounting`
- `managerial`

Resumo:

- `accounting`: preserva a leitura atual/contabil.
- `managerial`: inclui categorias gerenciais como `Material de Limpeza`, `Descartaveis` e `Descartaveis / Delivery` dentro da leitura de CMV.

### 2. Correcao do backend do DRE

Problema encontrado:

- A funcao de DRE ainda mantinha um bloco legado de agregacao de despesas apos a nova construcao das visoes.
- Isso contaminava os numeros do topo do DRE.

Correcao aplicada:

- Remocao do bloco duplicado/legado.
- Uso consistente da `accountingView` para os totais do topo.
- Ajuste de tipagem de `expenseGroups` para aderir ao contrato de `DreSummary`.

Arquivo principal ajustado:

- `backend/src/modules/dre/dre.routes.ts`

## Commits principais desta frente

- `7678d80` - deploy inicial das duas visoes
- `9ffedce` - ajuste da predicate gerencial no DRE
- `1622f67` - polimento inicial de copy/layout do frontend
- `e288574` - correcao do summary contabil do DRE
- `3a0ac7f` - melhoria do layout mobile dos filtros da DRE
- `c4c84f3` - refinamento dos cards resumo da DRE
- `f715298` - adaptacao da tabela da DRE para leitura mobile
- `eebeb48` - ocultacao definitiva da coluna `%` no mobile
- `252cdd9` - acabamento visual do drill panel da DRE

## Validacao em producao

Foi validado diretamente em `https://pateo.sougni.com`.

### DRE

Resultado validado:

- O topo do DRE passou a bater com a `Visao atual`.
- Exemplo validado em tela:
  - `CMV` topo: `R$ 52.139,25`
  - `Visao atual`: `R$ 52.139,25`
  - `Visao gerencial`: `R$ 52.302,17`

Conclusao:

- O problema de contaminacao do topo por logica antiga foi resolvido.

### UX/UI Desktop e Mobile

Melhorias aplicadas:

1. Barra de filtros da DRE reorganizada no mobile.
2. Cards do topo da DRE refinados para melhor leitura.
3. Tabela da DRE no mobile convertida para blocos de leitura por linha.
4. Coluna `%` escondida corretamente no mobile para evitar quebra visual.
5. Drill/expansoes receberam acabamento visual para acompanhar o restante da tela.

## Estado final desta frente

Ao final deste trabalho:

- a regra base do CMV ficou consolidada
- a leitura por categoria DRE do produto passou a ser o eixo principal
- as duas visoes de CMV ficaram disponiveis
- o DRE passou a refletir corretamente a visao contabil no topo
- a experiencia mobile da DRE foi significativamente melhorada

## Arquivos mais relevantes alterados

- `backend/src/modules/dre/dre.routes.ts`
- `frontend/src/pages/DRE.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/styles/global.css`

## Observacoes finais

1. Ainda existem scripts e artefatos de saneamento no workspace que documentam a trilha de classificacao e auditoria da base.
2. O modulo DRE ficou em um ponto bom de uso; novos ajustes daqui em diante tendem a ser refinamentos, nao correcoes estruturais.
3. Se esta memoria for reutilizada em outra conversa, ela representa bem:
   - a regra de negocio definida
   - as decisoes de classificacao
   - os commits de deploy
   - o estado final validado em producao
