# TODO — /estoque/inventario e /estoque/relatorios renderizam pixel-identico

## Sintoma
Screenshots `5C-inventario.png` e `5C-relatorios-de-estoque.png` sao
pixel-identicas. Mesma URL de conteudo ("Estoque / Inventario operacional"),
mesmos KPIs, mesmos botoes, mesmo form "Criar inventario manual".

Analogo para `/estoque/movimentacoes` e `/estoque/visao-geral` que
tambem tendem a renderizar o mesmo UI (nao verificado, mas o codigo
sugere).

## Diagnostico

**App.tsx (router)** — correto:
```tsx
<Route path="/estoque/visao-geral"      element={<InventoryRouteView initialView="overview" ... />} />
<Route path="/estoque/movimentacoes"    element={<InventoryRouteView initialView="movements" ... />} />
<Route path="/estoque/contagens"        element={<InventoryRouteView initialView="counting" ... />} />
<Route path="/estoque/inventario"       element={<InventoryRouteView initialView="inventory" ... />} />
<Route path="/estoque/relatorios"       element={<InventoryRouteView initialView="reports" ... />} />
```
Cinco rotas, cinco `initialView` distintos. Prop chega em Inventory.tsx
como esperado.

**Inventory.tsx (componente)** — incompleto:
- Tipo `InventoryView = "overview" | "movements" | "counting" | "inventory" | "reports"` — 5 valores.
- `useState<InventoryView>(...)` inicializa com `initialView`.
- Grep por `activeView === "reports" | "inventory" | "movements" | "overview"`: **zero matches**.
- Grep por `activeView === "counting"` / `activeView !== "counting"`: **~10 branches**.

Todos os branches internos so distinguem `counting` vs `!== counting`.
A opcao "not counting" cai no default: `<h2>Inventario operacional</h2>`
+ toolbar + form + tables (o Inventario operacional).

**Consequencia:** as URLs `/estoque/{visao-geral, movimentacoes, inventario, relatorios}`
todas renderizam a MESMA tela "Inventario operacional". So `/estoque/contagens`
tem UI distinto.

## Fix necessario
Nao e trivial (nao e mudanca de router). Precisa implementar as 3-4 views
faltantes em Inventory.tsx:
- `overview`: dashboard geral do estoque (KPIs + graficos, distinto do
  inventario operacional)
- `movements`: tabela de movimentacoes de estoque
- `reports`: tela de relatorios / exports
- `inventory` continua sendo o "Inventario operacional" atual

Alternativa mais barata: reduzir a sidebar para expor apenas 2 items
("Contagens" + "Inventario") e remover as outras 3. Perde funcionalidades
prometidas ao usuario mas alinha UI com codigo.

## Prioridade
- **Nao bloqueia** o PR do DS. Bug e pre-existente ao PR (tanto o codigo
  do Inventory quanto os matchers do router estao no repo desde antes
  do design-system).
- Revisitar em backlog separado. Sugerido: split em 4 commits (um por view),
  branch `feat/inventory-views`.

## Como conferir (para o proximo revisor)
1. Abrir `/estoque/inventario?mock-user=1` e `/estoque/relatorios?mock-user=1`
2. Comparar DOM: `document.querySelector('.content').innerHTML` sera
   identico.
3. Confirmar `activeView` state via React DevTools:
   sera `"inventory"` num, `"reports"` no outro — mas o render nao usa.
