# Fase 5 — Inventário completo de rotas

> Gerado a partir do `App.tsx` (branch `feat/design-system-pateo-luz`, commit `2ed313d`).
> Total: **34 rotas declaradas** → **26 componentes de página distintos** + 2 telas fora do router (Login, ForcedPasswordChange) + 1 rota dev-only (/design-system).
>
> Legenda "Estado atual": **DS** = importa de `design-system/`; **legacy ui** = importa de `components/ui` (StatusBadge, SummaryCard, EmptyState, Dialog, ConfirmDialog, Tabs); **cru** = HTML/inputs nativos + Notice, sem componentes de UI compartilhados.
> "Está no handoff?" é inferência minha a partir das telas que o handoff desenhou — itens com **?** precisam de confirmação sua.

## Rotas

| Rota | Componente | Grupo | Está no handoff? | Estado atual (imports DS/legacy) | Complexidade migração | Onda proposta |
|---|---|---|---|---|---|---|
| `/` | Dashboard | Visão geral | Sim (versão financeira, diferente da atual) | cru — zero imports de ui, layout próprio (644 ln) | Alta (decisão de produto pendente) | **E** (bloqueada) |
| `/dashboard` | redirect → `/` | Visão geral | — | — | — | — |
| `/compras`, `/compras/nova`, `/compras/:id/editar` | Purchases | Operação | Não | legacy ui (StatusBadge) + Notice + PeriodFilter (2.812 ln ⚠️) | Média-alta — layout DS-friendly, mas arquivo gigante | A |
| `/compras/pedidos` | PurchaseOrders | Operação | Não | legacy ui (EmptyState, StatusBadge, SummaryCard) + Notice (251 ln) | Baixa | A |
| `/financeiro/contas-a-pagar` | Payables | Financeiro | Sim (KPIs + tabela) | Notice, sem ui compartilhado (1.122 ln) | Média | B |
| `/financeiro/faturamento` | Revenue | Financeiro | Sim (KPIs + tabela) | Notice + PeriodFilter (932 ln) | Média | B |
| `/financeiro/cartoes` | Cards | Financeiro | ? (KPI atípico) | Notice + PeriodFilter (779 ln) | Média | E |
| `/financeiro/caixa` | Cash | Financeiro | Não | Notice, formulário denso (540 ln) | Média | C |
| `/financeiro/dre` | DRE | Financeiro | Não | Notice + DRECategoryOptions (1.358 ln) | Alta — layout denso próprio | C |
| `/financeiro/impostos` | TaxPayments | Financeiro | Não | Notice, formulários crus (772 ln) | Média | E |
| `/financeiro/ciclos-fornecedor` | SupplierCycles | Financeiro | Não | legacy ui (Dialog) + Notice (1.133 ln) | Média | A |
| `/cmv/real` | CmvReal | CMV | Não | legacy ui (ConfirmDialog) + Notice (946 ln) | Média-alta | E |
| `/cmv/fechamento-mensal` | MonthlyClosing | CMV | Não | Notice + PeriodFilter (276 ln) | Baixa-média | E |
| `/estoque/visao-geral` | Inventory (view `overview`) | Estoque | Sim (KPIs + tabela) | legacy ui (ConfirmDialog, EmptyState, StatusBadge, SummaryCard) + Notice + PeriodFilter + SimpleBarChart | Alta ⚠️ arquivo único de 3.409 ln com 5 views | B |
| `/estoque/movimentacoes` | Inventory (view `movements`) | Estoque | Não | idem (mesmo arquivo) | Alta ⚠️ | C |
| `/estoque/contagens` + `/estoque/contagens/:sessionId/lancar` | Inventory (view `counting`) | Estoque | Sim | idem (mesmo arquivo) | Alta ⚠️ | B |
| `/estoque/inventario` | Inventory (view `inventory`) | Estoque | Não | idem (mesmo arquivo) | Alta ⚠️ | C |
| `/estoque/relatorios` | Inventory (view `reports`) | Estoque | ? — não estava nas suas 5 ondas | idem (mesmo arquivo) | Alta ⚠️ | C (adicionada por mim) |
| `/estoque/planejamento-compra` | PurchasePlanning | Estoque | ? — não estava nas suas 5 ondas | legacy ui (StatusBadge, EmptyState, Dialog) (1.218 ln) | Média | C (adicionada por mim) |
| `/estoque/produtos` | Products | Estoque | Sim (tabela canônica) | legacy ui (EmptyState, StatusBadge, SummaryCard) + Notice + SimpleBarChart (1.072 ln) | Média | B |
| `/estoque/requisicoes` | Requisitions | Estoque | ? — não estava nas suas 5 ondas | legacy ui (EmptyState, StatusBadge) + Notice (766 ln) | Média | B (adicionada por mim) |
| `/inventory/counts/:agendaId` | redirect → `/estoque/contagens` | Estoque | — | — | — | — |
| `/cardapio/fichas-tecnicas` | Dishes (inclui seção "Categorias de pratos" — não é rota separada) | Cardápio | Não | Notice, formulários crus + Tabs próprios (680 ln) | Média | D |
| `/cadastros/fornecedores` | Suppliers | Cadastros | Não | Notice, formulário cru + tabela com quebra de texto (548 ln) | Baixa-média | A |
| `/cadastros/empresas` | Companies | Cadastros | Não | Notice, formulários crus + accordions (473 ln) | Baixa-média | A |
| `/dados/importacoes` | ImportsHub (Tabs 5-up: Faturamento, Compras, Cadastros, Inventário mensal, Histórico) | Dados | Não | shell de 90 ln que compõe ImportExcel (753 ln), CatalogImports (533 ln), RevenueImportPanel, MonthlyInventoryImportPanel, ImportHistoryPanel | Média-alta (5 painéis) | D |
| `/dados/importacoes/cadastros` | CatalogImports (rota direta, também vive como tab do hub) | Dados | Não | Notice, formulários crus (533 ln) | Média | D |
| `/configuracoes/pagamentos` | PaymentMethods | Configurações | Não | Notice, formulários crus (206 ln) | Baixa | D |
| `/configuracoes/cadastros-base` | MasterData (Tabs 5-up: Setores, Categorias, Subcategorias, Unidades, Tipos de gasto) | Configurações | Não | Notice, formulários crus (650 ln) | Média | D |
| `/configuracoes/usuarios` | Users | Configurações | Não | Notice + PasswordField, layout 2-col lista+editor (860 ln) | Média-alta (padrão 2-col a decidir) | D |
| `/configuracoes/auditoria` | Audit | Configurações | Não | PeriodFilter, log-viewer simples (82 ln) | Baixa | E |
| `/design-system` | DesignSystem (dev-only, `isLocal`) | — | — | vitrine do DS | Fora do escopo | — |
| `*` | redirect → fallback | — | — | — | — | — |

## Telas fora do router

| Tela | Estado | Observação |
|---|---|---|
| Login | ✅ já migrada (Fase 4D — LoginShell, Button, TextField, Alert) | — |
| ForcedPasswordChange | ✅ já migrada (Fase 4D — LoginShell, Button) | — |

## Fatos que mudam o plano

1. **Zero páginas de conteúdo usam o DS hoje.** Fora do shell (Sidebar/Topbar/AppShell/PageHeader) e do Login, todas as 26 páginas importam do `components/ui` legacy ou usam HTML cru. A Fase 5 é a migração inteira, não um complemento.
2. **`Inventory.tsx` é um monolito de 3.409 linhas servindo 5 rotas.** Migrar "Visão Geral" na Onda B e "Movimentações" na Onda C significa editar o mesmo arquivo em duas ondas. Recomendo extrair as views em arquivos separados como passo 0 da Onda B (refactor mecânico, sem mudança visual) — senão cada onda re-toca um arquivo gigante.
3. **`Purchases.tsx` (2.812 ln) está na Onda A "barata"**, mas o tamanho torna o re-skin menos trivial que Fornecedores/Empresas. Mantive na A, com ressalva.
4. **3 rotas não estavam em nenhuma das suas 5 ondas**: Requisições, Planejamento de compra e Estoque/Relatórios. Aloquei em B e C — confirme.
5. **"Categorias de pratos" não é rota**: é seção dentro de Fichas Técnicas (`Dishes.tsx`). Conta como parte da migração da Onda D dessa tela.
6. **DS atual** (componentes prontos): Button, Card, KpiCard, SummaryCard, StatusBadge, Alert, EmptyState, TextField, Select, Tabs, PageHeader, Sparkline, Money, Percent + shell. **Faltam para a Fase 5**: FormField/FormGrid/FormSection, Table, Dialog/ConfirmDialog, DropdownMenu, Toast/Notice, Tooltip, layout 2-col — ver `fase-5-padroes.md`.

## Legacy `components/ui` a absorver ou substituir

AlertDialog, ConfirmDialog, Dialog, DropdownMenu, EmptyState*, PageHeader*, Select*, StatusBadge*, SummaryCard*, Tabs*, alert*, Toast, Tooltip — os marcados com * já têm equivalente no DS (migração = troca de import); os demais precisam ser portados para o DS antes das ondas que dependem deles (Dialog/ConfirmDialog → Ondas A/B; DropdownMenu → padrão de ações de tabela; Toast/Notice → todas).
