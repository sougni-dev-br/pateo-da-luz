# Fase 5 — Relatório final (fechado)

Migração completa do ERP Pateo da Luz para o Design System interno.

## Métricas

| | Valor |
|---|---|
| Telas migradas | **26** (12 do DS spec + 14 extras) |
| Commits na branch | **64** (`main..feat/design-system-pateo-luz`) |
| Testes | **235 verdes** em 31 arquivos |
| Linhas removidas de `global.css` | ~1000 (net; foram substituídas por CSS por-componente prefixado `.ds-*`) |
| Componentes primitivos do DS | 20+ (Money, Percent, Button, Card, StatusBadge, Alert, EmptyState, PageHeader, Tabs, TextField, Select, SummaryCard, KpiCard, Sparkline, IconButton, Table, FormField, FormGrid, FormSection, PanelEyebrow, RowMenu, ListDetailLayout) |
| Componentes de shell | 5 (AppShell, Sidebar, SidebarNav, Topbar, LoginShell, ContentErrorBoundary) |

## Ondas concluídas

| Onda | Escopo | Commits chave |
|---|---|---|
| **Fase 1-4** | Tokens, kit.css, primitivos, shell (Sidebar/Topbar/AppShell/LoginShell/ContentErrorBoundary) | `0f2e769` … `d27fc68` |
| **Fase 5.0** | Fundação: script `screenshot.mjs` + vitrine `/design-system` | `ae629b7` |
| **Bloco 1 (fixes visuais Fase 4)** | Money 2 decimais + robustez, ajustes Onda A | `5438689` |
| **Onda 5.A** | (base preparatória — refactors) | — |
| **Onda 5.B** | Contas a pagar, Faturamento, Estoque Visão Geral, Produtos, Contagem, Requisições (6 telas) | `15d4cbc` … `61f1bc4` |
| **Onda 5.C** | DRE, Caixa, Movimentações, Inventário, Planejamento de compra, Relatórios de estoque (6 telas) | `4d65618` … `f418c7b` |
| **Onda 5.D** | Pagamentos, Cadastros base, Usuários, Fichas Técnicas, Importações (5 telas) | `6a72b84` … `9abafbf` |
| **Onda 5.E** | Dashboard operacional, Cartões, Auditoria, Fechamento mensal, CMV Real, Impostos (6 telas) | `1a2bc85` … `ca4a1c0` |

## Fixes intercalados relevantes

- **Money com 2 decimais** + robusto contra `span { display: block }` legacy que quebrava o nowrap (`5438689`)
- **Percent formatação pt-BR** — util compartilhado `formatPercent(value, decimals)` em `utils/format.ts`; **15 sites migrados** em Dashboard, Dishes, Revenue, CmvReal + fix `pct()` local em DRE (`23f2cda`, `dfc1e81`)
- **4 clusters de mock shape corrigidos** para permitir `?mock-user=1` navegar sem crash:
  - Dashboard: `deltaPercent`, `bySupplier`, `byProduct` (`f74f353`)
  - DRE: `expenses`, `expenseGroups`, `revenue.byChannel` (previamente no `f74f353`)
  - Monthly: `/monthly/inventory`, `/monthly/cmv-real`, `/monthly/cmv-real/{bases,suggestions}` (`49fc6ae`)
  - Tax: `/tax-payments` com shape completo `{data, pagination, summary}` (`49fc6ae`)
- **Viewport preto no shell** (`html`/`body`/`#root` `height:100%` + `background: var(--app-bg-from)`) (`d443bf9`)
- **Badge `MOCK USER` via `createPortal`** em `document.body` + `z-index` int32-max (imune a stacking context de providers/AppShell) (`446ff1c`)
- **`ContentErrorBoundary` defensivo** envolvendo `<Routes>` — evita tela branca; mantém shell (sidebar/topbar) visível quando qualquer página crashar em render, mostrando `<Alert tone="error">` + `<EmptyState>` no lugar do content (`c329e0b`)
- **Guards defensivos contra `undefined.filter/.map/.length`** em callsites de API sem defesa (Products, Dashboard, etc.) — padrão universal pré-existente exposto pelo mock (`722d7de`)
- **Code-split** framer + radix + react em chunks vendor separados (`b17a961`)

## Descobertas fora de escopo

Documentadas em `docs/todos/` para próximos passos após merge do PR do DS:

1. **Inventory routing** (`docs/todos/inventory-routing.md`) — `/estoque/{visao-geral, movimentacoes, inventario, relatorios}` renderizam pixel-idêntico. Router passa `initialView` distinto mas `Inventory.tsx` só distingue `counting` vs `!== counting`. Requer implementação de 3-4 views distintas **ou** consolidação da sidebar. Bug pré-existente ao PR.
2. **Formulários com checkbox nativo remanescentes** — ~3 telas (Fichas Técnicas "Mostrar inativos" + outros) usam `<input type="checkbox">` cru. Trocar por `Switch` do DS (a criar/promover). Não urgente.
3. **Acentos legacy em strings hardcoded** — `Historico`, `Producao`, `Observacoes`, `codigo`, `mes`, `Identificacao`, `Requisicao` em várias páginas. Bug de i18n pré-existente. Varredura regex em `src/pages/*.tsx`, commit separado, zero impacto de layout.

## Não regressões descobertas

Todas as anomalias encontradas na revisão visual (Checkpoint 2) foram **Caso A — shape de mock incompleto**. Nenhuma foi Caso B (regressão do re-skin) ou Caso C (bug pré-existente exposto pelo re-skin). O DS não introduziu bug lógico em nenhuma das 26 telas.

O único item que gerou dúvida (aparente eyebrow "Resumo financeiro" duplicado no Dashboard) foi **confusão visual entre "RESUMO FINANCEIRO" e "RESULTADO ESTIMADO"** — DOM confirmado com `count=1` via `preview_eval`. Sem código a corrigir.

## Convenções aplicadas

- **Namespace CSS**: todos os primitivos usam prefix `.ds-*` para blindar contra colisão com classes legadas em `global.css`.
- **Zero hex hardcoded fora de `styles/tokens/`** — grep de `#[0-9a-fA-F]{3,6}` em `src/design-system/**` retorna 9 hits, todos justificados em commit messages (dark-mode text/icon shades da Sidebar).
- **`kit.css` vence** o README quando divergem — regra estabelecida no início da Fase 3.
- **Testes por componente** com Vitest + Testing Library — cobertura de render, acessibilidade (aria-*), interação e edge cases (null/undefined).
- **Auto-aprovação por critérios objetivos** entre 4B/4C/4D + subfases 5.A/B/C/D/E; gates humanos apenas em fim de Fase 4 e início/fim de Fase 5.
