# Pateo da Luz — Frontend

React 18 + Vite 8 + TypeScript. Consome o backend Node/Express em `http://localhost:3334` no dev (proxy via `vite.config.ts`).

## Scripts

```bash
npm install
npm run dev       # Vite dev server (porta 5174 padrao)
npm run build     # tsc + vite build → dist/
npm run preview   # serve o build
npm test          # Vitest (jsdom + @testing-library/react)
```

## Modo `?mock-user=1` (dev-only)

Bypassa autenticacao e backend inteiros para revisar o shell / DS sem
precisar do Postgres + Node rodando. Ativa por querystring; **so funciona
com `isLocal` (Vite dev), no-op em prod**.

Como usar:

```
http://localhost:5174/?mock-user=1
http://localhost:5174/estoque/produtos?mock-user=1
```

O que acontece:

- Um `AppUser` sintetico (ADMIN) e injetado no `SessionContext`
- `getMe()`, `getMenuFavorites()`, `getStockCountSessions()` sao pulados
- `window.fetch` e monkey-patched em `main.tsx` para responder qualquer
  chamada de API com `[]` (listas) ou `{}` (objetos) — nada quebra por
  falta de backend, mas as paginas mostram estado vazio
- Um badge `MOCK USER` aparece fixo no top-right para lembrar que a
  sessao nao esta consultando dados reais

Como desligar: remover `?mock-user=1` da URL e recarregar. O `fetch`
patch e instalado uma vez no mount do modulo; um refresh da pagina o
descarta se a querystring nao estiver mais presente.

Codigo em:
- `src/lib/mockUser.ts` — `isMockUserMode()`, `MOCK_USER`, `installMockFetch()`
- `src/components/MockUserBadge.tsx` — badge visivel
- `src/main.tsx` — chama `installMockFetch()` antes do `createRoot`
- `src/App.tsx` — usa `mockMode` para bypassar effects e inicializar user

Nao use em producao. Se aparecer em prod, e bug e o gate `isLocal` no
`mockUser.ts` esta furado.

## Rota `/design-system` (dev-only)

Vitrine viva dos primitivos do Design System (Money, Percent, Button,
Card, StatusBadge, Alert, EmptyState, PageHeader, Tabs, TextField,
Select, SummaryCard, KpiCard, Sparkline).

```
http://localhost:5174/design-system
```

Nao precisa de mock-user — a rota tem seu proprio early return em
`App.tsx` antes das checagens de sessao. Nao aparece na sidebar (fora
do array `sections` do App.tsx). Fica em `src/pages/DesignSystem.tsx`.
