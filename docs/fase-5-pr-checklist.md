# PR Checklist — Design System Pateo da Luz

## Nome sugerido do PR

```
feat(design-system): migração completa Pateo da Luz
```

## Descrição para GitHub (copiar/colar)

```markdown
## Resumo

Migração completa do ERP Pateo da Luz para o Design System interno. **26 telas** migradas (12 do DS spec + 14 extras), **64 commits** em `feat/design-system-pateo-luz`, **235 testes verdes**.

Relatório final: [`docs/fase-5-relatorio-final.md`](docs/fase-5-relatorio-final.md).

## Ondas

- **Fase 1-4**: Tokens do handoff, kit.css como referência, 20+ primitivos com testes, shell (Sidebar/Topbar/AppShell/LoginShell/ContentErrorBoundary).
- **Fase 5.0**: Fundação de captura visual (script playwright + vitrine `/design-system`).
- **Ondas 5.B → 5.E**: 23 telas re-skinadas em 4 ondas sequenciais, cada uma revisada visualmente por batch de screenshots.

## O que muda para o usuário final

- Interface visual unificada (tipografia Inter, tokens de cor da marca, spacing consistente).
- Máscaramento de valores via toggle "Ocultar valores" na topbar (`<Money hidden>` propaga por `HideValuesContext`).
- Formatação pt-BR em todos os percentuais (`0,0%` em vez de `0.0%`) — util `formatPercent` compartilhado.

## O que muda para dev

- Novos primitivos em `src/design-system/` — vitrine em `/design-system` (rota dev-only).
- Modo `?mock-user=1` para revisão do shell sem backend (Fase 4A, `MockUserBadge` via portal).
- `ContentErrorBoundary` envolvendo `<Routes>` — crash em uma página não derruba mais o shell inteiro.

## Fixes fora do escopo strict do re-skin (mas incluídos)

- Guards defensivos contra `undefined.filter/.map/.length` em callsites de API.
- Fix de `Money`/`Percent` para formato pt-BR consistente em 15 sites legacy.
- Correção do viewport preto (`html`/`body`/`#root` sem background) e do badge `MOCK USER` sombreado por stacking contexts.

## Descobertas fora de escopo (documentadas para follow-up)

- `docs/todos/inventory-routing.md` — 4 rotas de estoque renderizando a mesma view.
- Checkbox nativos remanescentes em ~3 telas (Fichas Técnicas, etc.) — trocar por `Switch` do DS.
- Acentos ausentes em strings hardcoded pré-existentes.

## Testes

`cd frontend && npm test` — 235 verdes.
`cd frontend && npm run build` — sem warnings novos, code-split ativo (framer + radix + react como vendor chunks).
```

## Instrução de teste manual para o reviewer

### Setup

```bash
cd frontend
npm install
npm run dev   # sobe em http://localhost:5174
```

### Roteiro (aprox. 10 min)

Todas as rotas abaixo com `?mock-user=1` na query — bypassa auth + intercepta fetch com shapes zerados:

**Fluxo básico do shell:**
1. `/?mock-user=1` — Dashboard com Sidebar + Topbar + 5 KpiCards
2. Clica no toggle **Ocultar valores** (ícone olho na topbar direita) — todos os `R$ X` viram `••••`; percentuais (`31,8%`) permanecem visíveis por design
3. Clica em qualquer item da Sidebar — navega, badge de "Pedidos de compra" mostra 0 (mock)
4. Redimensiona janela para < 720px — sidebar some, `<Menu>` mobile aparece na topbar mobile

**Primitivos e vitrine:**
5. `/design-system?mock-user=1` — vitrine de todos os primitivos (Buttons, Cards, StatusBadges, Alerts, Money com casos limite, etc.)

**Rotas críticas (13 amostradas):**
6. `/estoque/produtos?mock-user=1` — tabela + form em `ListDetailLayout`
7. `/estoque/contagens?mock-user=1` — Contagem de estoque
8. `/financeiro/contas-a-pagar?mock-user=1`
9. `/financeiro/faturamento?mock-user=1`
10. `/financeiro/dre?mock-user=1` — DRE tabelar; verificar `0,0%` (vírgula) em MARGEM FINAL
11. `/financeiro/impostos?mock-user=1`
12. `/cmv/real?mock-user=1`
13. `/cmv/fechamento-mensal?mock-user=1`
14. `/configuracoes/usuarios?mock-user=1` — shell customizado
15. `/configuracoes/pagamentos?mock-user=1`
16. `/cardapio/fichas-tecnicas?mock-user=1`
17. `/dados/importacoes?mock-user=1`
18. `/cadastros/fornecedores?mock-user=1`

**Login (sem mock-user):**
19. Rota `/` sem query — LoginShell com brand + "Desde 2003" + campos DS. (Requer backend offline para cair no fallback OU bloquear `/auth/me` no DevTools Network.)

### Critérios de aceitação

- [ ] Nenhuma tela mostra ContentErrorBoundary ("Esta página não pôde ser renderizada")
- [ ] Toggle **Ocultar valores** mascara Money mas preserva Percent
- [ ] Sidebar tem item ativo com marcador ouro à esquerda (`box-shadow: inset 3px 0 0 var(--gold)`)
- [ ] Nenhum `X.X%` (ponto) visível — só `X,X%` (vírgula)
- [ ] `/design-system` renderiza todos os primitivos sem quebrar

## Screenshots

**Commitados** em [`docs/screenshots/pr-final/`](docs/screenshots/pr-final/) — 28 PNGs
(4E-final × 4 + 5.0 vitrine + 5B × 6 + 5C × 6 + 5D × 5 + 5E × 6), ~5.3 MB. Memória
visual do PR para revisão remota via GitHub UI sem precisar clonar o repo.

`frontend/screenshots/` continua gitignored (lixo local, regerável). Ver
[`docs/screenshots/pr-final/README.md`](docs/screenshots/pr-final/README.md)
para índice completo e instruções de regerar.

## Backend CORS

**CORS não bloqueia merge** — documentado como ticket futuro em
[`docs/todos/backend-cors-frontend.md`](docs/todos/backend-cors-frontend.md).

TL;DR: whitelist atual (`pateo.sougni.com` + `localhost:5173/5174/3000`) cobre todos
os cenários usados nesse PR (mock-user bypass, proxy Vite em dev, domínio de prod).
Só precisa mexer se o frontend mudar de domínio ou aparecer novo ambiente.

## Comandos git para abrir o PR (não executar automaticamente)

```bash
# 1. Push da branch
cd C:/Projeto_pateo_Claude/pateo-da-luz
git push -u origin feat/design-system-pateo-luz

# 2. Abrir PR
# URL: https://github.com/sougni-dev-br/pateo-da-luz/compare/main...feat/design-system-pateo-luz
# Ou via gh CLI:
gh pr create \
  --base main \
  --head feat/design-system-pateo-luz \
  --title "feat(design-system): migração completa Pateo da Luz" \
  --body-file docs/fase-5-pr-checklist.md
```

## CI

Não há CI configurado neste repo (nenhum workflow em `.github/`). Reviewer roda localmente:

```bash
cd frontend
npm test                # vitest — deve mostrar 235/235
npx tsc --noEmit        # type check
npm run build           # vite build — checar bundle size + zero warnings
```

## Sumário one-liner para changelog

```
Design System Pateo da Luz: 26 telas migradas, 235 testes, bundle code-split, ContentErrorBoundary defensivo, Money+Percent formatação pt-BR, mock-user modo dev.
```
