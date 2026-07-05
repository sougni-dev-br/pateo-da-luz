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

### OBS-019 — Design system não possui componente `Autocomplete`; `Purchases.tsx` (e possivelmente outras telas) reimplementam padrão custom local

- **Origem:** auditoria OBS-008/009/010 (2026-07-05). Grep em `Purchases.tsx:1592-1662` revelou implementação completa de autocomplete via CSS classes (`autocomplete-shell`, `autocomplete-dropdown`, `autocomplete-option`, `autocomplete-clear`, `autocomplete-chevron`) + estado (`supplierFilterQuery`, `supplierFilterOpen`, `supplierFilterRef`) + lógica de handlers.
- **O que é:**
  - Design system em `frontend/src/design-system/components/` tem 24 componentes primitivos (`Alert`, `Button`, `Card`, `EmptyState`, `FormField`, `FormGrid`, `FormSection`, `IconButton`, `KpiCard`, `ListDetailLayout`, `Money`, `PageHeader`, `PanelEyebrow`, `Percent`, `RowMenu`, `Select`, `Sparkline`, `StatusBadge`, `SummaryCard`, `Switch`, `Table`, `Tabs`, `TextField`, `Textarea`).
  - **Nenhum deles cobre o padrão Autocomplete** (input com dropdown filtrável).
  - `Purchases.tsx` implementa Autocomplete de Fornecedor localmente.
  - Suspeita: `Suppliers.tsx`, `Companies.tsx`, `PurchasePlanning.tsx` e potencialmente outras telas usam padrão similar (não verificado via grep sistemático).
- **Impacto:** nenhum bug funcional. Dívida técnica de padronização. **Bloqueia decisão arquitetural sobre [[OBS-010]]** (filtros de Compras) — não dá para migrar o bloco de filtros para DS enquanto o autocomplete de fornecedor não tiver destino claro.
- **Ideias de melhoria:**
  1. Grep de varredura pelo padrão `autocomplete-shell` no repo. Se encontrar 3+ ocorrências em telas diferentes, criar componente `Autocomplete` no DS.
  2. Se só `Purchases.tsx` usa, manter custom local até 2a tela precisar.
  3. Se decisão for criar no DS, especificar API (props, comportamento de dropdown, keyboard nav, aria attributes, empty state, loading state, `renderOption` opcional).
- **Escopo técnico:**
  - **Investigação:** grep de varredura, ~15 min.
  - **Criação no DS** (se decidir): componente novo + testes vitest + migração das telas usuárias em PRs próprios.
  - **Bloqueio direto de OBS-010:** precisa decidir antes do PR-C do plano de padronização visual (Opção C da auditoria OBS-008/009/010).
- **Vigiar:**
  - Se OBS-010 (filtros de Compras) for atacado, precisa resolver OBS-019 primeiro.
  - Se [[OBS-005]] (filtro global de competência) trouxer autocomplete de qualquer tipo, cross-ref para evitar dois padrões novos ao mesmo tempo.

### OBS-018 — `Purchases.tsx` importa 2 componentes `StatusBadge` (legado + DS) simultaneamente; resíduo de migração parcial

- **Origem:** auditoria OBS-008/009/010 (2026-07-05). Grep em `Purchases.tsx:42-52` revelou:
  ```tsx
  import { StatusBadge } from "../components/ui/StatusBadge";           // legado
  import {
    EmptyState as DsEmptyState,
    IconButton,
    Money as DsMoney,
    RowMenu,
    StatusBadge as DsStatusBadge,                                       // DS
    Table,
    useFormatCurrency
  } from "../design-system";
  ```
- **O que é:**
  - 2 componentes `StatusBadge` no mesmo arquivo.
  - Um do path legado `../components/ui/StatusBadge`.
  - Um do design system, aliased como `DsStatusBadge`.
  - Sinal de migração parcial abandonada — alguém começou a migrar `Purchases.tsx` para DS mas não terminou.
- **Impacto:** nenhum bug funcional. Dívida de código (2 implementações de mesma coisa carregadas no bundle) + confusão para próximo dev tocar no arquivo.
- **Escopo técnico:**
  - **Investigação:** grep por usos de cada `StatusBadge` no arquivo. Ver quais linhas usam qual (`StatusBadge` sem prefixo vs. `DsStatusBadge`).
  - **Escolha:** consolidar tudo para `DsStatusBadge` (renomear import), remover import legado.
  - **Validação:** `tsc` + `npm run build` + preview visual das linhas afetadas.
  - **Custo:** pequeno-médio, contido em 1 arquivo. Estimativa: 30 min–1 h.
- **Vigiar:**
  - Combinar com PR-C do OBS-010 (filtros de Compras): se já vai mexer em `Purchases.tsx`, consolidar `StatusBadge` no mesmo PR reduz churn de commits.
  - Verificar se `../components/ui/StatusBadge` também é usado em outras telas (grep). Se sim, remover só o import de `Purchases`; se não, considerar deletar arquivo legado inteiro para fechar migração.

### OBS-017 — Botão "Pagar" na tabela de faturas de cartão gera clicks errados quando adjacente ao "Reabrir"

- **Origem:** sessão pós-deploy do PR #17 (OBS-012, SHA `2faac5b`). Teste E2E em produção revelou que o usuário clicou em Pagar quando pretendia clicar em Reabrir para reverter fechamento por engano da fatura 07/2026. Audit log confirmou `PAY_CREDIT_CARD_STATEMENT` em `2026-07-05 03:03:13` sem `REOPEN_CREDIT_CARD_STATEMENT` precedente do mesmo `userId`/IP.
- **O que é:**
  - Actions-cell da tabela em `/financeiro/cartoes` para statement `CLOSED` exibe: **Ver / Reabrir / Pagar / PDF**.
  - Reabrir e Pagar são semanticamente opostos — Reabrir volta atrás, Pagar finaliza — mas visualmente adjacentes.
  - Pagar é ação contábil crítica (baixa parcela em Contas a Pagar) — merece contexto e não deveria ser executável em 1 click da tabela de faturas.
  - Fluxo alternativo já existe: `/financeiro/contas-a-pagar` permite pagamento direto da parcela, com mais contexto (valor, vencimento, categoria, forma de pagamento).
- **Decisão do usuário:** remover botão Pagar da actions-cell. Manter Pagar apenas em Contas a Pagar (fluxo mais direto, já funcional). Reabrir fica na tabela (o par Reabrir/Pagar era o vetor da fricção; remover Pagar deixa Reabrir isolado sem click adjacente perigoso).
- **Impacto:** nenhuma perda de funcionalidade. Usuário que queria pagar via tabela de faturas passa a navegar para Contas a Pagar (1 click adicional, mas com contexto contábil apropriado). Modal de detalhe da fatura (`openStatement`) fica intacto — Pagar continua acessível dentro dele para operadores que precisam de detalhe antes de pagar.
- **Escopo técnico:**
  - Frontend puro. Sem backend, sem schema, sem migration.
  - Remover linha condicional do botão Pagar na actions-cell de `Cards.tsx` (linha ~525 antes do PR do OBS-012, número atualizado após merge do PR #17).
  - Deploy frontend via SCP (backend não muda).
  - Estimativa: 1 arquivo, 1-3 linhas de diff.
- **Vigiar:**
  - Se aparecer relato de usuário não achar onde pagar fatura, adicionar link explícito em `/financeiro/cartoes` para `/financeiro/contas-a-pagar` (fluxo b — atalho de navegação).
  - Combinar com [[OBS-012]] (reabrir): o par Reabrir/Pagar era o vetor da fricção. Sem Pagar, Reabrir fica isolado.
  - Se algum usuário legítimo dependia do atalho de Pagar via tabela para fluxo rápido de fechamento diário, avaliar restaurar com confirmação obrigatória em vez de remover.

### OBS-016 — Escalonamento de fatura de cartão pós-PR #16 é silencioso; sem feedback visual da competência real

- **Origem:** validação empírica do PR #16 em produção (SHA `aa454a1`). Compra parcelada de R$ 30,00 em 04/07/2026 (Sicredi Marcos C M., `closingDay=5`) escalou globalmente `shift=1` para 08/2026 (parcela 1) e 09/2026 (parcela 2). Compra e itens vinculados corretamente no banco, mas operador que tentou conferir em `/financeiro/cartoes` com filtro em Julho/2026 (competência natural do dashboard) não viu a compra — teve que trocar o filtro para Agosto para encontrá-la.
- **O que é:**
  - Fix do OBS-014 (PR #16, [cards.service.ts:191-229](pateo-da-luz/backend/src/modules/cards/cards.service.ts#L191)) escala competência automaticamente quando fatura calculada está em `CLOSED`/`PAID`/`CANCELLED`.
  - Escalonamento é silencioso: nenhum feedback visual mostra ao usuário que a compra foi parar em Ago/Set/Out/Nov em vez de Jul.
  - Em compras à vista, a fricção é menor (1 competência só).
  - Em compras parceladas, a fricção aumenta: parcela N pode cair em ano diferente da N-1 dependendo do shift + número de parcelas.
  - Conferência manual exige navegar por múltiplas competências até achar.
- **Impacto:** nenhum bug funcional. Fricção operacional para Rafael/Valéria durante conferência. Confusão potencial ao lançar compra e não encontrar imediatamente em `/financeiro/cartoes`.
- **Ideias de melhoria (não urgentes):**
  1. **Toast pós-submit em `/compras/nova`** mostrando competência real onde a compra caiu. Já usa padrão `setNotice({ tone: "success" })` em vários lugares — trivial adicionar competência no message. Idealmente com link direto para a fatura correspondente.
  2. **Chip preview pré-submit** em `/compras/nova` mostrando qual fatura receberá antes de clicar Salvar. Requer endpoint de preview no backend ou cálculo espelhado no frontend duplicando `resolveOpenStatementShift`.
- **Escopo técnico:**
  - **Opção 1 (toast):** apenas frontend + retornar competência no response do `POST /purchases` (backend já tem o dado). Pequeno.
  - **Opção 2 (chip preview):** endpoint novo `GET /purchases/preview-statement` ou lógica de cálculo no frontend duplicando `resolveOpenStatementShift`. Médio.
- **Vigiar:**
  - Se aumentar volume de suporte ("cadê minha compra que sumiu?"), promover a fix prioritário.
  - Combinar com [[OBS-005]] (filtro global de competência): se filtro sincronizar entre páginas, o efeito colateral positivo é que trocar competência em uma tela reflete em todas.

### OBS-015 — Setup de testes backend usa PrismaTestingHelper sem stub de `$transaction`; testes em múltiplos módulos falharão

- **Origem:** investigação Etapa 1 do OBS-014 tentou identificar suite de testes existente. Backend deste projeto **não tem framework de testes instalado** (`spec.ts` inexistente conforme `CLAUDE.md` e confirmado por `find backend -name "*.test.*"`), mas quando/se for adicionado, o padrão de mock usual (`PrismaTestingHelper` ou variantes) não stub `prisma.$transaction` por padrão.
- **O que é:**
  - Código existente em vários módulos usa `prisma.$transaction` para operações atômicas: `tax-payments`, `purchase-planning`, `reports`, `dashboard`, `purchases` (linhas 1291, 1747, 2044, 2185 de `purchase.routes.ts`), `monthly-inventory-import`, e o próprio `cards` após PR #16 (`syncCardStatementItemsForPurchase` e `findOrCreateStatementForPurchase` dependem de `tx: Prisma.TransactionClient`).
  - Se algum dia forem escritos testes unitários que instanciem `PrismaTestingHelper` sem stub explícito de `$transaction`, esses testes falharão com `prisma.$transaction is not a function` — bug de setup, não de código.
  - Não afeta produção. Afeta apenas viabilidade futura de escrever testes.
- **Impacto:** bloqueia adoção de suite de testes no backend enquanto não resolvido. Cada módulo transacional exigiria patch de setup ou skip.
- **Escopo:**
  - Se decidir instalar framework de testes (Vitest ou Jest), incluir no setup:
    - Estender `PrismaTestingHelper` (ou mock ad-hoc) para expor `$transaction` como função pass-through: `(fn) => fn(mockPrisma)`.
    - Ou usar biblioteca já existente (`prisma-mock`, `jest-mock-extended`, `vitest-mock-extended`).
  - Enquanto não há testes, fica como débito registrado.
- **Vigiar:**
  - Se decidir escrever primeiro teste do backend, começar pelo setup do mock. Sem isso, cada teste transacional falha em cascata.
  - PR #16 já registrou a lacuna na "Nota técnica" do body: "Backend deste projeto não possui framework de testes (`spec.ts`) instalado. Regressão coberta por `tsc` + `npm run build` + script de validação." Se essa cobertura deixar de ser aceitável (ex.: cresce complexidade dos módulos transacionais), OBS-015 vira gate para adoção.

### OBS-014 — Sistema de cartão de crédito bloqueava compras quando competência calculada apontava para fatura fechada (RESOLVIDO no PR #16)

- **Origem:** relato de operação em produção (Rafael/Valéria) após deploy do PR #15 (`0da7cca`). Tentativa de lançar compra via CC em 04/07/2026 disparava: *"Fatura Marcos C Morra 07/2026 está fechada e não pode receber novos lançamentos. Reabra a fatura antes de lançar esta compra."*
- **Status:** **RESOLVIDO no PR #16** (SHA `aa454a1`, merged 2026-07-04). Mantido aqui para rastreabilidade histórica — segue padrão dos OBS-006/007 que também foram registrados antes de virarem fix.
- **O que era:**
  - `getCardStatementPeriod` ([cards.service.ts:31-47](pateo-da-luz/backend/src/modules/cards/cards.service.ts#L31)) calcula competência rigidamente por `day <= closingDay ? mês atual : próximo mês`.
  - `findOrCreateStatementForPurchase` e `syncCardStatementItemsForPurchase` (ambos em `cards.service.ts`) usavam o resultado direto sem verificar se a fatura da competência resultante aceitava novos lançamentos.
  - Se a fatura estava em `CLOSED`/`PAID`/`CANCELLED`, disparavam `throw` — sem escalonamento para próxima competência disponível.
- **Cenário confirmado em produção (query `scripts/audit-obs-014-statements.sql`):**
  - Cartão Sicredi 3890, `closingDay=5`, `dueDay=18`.
  - Fatura 07/2026 em `CLOSED`.
  - Faturas 08/2026, 09/2026, 10/2026 em `OPEN` (pré-criadas por compra parcelada anterior).
  - Compra em 04/07/2026 (dia 4 ≤ closingDay 5) → competência calculada 07/2026 → encontrava Julho fechada → throw. Não escalava para Agosto que já existia aberta.
- **Impacto original:** **alto** — bloqueio total de operação. Rafael/Valéria não conseguiam lançar compras via CC até que a próxima competência natural virasse alvo (06/07 seguiria a mesma lógica; só destravava naturalmente após passar o `closingDay`).
- **Fix aplicado (PR #16):**
  - Novo helper privado `resolveOpenStatementShift` ([cards.service.ts:191-229](pateo-da-luz/backend/src/modules/cards/cards.service.ts#L191)) que testa se todas as N competências consecutivas a partir de um `shift` estão livres (não `CLOSED`/`PAID`/`CANCELLED`). Retorna o menor `shift` que satisfaz. Limite `MAX_SCALE=12`.
  - `shift` global aplicado a todas as parcelas — preserva espaçamento entre parcelas e evita colisão.
  - Ambos consumidores atualizados; contrato de retorno preservado; `getCardStatementPeriod` intocada; `purchase.routes.ts` intocado; schema intocado.
- **Validação empírica pós-deploy:** compra parcelada 2x em 04/07/2026 escalou `shift=1` global. Parcela 1 → 2026/08 OPEN, parcela 2 → 2026/09 OPEN. Statements existentes reutilizados, sem `throw`, sem órfã. Operação desbloqueada.
- **Sinalizações que ficaram para depois (não estão no fix):**
  - Escalonamento silencioso — falta de feedback visual da competência real onde a compra caiu. → registrada como [[OBS-016]].
  - Fatura 07/2026 continua em `CLOSED` pós-fix (comportamento intencional, fix não desfaz histórico). Dívida de dados históricos onde Rafael marcou como `CHECKED` sem conferência real (bug antigo do OBS-007) é assunto separado.
  - Botão "Fechar" da fatura aceita transição `OPEN → CLOSED` direto (sem passar por `CHECKED`) — nota antiga do OBS-007, escopo próprio.
  - [[OBS-012]] (reabrir fatura fechada) segue pendente e complementa este contexto.

### OBS-013 — Validar botão "Realocar" na tabela de itens do modal de fatura em `/financeiro/cartoes`

- **Origem:** investigação do OBS-007 em produção (screenshot do teste do Eli). Descoberto durante inspeção da tabela de itens dentro do modal de detalhe da fatura.
- **O que é:**
  - A tabela de itens do modal de fatura (Cards.tsx, dentro do fluxo iniciado por `openStatement`) exibe 3 botões por linha: **Conferir**, **Div.** (Divergência), **Realocar**.
  - Botão **Realocar** tem escopo semântico esperado: alterar a fatura a qual o item pertence (Eli mencionou explicitamente "onde posso alterar a fatura que a compra pertence").
  - Estado funcional do botão **não foi investigado ainda** — não sabemos se abre modal/dropdown para escolher fatura destino, se é no-op, ou se é handler parcialmente quebrado (mesmo padrão do "Conferir" externo).
- **Hipóteses:**
  1. Botão totalmente funcional: fluxo completo implementado, só falta documentação/visibilidade.
  2. Botão no-op: mais um botão morto — mesmo padrão OBS-005 (Competência), OBS-006 (sino), OBS-007 (Conferir externo) — feature declarada mas não conectada.
  3. Botão parcialmente funcional: chama API mas UX quebrada (sem refetch, sem feedback) — mesmo padrão do OBS-007 reformulado.
- **Impacto atual:** desconhecido até auditoria. Se botão for no-op, usuário não consegue realocar item entre faturas pela UI — fluxo essencial em fechamento de cartão travado.
- **Escopo:** auditoria read-only primeiro (`Cards.tsx` + `api/client.ts` + backend se necessário). Só depois decidir fix vs. implementação vs. remoção.
- **Vigiar antes de:**
  - Qualquer prompt de correção do OBS-007 (bota Conferir na tabela externa) — aproveitar contexto do arquivo `Cards.tsx`.
  - Se botão for funcional, verificar se ele reage bem a itens com divergência marcada ou já conferidos.
  - Se botão for no-op, avaliar prioridade — Eli mencionou como necessidade real do fluxo mensal de conferência.

### OBS-012 — Fatura de cartão fechada não pode ser reaberta

- **Origem:** investigação do OBS-007 em produção (teste do Eli). Descoberto durante inspeção do fluxo de fechamento em `Cards.tsx`.
- **O que é:**
  - Ao fechar uma fatura de cartão (botão "Fechar" na tabela em `Cards.tsx` quando `status !== "CLOSED"`), fatura transita para `CLOSED`.
  - Uma vez `CLOSED`, **não existe UI para reabrir**. Se usuário fechou por engano ou descobriu erro após fechar (item errado, divergência não anotada, compra realocada errado), o registro fica travado.
  - Reabrir manualmente exigiria SQL direto no banco — indesejável: quebra rastreabilidade, ignora sistema de permissões, sem log de ação do usuário.
- **Impacto:** bloqueio operacional. Erro humano trivial (clicar "Fechar" na fatura errada) obriga intervenção técnica no banco de dados.
- **Regra de negócio para reabrir (decisão Eli):**
  - Reabrir permitido **apenas** se o título gerado no Contas a Pagar ainda **não foi baixado** (`payable.paidAt IS NULL`).
  - Se título já foi baixado (pago), fatura permanece trancada — desfazer teria efeitos colaterais no Contas a Pagar e no Caixa.
  - Ação permission-gated (só usuários com `canManage` sobre cartões).
- **Escopo:**
  - **Backend:** verificar se existe endpoint `POST /cards/statements/:id/reopen` (ou similar). Se não houver, adicionar — com guard de permissão + verificação de `payable.paidAt IS NULL`. Verificar no schema Prisma a relação entre `CreditCardStatement.id` e `Payable.id` (existência de FK, campo de vínculo).
  - **Frontend:** botão "Reabrir" na tabela quando `statement.status === "CLOSED" && canManage && !payableJaBaixado`. Toast de sucesso/erro. Refetch dos statements após ação.
- **Requer auditoria read-only antes de implementação:**
  - Modelo Prisma de `CreditCardStatement` e `Payable` (vínculo + `paidAt`).
  - Endpoints existentes de `/cards/statements` no backend.
  - Sistema de permissões (`canManage` para cartão).
- **Vigiar:**
  - Se reabrir permitir alterar valores (via edição de itens), verificar consistência com CMV real e Caixa — auditoria read-only vai confirmar se há efeitos indiretos.

### OBS-011 — Ausência de testes em viewport mobile durante toda a migração de mascaramento monetário (Fases 0/1/2/3)

- **Origem:** reflexão pós-deploy Fase 3. Débito técnico da migração.
- **O que é:**
  - Nenhuma das 19 telas migradas (12 PRs feat, 252 call sites) foi validada em viewport mobile durante preview local.
  - Todo o preview foi feito em viewport desktop 1440x900. Uma única menção acidental de "viewport estreita mostrou sidebar" no PR #6 não foi teste sistemático.
  - Padrões com risco específico em mobile **não verificados**:
    - `Purchases`: `purch-mobile-amount` (linha 1791), `pnova-sticky-total`/`pnova-sticky-diff` (3021, 3023) — `<Money>` inline-block em contexto sticky/mobile.
    - `Cash`: `cash-shift-tab-total` (453, 461) — abas de turno em viewport estreita.
    - `Revenue`: templates `detail` do MetricCard (`Bruto R$ •••• | Serviço R$ •••• | TCs 0 | TM R$ ••••`) — pode quebrar em várias linhas em mobile.
    - `Payables`: SummaryCards em grid — reflow em mobile.
    - `DRE`: 3 componentes locais refatorados (DRECard/DRERow/DRETotal) com valores monetários inline em células — comportamento de tabela em mobile.
  - `<Money>` é `inline-block`: em telas estreitas com texto adjacente em `<span>`, pode gerar quebras de baseline ou wrap inesperados diferentes do desktop.
  - **Nenhum bug funcional reportado até agora** — mas ausência de reporte não equivale a ausência de bug.
- **Hipóteses:**
  1. Sistema está OK em mobile e a preocupação é infundada (esperado dado que a migração trocou string por componente que aceita o mesmo texto).
  2. Existem problemas cosméticos localizados que nenhum usuário reportou até agora.
  3. Existem bugs visuais em fluxos específicos que só aparecem em contexto mobile real (não emulado).
- **Escopo sugerido:** auditoria read-only usando DevTools mobile emulation nas 11 telas migradas + validação em dispositivo real (usuário final). Ordem sugerida por complexidade:
  1. Purchases mobile (padrões explícitos `purch-mobile-amount` + `pnova-sticky`).
  2. Revenue mobile (templates detail com quebras).
  3. Cash mobile (abas de turno em viewport estreita).
  4. Demais telas em varredura.
- **Vigiar:** não é urgente. Zero bug funcional reportado. Registro para calibrar decisão de investir tempo em auditoria mobile em algum momento futuro.

### OBS-010 — Bloco de filtros em `/compras` visualmente desconexo do restante do sistema

- **Origem:** smoke test em produção após deploy PRs #10-#13. Não introduzido pela migração de mascaramento — preexistente. Ficou mais visível após padronização do resto do sistema.
- **O que é:**
  - Bloco "FILTROS" tem fundo branco com bordas retas — diferente dos cards arredondados que o resto do sistema usa.
  - Inputs (Fornecedor, Categoria, Status, Forma de pagamento, Busca geral, Ordenação) com bordas grossas e cantos retos.
  - Título "FILTROS" em caps small pequeno vs. hierarquia usada em outras telas.
  - Botões "Filtrar" e "Limpar filtros" com estilo divergente dos botões padrão do DS.
  - Contrasta especialmente com a tabela abaixo (linhas de compras) que segue o padrão moderno.
- **Impacto:** cosmético + quebra de coesão visual. Não bloqueia uso.
- **Escopo:** frontend, bloco de filtros em `Purchases.tsx` (verificar se é componente próprio ou inline). Requer auditoria read-only + decisão sobre migrar para `<Card>`/`<FilterPanel>` do DS.
- **Vigiar antes de:** qualquer refactor de UI em Purchases, OU quando revisar padronização de blocos de filtro em outras telas (talvez seja padrão sistêmico — vale checar se existe reuse).

### OBS-009 — Tela de Requisições (`/estoque/requisicoes`) parece não ter passado pela padronização do DS

- **Origem:** smoke test em produção após deploy PRs #10-#13. Preexistente à migração de mascaramento monetário.
- **O que é:**
  - Selects (Turno, Setor, Motivo) com bordas grossas divergentes do padrão do DS.
  - Formulário "DADOS DA REQUISIÇÃO" sem card wrapper.
  - Campo "Observações" com estilo de input bruto (`border-only`).
  - Cabeçalho "Requisições de Insumos" com hierarquia visual diferente das outras telas.
- **Impacto:** cosmético + inconsistência. Não bloqueia uso.
- **Escopo:** frontend, provavelmente `StockRequisitions.tsx` ou similar (a confirmar via grep). Requer auditoria read-only + comparação com padrão do DS antes de refactor.
- **Vigiar antes de:** ciclo dedicado a padronização visual do DS nas telas restantes, OU quando o módulo de estoque receber atenção maior.

### OBS-008 — Tela de Fichas Técnicas (`/cardapio/fichas-tecnicas`) com layout amontoado e fora do padrão visual

- **Origem:** smoke test em produção após deploy PRs #10-#13. Não introduzido pela migração de mascaramento — preexistente. Ficou mais visível após padronização do resto do sistema.
- **O que é:**
  - Filtros (busca + select categoria + checkbox "Mostrar inativos" + botão "Novo prato") aparecem amontoados sem espaçamento consistente com o resto do design system.
  - Checkbox "Mostrar inativos" solto entre select e botão — sem agrupamento visual.
  - Botão "+ Novo prato" mal alinhado com o restante da barra de ações.
  - Ausência de card wrapper que o resto do sistema usa nos blocos de filtro.
- **Impacto:** cosmético. Não bloqueia uso do módulo.
- **Escopo:** frontend, `Dishes.tsx` (`pages/Dishes.tsx`). Requer auditoria read-only do CSS + estrutura JSX antes de qualquer refactor visual.
- **Vigiar antes de:** ciclo dedicado a padronização visual do módulo Cardápio, OU quando revisar o padrão de FilterBar do DS (talvez esta tela seja outlier que sinaliza que o padrão não foi consolidado ainda).

---

## Contexto compartilhado — OBS-008/009/010

Detectados no smoke test em produção após deploy dos PRs #10-#13 (Fase 3 da migração de mascaramento monetário). Migração validada OK. Estes 3 itens são **preexistentes à migração** (não introduzidos por ela) e ficaram mais visíveis após a padronização do resto do sistema. Nenhum bloqueia operação crítica do negócio.

**OBS-011** (viewport mobile) é reflexão pós-deploy separada — débito técnico de cobertura da própria migração, não bug preexistente.

---

### OBS-007 — Botão "Conferir" na tabela de faturas de `/financeiro/cartoes` não abre modal de conferência (mas faz PATCH silencioso perigoso)

- **Origem:** registrado inicialmente após smoke test em produção pós PRs #2-#9 como "botão Conferir não abre nada". Investigação posterior (auditoria read-only + teste em produção pelo Eli lançando compra via cartão de crédito) revelou comportamento **pior que o suposto** e obrigou reformulação. Preexistente à migração de mascaramento monetário.
- **O que é:**
  - Botão "Conferir" na tabela de faturas (`Cards.tsx:517`) executa handler que chama `setCardStatementStatus(id, "OPEN" ↔ "CHECKED")` — **PATCH real no backend**, não um no-op.
  - PATCH persiste no banco mas a UI não reflete: sem `await`, sem refetch dos statements, sem toast, sem feedback visual.
  - **Resultado observado em produção:** status da fatura muda para "Conferida" **sem o usuário ter conferido nada**. Falso positivo silencioso.
  - **Comportamento correto esperado (confirmado por Eli):** o botão deveria abrir o modal de detalhe da fatura em modo conferência, focando/rolando até a tabela de itens onde já existem os botões por item (`Conferir | Div. | Realocar` na linha 698 do modal). A conferência real (item-a-item) **já está implementada dentro do modal** — falta apenas o gatilho para entrar no modal em modo conferência.
- **Fluxo real de conferência de cartão (contexto de negócio):**
  1. Compra lançada com cartão de crédito → sistema atribui à fatura aberta do período.
  2. Fim do mês → usuário abre fatura, confere lançamento a lançamento contra o extrato físico do banco.
  3. Conferência pode envolver: **Realocar** o item para outra fatura, marcar **Divergência** (Div.), ou **Conferir** por item.
  4. Depois de tudo conferido, "Fechar" fatura → gera título no Contas a Pagar.
- **Impacto:** **alto risco de dados errados**. Usuário clica sem entender o efeito, fatura fica marcada como conferida sem conferência real, gera título no Contas a Pagar com dados não validados. Diferente do diagnóstico original — não é apenas "botão morto"; é botão que age silenciosamente contra a intenção do usuário.
- **Opções de resolução:**
  - **Fix mínimo (recomendado):** mudar handler para chamar `openStatement(statement)` com sinalizador de "entrar em modo conferência" (foca/rola até a tabela de itens). **Remover o PATCH silencioso** — a marcação de `CHECKED` só pode ocorrer após conferência real por item.
  - **Alternativa:** manter comportamento atual mas adicionar refetch + toast + diálogo de confirmação antes do PATCH ("Marcar fatura inteira como conferida sem revisar itens?"). Menos alinhado com o fluxo real; mantém o atalho de marca-em-massa como opção deliberada.
- **Escopo:** pequeno (frontend puro, `Cards.tsx`).
- **Vigiar:**
  - A fatura do teste em produção do Eli já aparece como "Conferida" após o clique. **Verificar se há faturas no banco em `CHECKED` sem conferência real** — dívida técnica de dados históricos que pode ter se acumulado desde o primeiro deploy do módulo.
  - Se optar por fix mínimo, também considerar rever o botão "Fechar" — hoje aceita fechar fatura em qualquer status (`!== "CLOSED"`), inclusive `OPEN` sem passar por `CHECKED`. Semanticamente estranho: dá pra fechar sem nunca conferir.

### OBS-006 — Sino de notificação no Topbar exibe badge mas clique não abre painel

- **Origem:** smoke test em produção após deploy dos PRs #2-#9. Preexistente à migração.
- **O que é:** o ícone de sino no Topbar global exibe badge vermelho (indicando notificação pendente — provavelmente vindo de `pendingCountSessionCount` do App.tsx). Ao clicar no sino, **nada acontece**: sem dropdown, sem painel lateral, sem modal, sem toast.
- **Hipóteses:**
  1. Handler `onClick` nunca foi conectado no componente do Topbar (feature incompleta — badge visual sem interação).
  2. Painel/dropdown existe mas abre invisível (z-index abaixo do backdrop, visibility errada, largura zero).
  3. Bug de regressão: handler existia mas foi removido em algum refactor.
- **Impacto atual:** feature de notificação inutilizável pela UI. O usuário vê que há algo pendente (badge) mas não consegue acessar de forma centralizada. Alternativa atual é navegar diretamente para os módulos.
- **Escopo de investigação:** frontend, componente do Topbar (provavelmente em `design-system/shell/Topbar.tsx` + integração no App.tsx). Auditoria read-only para determinar se é bug de handler ou feature incompleta.
- **Vigiar antes de:** implementar. Se for feature incompleta que nunca foi priorizada, avaliar se vale o esforço vs. remover o sino/badge para reduzir confusão. Se for bug de handler quebrado, é fix rápido.

### OBS-005 — Filtro global de competência do Topbar não implementado (arquitetura incompleta)

- **Origem:** smoke test em produção após deploy dos PRs #2-#9 (padrão único de mascaramento monetário). Registrado inicialmente como "filtro duplicado no Dashboard". Auditoria read-only posterior (mesma sessão) revelou escopo sistêmico.
- **O que é:**
  - Botão "Competência" no Topbar (`Calendar` icon + string do mês) é **100% cosmético em toda a aplicação**. `topbarPeriod` é calculado com `new Date()` hard-coded no render de `App.tsx` (linha ~333). Prop `onPeriodClick` **nunca é passada** → clique é no-op (nenhum console error, nenhum feedback).
  - **Não existe state global de competência.** `SessionContext` não tem esse campo. `utils/period.ts` é utilitário puro (fábrica `currentMonthPeriod()`), não state.
  - **9 telas financeiras** (Dashboard, Payables, Cards, Cash, TaxPayments, Revenue, Purchases, DRE, MonthlyClosing) mantêm state **local** + picker próprio (`<input type="month">` ou componente `<PeriodFilter>`). Sem sincronização entre elas.
  - **2 telas** não filtram por competência: CmvReal navega por cards de fechamento, SupplierCycles filtra por fornecedor/status.
  - **Sem persistência:** navegar entre telas reseta o período para o mês atual — cada `useState(currentMonthPeriod())` roda de novo no mount.
- **Escopo real:** sistêmico, não isolado ao Dashboard.
- **Hipóteses da causa raiz:**
  1. Design system definiu `Topbar.period` como trigger genérico com `onPeriodClick` opcional — deixando ao consumidor a responsabilidade de abrir picker externo.
  2. `App.tsx` nunca implementou o handler global — só passa o texto do mês atual como decoração.
  3. Cada tela reinventou seu próprio picker porque não havia global disponível.
- **Não é regressão** — é feature incompleta desde a fundação.
- **Impacto UX:**
  - Botão do Topbar sugere ao usuário que há filtro global; clique não faz nada, sem feedback.
  - Nenhuma memória cross-page: usuário ajusta período em Payables, vai para Cards, período volta para mês atual.
  - Duplicação de lógica: 9 implementações independentes de picker + fetch reativo.
- **Opções de correção mapeadas:**
  - **Fix mínimo (~1 dia):** conectar Topbar somente ao Dashboard. Deixar outras 8 telas como estão. **Contra:** cria inconsistência UX (Topbar funciona só no Dashboard, é local nas outras) — piora percepção vs. estado atual uniforme.
  - **Fix médio (~2-3 dias):** criar `CompetenceContext` global + conectar Topbar + migrar apenas Dashboard. Outras telas ficam locais até serem migradas depois. **Contra:** coexistência temporária de dois padrões vira débito eterno se as outras não forem migradas.
  - **Fix grande (~1 semana):** `CompetenceContext` global + Topbar conectado + migrar as 9 telas para consumir. Cross-page memory. Uniformidade total. Alinhado com UX de ERP profissional. Bônus: elimina duplicação de código.
- **Recomendação (Eli decidir quando atacar):** **fix grande**, como mini-fase própria de arquitetura. Não está no caminho crítico da migração de mascaramento monetário — pode ser tratado depois da Fase 3 e Fase 4.
- **Escopo técnico do fix grande (para referência futura):**
  - Design decision de UX: picker abre como popover disparado pelo Topbar, ou modal? O que acontece se mês selecionado não tem dados? Presets (mês atual, 30 dias, ano, custom range)?
  - Criar `frontend/src/context/CompetenceContext.tsx` com shape `{ month, year, preset }` + setter + persistência em `localStorage`.
  - Conectar Topbar em `App.tsx` passando `onPeriodClick` e `period` reativo.
  - Migrar as 9 telas uma por uma. Ordem sugerida por facilidade: Cash (data diária) e TaxPayments (range custom) exigem decisão específica; Payables/Cards/Revenue/Purchases/DRE/MonthlyClosing são migração mecânica; Dashboard como primeiro para validar padrão.
- **Vigiar:**
  - Se aparecer decisão de UX que altere significativamente a arquitetura acima (ex.: filtro por fornecedor+período composto), reavaliar antes de implementar.
  - Feature de "trocar período afeta tudo" pode confundir usuários acostumados ao padrão atual (cada tela independente). Considerar transição gradual com feature flag.

---

## Contexto compartilhado — OBS-005/006/007

Detectados no smoke test em produção após deploy dos PRs #2-#9 (padrão único de mascaramento monetário). Migração de mascaramento validada OK. Estes 3 itens são **preexistentes à migração** (não introduzidos por ela) e não bloqueiam operação crítica do negócio, mas precisam ser tratados quando fizer sentido.

---

### OBS-004 — Dívida de vocabulário Product.unit ↔ PURCHASE_MODELS

- **Origem:** validação end-to-end do Prompt 18 revelou que 683/795 produtos (86%) caíam em "outro" no dropdown do PurchasePlanning por incompatibilidade de vocabulário
- **Sintoma:** 2 vocabulários paralelos convivem sem contrato:
  - **Banco (Product.unit / Product.purchaseUnit):** abreviações operacionais em CAIXA ALTA — `UNI` (626), `KG` (112), `PCTE` (28), `MÇ` (9), `PACTE` (5), `CX` (4), `BALD` (4), `BDJ` (3), `LITROS` (1), `BALDE` (1), `POTE` (1), `BDE` (1)
  - **Frontend (PURCHASE_MODELS):** vocabulário canônico em minúsculas — `unidade`, `caixa`, `saco`, `kg`, `bandeja`, `pacote`, `fardo`, `outro`
- **Correção pontual aplicada (Prompt 18):** `UNIT_ALIASES` no `defaultModel` de PurchasePlanning.tsx cobre 98% (779/795): `UNI/UN→unidade, CX→caixa, KG→kg, PCTE/PACTE/PCT→pacote, BDJ/BDE→bandeja`. Residual = 16 produtos (2%): `MÇ` (9), `BALDE/BALD` (5), `POTE` (1), `LITROS` (1) — continuam caindo em "outro"
- **Correção estrutural pendente (prompt dedicado):**
  1. Normalizar `unit`/`purchaseUnit` no boundary de escrita (POST/PUT `product` + import de catálogo) para vocabulário canônico
  2. Backfill dos 795 produtos ativos
  3. Revisão do Rafael sobre significado semântico das 4 abreviações restantes: `MÇ` = "maço"? `BALDE/POTE` = novo valor no enum ou "outro"? `LITROS` = unidade real distinta de "unidade"?
  4. Considerar expandir `PURCHASE_MODELS` para cobrir 100% ou deixar residual como "outro" documentado
- **Vigiar:** se importações futuras trouxerem abreviações novas (fora do UNIT_ALIASES + PURCHASE_MODELS), degradam silenciosamente para "outro"

### OBS-003 — Divergência de estado de Product.purchaseUnit entre auditorias

- **Origem:** confronto entre Prompt 10 (auditoria de conversion factor) e Prompt 18 Etapa B (auditoria de modelo de compra padrão), ambos rodados em 2026-07
- **Divergência:** Prompt 10 reportou **795/795 produtos ativos sem purchaseUnit**. Prompt 18 Etapa B reportou o campo como **populado ativamente** via cadastro (`Products.tsx:580`), import de catálogo (`catalog-import.service.ts:240`) e default no POST/PUT product (`product.routes.ts:129`, `purchaseUnit = normalizeUnit(body.purchaseUnit ?? body.unit)`).
- **Por que importa:** o fix de Etapa C do Prompt 18 (priorizar `purchaseUnit` no `defaultModel`) assume que a maioria dos produtos tem valor preenchido. Se Prompt 10 estiver certo, o novo default é indistinguível do atual (`??` cai em `unit`).
- **Vigiar antes de:** partir pro fix de conversion factor de Prompt futuro. Rodar contagem real no banco:
  ```sql
  SELECT COUNT(*) FROM "Product" WHERE "isActive" AND "purchaseUnit" IS NOT NULL;
  SELECT COUNT(*) FROM "Product" WHERE "isActive";
  ```
  Se resultado divergir do assumido em qualquer um dos prompts, **redesenhar estratégia de backfill** antes de tocar em código de conversion factor.

### OBS-002 — Refetch de count-sessions em toda navegação de rota

- **Origem:** code-reviewer, Prompt 18 Fase 1 (MEDIUM)
- **O que é:** o `useEffect` do badge de "Pedidos de compra" em `App.tsx` tem `location.pathname` nas deps, então dispara `getStockCountSessions()` em toda troca de rota — inclusive rotas não relacionadas a estoque/compras. Padrão `active` previne race, mas gera N requests HTTP descartados sequencialmente em navegação rápida.
- **Por que não vai virar ação:** o requisito explícito foi "sem endpoint novo, sem polling agressivo". Refetch em mudança de rota é o meio termo pragmático. Endpoint é leve; volume single-tenant absorve.
- **Vigiar se:** aparecerem múltiplos badges de contador em outros itens do menu (multiplicaria o custo), OU o app crescer com muitas rotas rápidas. Nesse dia, considerar SWR/react-query com staleTime, WebSocket para push, ou fetch condicionado ao pathname (só refetch quando sair de tela de estoque).

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
