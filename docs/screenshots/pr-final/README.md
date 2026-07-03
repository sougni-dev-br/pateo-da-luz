# Screenshots finais — PR do Design System

Memória visual do estado do ERP após a migração completa para o Design System interno.
Todos os PNGs foram capturados via Playwright em viewport `1440×900`, `fullPage: true`,
autenticados com o modo dev `?mock-user=1` (exceto `4E-final-login.png` que bloqueia
`/auth/me` para forçar o fallback).

Pasta gerada uma única vez ao fechar a Fase 5 — não regerar por padrão. Se precisar
atualizar, rode `frontend/scripts/capture-fase5-batches.mjs` + `capture-fase4-final.mjs`
+ `screenshot.mjs` e recopie os arquivos.

## Índice

### Fase 4 — fechamento do shell (4 PNGs)
- `4E-final-dashboard.png` — Dashboard operacional com shell completo (sidebar + topbar + KpiCards)
- `4E-final-produtos.png` — Estoque · Produtos com `ListDetailLayout`
- `4E-final-fornecedores.png` — Cadastros · Fornecedores (tabela)
- `4E-final-login.png` — LoginShell fallback (auth bloqueado) com brand "Gestão Pateo da Luz" + badge "Desde 2003"

### Fase 5.0 — vitrine (1 PNG)
- `5.0-design-system-completo.png` — Rota `/design-system` (dev-only) com todos os primitivos (Money com casos limite, Buttons, Cards, StatusBadges, Alerts, EmptyState, Tabs, TextField, Select, SummaryCard, KpiCard, tokens de cor/tipografia/spacing)

### Onda 5.B (6 PNGs)
- `5B-contas-a-pagar.png` → `/financeiro/contas-a-pagar`
- `5B-faturamento.png` → `/financeiro/faturamento`
- `5B-estoque-visao-geral.png` → `/estoque/visao-geral`
- `5B-produtos.png` → `/estoque/produtos`
- `5B-contagem-de-estoque.png` → `/estoque/contagens`
- `5B-requisicoes.png` → `/estoque/requisicoes`

### Onda 5.C (6 PNGs)
- `5C-dre.png` → `/financeiro/dre` (verificar `0,0%` na MARGEM FINAL — pt-BR)
- `5C-caixa.png` → `/financeiro/caixa`
- `5C-movimentacoes.png` → `/estoque/movimentacoes`
- `5C-inventario.png` → `/estoque/inventario`
- `5C-planejamento-de-compra.png` → `/estoque/planejamento-compra`
- `5C-relatorios-de-estoque.png` → `/estoque/relatorios`

### Onda 5.D (5 PNGs)
- `5D-pagamentos.png` → `/configuracoes/pagamentos`
- `5D-cadastros-base.png` → `/configuracoes/cadastros-base`
- `5D-usuarios.png` → `/configuracoes/usuarios` (shell customizado)
- `5D-fichas-tecnicas.png` → `/cardapio/fichas-tecnicas`
- `5D-importacoes.png` → `/dados/importacoes`

### Onda 5.E (6 PNGs)
- `5E-dashboard-v2.png` → `/` (dashboard operacional — v2 pós-fix do cluster CMV+fiscal)
- `5E-cartoes.png` → `/financeiro/cartoes`
- `5E-auditoria.png` → `/configuracoes/auditoria`
- `5E-fechamento-mensal-v2.png` → `/cmv/fechamento-mensal` (v2 — pré-fix caía no `ContentErrorBoundary`)
- `5E-cmv-real-v2.png` → `/cmv/real` (v2 — pré-fix caía no boundary)
- `5E-impostos-v2.png` → `/financeiro/impostos` (v2 — pré-fix caía no boundary)

**Total: 28 PNGs, ~5.3 MB.**

## O que `-v2` significa

3 telas do cluster CMV+fiscal (`/cmv/fechamento-mensal`, `/cmv/real`, `/financeiro/impostos`) caíam no `ContentErrorBoundary` no primeiro batch porque o `mockUser.ts` não cobria os endpoints `/monthly/inventory`, `/monthly/cmv-real*` e retornava array vazio pra `/tax-payments` (que espera shape objeto). O fix (commit `49fc6ae`) adicionou specials para esses endpoints. Os `-v2` são as capturas pós-fix, todas renderizando limpas.

`5E-dashboard-v2.png` também é v2 (regerado no mesmo pass) para consistência.

## Como regerar (se precisar)

```bash
# 1. Sobe o dev server
cd frontend
npm run dev

# 2. Em outro terminal — checa a porta (Vite pode escolher 5175/5176 se 5174 ocupado)
# 3. Roda os 3 scripts:
PREVIEW_URL=http://localhost:5174 node scripts/capture-fase4-final.mjs
PREVIEW_URL=http://localhost:5174 node scripts/capture-fase5-batches.mjs
node scripts/screenshot.mjs "http://localhost:5174/design-system" screenshots/5.0-design-system-completo.png ".ds-showcase"

# 4. Copia pra cá
cp frontend/screenshots/{4E-*,5.0-*,5B-*,5C-*,5D-*,5E-*}.png docs/screenshots/pr-final/
```

## Política

`frontend/screenshots/` continua gitignored (é lixo local, regerável). Só esta pasta
(`docs/screenshots/pr-final/`) é commitada — memória visual do PR para revisão remota
via GitHub UI sem precisar clonar o repo e rodar playwright.
