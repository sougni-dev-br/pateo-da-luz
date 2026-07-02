# TODO — Dashboard crasha com `undefined.filter(...)`

## Sintoma
Ao abrir `/` (Dashboard) em `?mock-user=1` (sem backend), a página lança:
```
TypeError: Cannot read properties of undefined (reading 'filter')
```

O mock-fetch retorna `{}` para o endpoint `/dashboard` (shape objeto vazio). Dashboard.tsx faz `undefined.filter(...)` em algum campo esperado.

Reproduzido em: `feat/design-system-pateo-luz` branch, commit `c329e0b` (Fase 4A + mock-user).

## Reprodução
```
npm run dev
# abre http://localhost:5174/?mock-user=1
# console mostra o erro; ContentErrorBoundary intercepta e mostra EmptyState
```

## Comportamento atual (protegido)
`src/design-system/shell/ContentErrorBoundary.tsx` (commit `c329e0b`) captura o crash e mantém o shell renderizado. O usuário vê:
- Sidebar + PageHeader normais
- No content: `<Alert tone="error">Esta página não pôde ser renderizada.</Alert>` + `<EmptyState title="Página indisponível" description="Detalhe: {error.message}" />`

Sem esse boundary, o `AppShell` inteiro desmonta → tela branca.

## Investigação sugerida

1. Grep no `Dashboard.tsx` por `.filter(` — provavelmente é `data.something.filter(...)` ou `alerts.filter(...)`.
2. O `load()` usa `Promise.allSettled` para os 3 endpoints. Depois provavelmente:
   ```ts
   const dash = dashData.status === "fulfilled" ? dashData.value : null;
   ```
   Se `dashData.value` = `{}` (do mock), então `dash = {}` e `dash.something` = `undefined`. Um `.filter()` depois quebra.
3. Adicionar guards `?? []` nos campos que são iterados. Ex.:
   ```ts
   const filtered = (dash?.alerts ?? []).filter(...)
   ```

## Impacto real (não-mock)
Em produção, se o backend retornar um payload parcial (ex.: `{ok: true}` sem `alerts` ou sem `purchases`), o Dashboard crasha do mesmo jeito. O ErrorBoundary vai proteger o shell, mas o usuário vê a Dashboard indisponível.

**Portanto é bug real, não só mock.** Precisa dos guards de qualquer maneira.

## Prioridade
- **Não bloqueia** o PR do design-system atual — ContentErrorBoundary protege o shell.
- Revisitar depois. Sugerido: 1 commit próprio em outra branch, `fix(dashboard): guard undefined fields from partial payloads`.

## Referências
- Commit que capturou: `c329e0b` (adicionou o ErrorBoundary)
- Arquivo com o crash: `frontend/src/pages/Dashboard.tsx`
- Interceptador mock: `frontend/src/lib/mockUser.ts`
