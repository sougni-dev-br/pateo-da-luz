# BACKLOG — Débitos técnicos identificados

Registro vivo de achados que não foram endereçados no momento da descoberta.
Cada item traz origem, natureza da dívida, impacto atual e solução proposta —
para que a decisão de atacar (ou não) seja tomada com contexto explícito.

Não incluir aqui: features pendentes (usar issues), bugs em aberto (usar issues),
tarefas de curto prazo já em plano ativo. Aqui é dívida crônica que sobreviveu
a uma revisão consciente.

---

## Dívidas de banco / schema

### DB-001 — `Product.categoryId` sem índice

- **Origem:** database-reviewer, Passo 1 do Prompt 17 Fase 2 revisada
- **Dívida:** o FK `Product.categoryId` não tem `@@index([categoryId])` no schema Prisma. É lacuna preexistente — não foi introduzida pela mudança de `GET /master-data/categories?sectorId=X`.
- **Impacto atual:** baixo. Volume single-tenant (~2000 produtos, ~12 categorias). O endpoint que motivou a descoberta performa OK. Qualquer query que atravesse a relação `Category.products` (incluindo `include: { products: true }`) faz seq scan filtrado; barato hoje, crescerá mal se o catálogo de produtos aumentar bastante ou se histórico de compras passar a ser cruzado com categoria em queries hot.
- **Solução:** adicionar `@@index([categoryId])` em `Product` no schema Prisma + migration:
  ```sql
  CREATE INDEX CONCURRENTLY "Product_categoryId_idx" ON "Product"("categoryId");
  ```
  Não altera colunas, sem lock em produção (Postgres 16, `CONCURRENTLY`). Merece prompt próprio com plano de rollout.

### DB-002 — Índice composto opcional em `Product(categoryId, inventorySectorId, isActive, controlsStock)`

- **Origem:** database-reviewer, Passo 1 do Prompt 17 Fase 2 revisada (HIGH-2, marcado como backlog)
- **Dívida:** o filtro `some` de `GET /master-data/categories?sectorId=X` gera `EXISTS` correlacionado. Com índice composto seria fully index-covered.
- **Impacto atual:** desprezível. 12 execuções × 2000 produtos por chamada. Categorias mudam pouco; endpoint não é hot.
- **Solução:** só atacar se profiling mostrar que virou hotspot. Não fazer preventivamente.

---

## Dívidas de validação / robustez de input

### VAL-001 — `asText()` sem limite de tamanho / charset

- **Origem:** security-reviewer, Fase 1 do Prompt 17 (MEDIUM)
- **Dívida:** o helper `asText()` (em `backend/src/modules/inventory/inventory.routes.ts` L10) só faz trim e null-coerção. Não limita tamanho nem remove control chars. Valores passam para `scopeLabel` (`Setor - Categoria`) e mensagens de erro. Se o frontend deixar passar sem escape em algum lugar HTML, é vetor stored-XSS.
- **Impacto atual:** baixo em prática. Frontend React escapa por padrão em JSX; risco só emerge se algum dia renderizarem com `dangerouslySetInnerHTML` sobre esses campos. Também é helper transversal usado em dezenas de endpoints — endurecê-lo é mudança de larga escala.
- **Solução:** endurecer `asText()` com max-length (ex.: 120 chars) + strip de control chars, ou substituir por `zod.string().max(120).trim()` no boundary. Prompt próprio, com sweep de callsites para validar que o cap não quebra caso legítimo (nomes longos de fornecedor, notas etc.).

### VAL-002 — `sectorId` sem validação de CUID/UUID em `GET /master-data/categories`

- **Origem:** database-reviewer e security-reviewer, Passo 1 do Prompt 17 Fase 2 revisada (LOW, ambos)
- **Dívida:** o query param `sectorId` é aceito como string qualquer. Malformado devolve lista vazia silenciosamente em vez de 400.
- **Impacto atual:** nenhum de segurança (Prisma parametriza; sem custo anômalo). Só qualidade de API — resposta 200 com `[]` para input inválido é ambíguo.
- **Solução:** validar com zod (`z.string().cuid()` ou regex) e retornar 400. Alinha estilo com endpoints que já validam. Barato; qualquer prompt de hardening de API pode acumular esse item.

---

## Observações vigiadas (não são débitos a executar)

### OBS-001 — Race UX transitória no form de "Nova contagem" (SETORIAL + categoria)

- **Origem:** code-reviewer, Passo 2 do Prompt 17 Fase 2 revisada (MEDIUM, marcado como observação por decisão explícita)
- **O que é:** entre disparar o fetch de `getCategories(sectorId=B)` e a resposta chegar, existe uma janela em que `categoriesForSector` ainda contém a lista do setor anterior A. Se o `categoryId` selecionado por acaso existir na lista antiga, ele NÃO é limpo naquele instante — só depois do fetch resolver e o useEffect de sanity dispararem juntos.
- **Por que não vai virar ação:** o `onChange` do select de Setor já reseta `categoryId: ""` de forma síncrona no mesmo `setCountSessionForm`. A race só emergiria se `sectorId` mudasse por outro caminho (mudança externa de state, hot-swap de agenda etc.) — hoje não existe. O código converge corretamente após o fetch. Fetch local <100ms, imperceptível na prática.
- **Vigiar se:** aparecer qualquer outro caminho para mudar `sectorId` sem passar pelo `onChange` — ex.: pré-preenchimento vindo de deep-link, restauração de rascunho de form salvo. Nesse dia, reavaliar.

---

## Como atacar

- Cada item pode virar prompt independente. Não bundlar em "limpeza geral" — cada dívida tem tradeoff diferente.
- DB-001 é o mais próximo de FK hygiene padrão; provavelmente o primeiro a atacar quando abrir janela para migration.
- VAL-001 é o de maior superfície (many callsites); precisa audit antes de mexer.
- DB-002 e VAL-002 só valem se algum sinal (profiling, log de request malformado) justificar.
