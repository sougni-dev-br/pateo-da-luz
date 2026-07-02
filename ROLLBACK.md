# ROLLBACK — plano de reversão do deploy 02/07/2026

Deploy corrente: **`edfa35f`** (Prompt 18: BACKLOG OBS-001–004). Topo de uma stack de 8 commits (Prompts 17 e 18) empurrados juntos em **02/07/2026 ~00:36 UTC**.

Estado estável ANTES deste deploy: **`85e67a8`** (Prompt 12: cap qty + selo sem preço) — deploy anterior de 01/07/2026 ~00:31 UTC. É para ele que se reverte.

## Commits deste deploy (do mais recente ao mais antigo)

```
edfa35f docs: BACKLOG.md com OBS-001 a OBS-004 do Prompt 18
d0892bb feat(purchase-planning): botão PDF ativo + modelo padrão via purchaseUnit + ordem descendente
6c65556 feat(purchase-orders): endpoint GET /:id/pdf + generator + hardenings
323d3d2 feat(inventory): botão "Gerar pedido de compra" no card CONCLUIDA + badge em Pedidos de compra
70c6cbc docs: BACKLOG.md com débitos técnicos identificados na sessão
123836a feat(inventory): select "Categoria (opcional)" em SETORIAL + fetch on-demand
860a928 feat(inventory): setor+categoria composto em contagens SETORIAIS + hardening
34a9e8e docs: adicionar ROLLBACK.md com plano de reversao do deploy 85e67a8
```

Escopo total: 10 arquivos alterados, +933/-116.

---

## Backup pré-push (único paraquedas)

- **Arquivo**: `C:\Projeto_pateo_Claude\backups\pateo-prod-20260702-003559.dump`
- **Timestamp UTC**: `2026-07-02 03:36:00` (registrado no header do dump)
- **Formato**: pg_dump custom (`-Fc`), `--no-owner`, `--no-privileges`
- **Tamanho**: 1.996.222 bytes (~1.9 MB)
- **Conteúdo**: 62 TABLE + 62 TABLE DATA (= 124 total), 533 entradas TOC — mesma estrutura do backup anterior (nenhuma migration neste deploy)

**Plano Render Free NÃO tem daily backup automático.** Este arquivo é o ÚNICO ponto de restauração possível para o estado pré-push.

Backup anterior (do deploy 85e67a8) ainda disponível como referência histórica: `pateo-prod-20260701-190441.dump` (1.95 MB).

> **AÇÃO PENDENTE**: subir cópia deste dump para Google Drive / OneDrive. Backup existe em UM único local (máquina local do Rafael). Se ela falhar, o paraquedas some junto.

### Comando de restore documentado

Restore integral (destrutivo — apaga schema + dados existentes):

```bash
export MSYS_NO_PATHCONV=1
docker run --rm -v "//c/Projeto_pateo_Claude/backups:/backups" postgres:18-alpine \
  pg_restore \
    --clean --if-exists --no-owner --no-privileges \
    -d "postgresql://pateo:C6KlzjAN77Zhteww1hckC8c7mb4KsObm@dpg-d8o1gvb6sc1c738vp070-a.oregon-postgres.render.com/pateo" \
    /backups/pateo-prod-20260702-003559.dump
```

Restore cirúrgico de tabelas específicas (ex: só `StockCountSession` + itens):

```bash
export MSYS_NO_PATHCONV=1
docker run --rm -v "//c/Projeto_pateo_Claude/backups:/backups" postgres:18-alpine \
  pg_restore \
    -t StockCountSession -t StockCountSessionItem \
    --no-owner --no-privileges --data-only \
    -d "postgresql://pateo:C6KlzjAN77Zhteww1hckC8c7mb4KsObm@dpg-d8o1gvb6sc1c738vp070-a.oregon-postgres.render.com/pateo" \
    /backups/pateo-prod-20260702-003559.dump
```

---

## Métodos de rollback

### Método A — dashboard Render (redeploy manual)

1. Abrir https://dashboard.render.com/web/srv-d8o1h9j6sc1c738vp8j0/deploys
2. Localizar o deploy correspondente ao commit **`85e67a8`** (01/07/2026 ~00:31 UTC)
3. Clicar "Rollback to this deploy"
4. Render rebuilda o binário daquele commit e substitui o LIVE

Prós: reversível em cliques, sem tocar em git. Contras: só reverte o backend (código); dados de banco criados após 02/07/2026 ficam órfãos das colunas/rotas antigas.

### Método B — `git revert` (recomendado se dashboard indisponível)

Reverte os 8 commits desta stack criando 8 commits novos (histórico limpo, sem force push):

```bash
cd C:/Projeto_pateo_Claude/pateo-da-luz
git revert --no-edit \
  edfa35f d0892bb 6c65556 323d3d2 70c6cbc 123836a 860a928 34a9e8e
git push origin main
```

Auto-deploy do Render dispara. Após ~5 min, LIVE volta a comportar-se como `85e67a8`.

Prós: histórico auditável, backend + banco lidando com estado antigo consistente. Contras: se qualquer commit intermediário criou dados que não existiam em `85e67a8`, esses dados ficam órfãos (o revert só toca em código, não em dados).

### Método C — restore integral do banco

Só use se dado corrompido em produção (ex: `StockCountSession` com estado impossível devido à nova transaction). Combine com Método A ou B:

1. Executar Método A ou B primeiro (código volta a `85e67a8`)
2. Rodar o `pg_restore --clean` documentado acima
3. Verificar que aplicação inicia normalmente (health OK, login OK)

**AVISO**: qualquer dado criado em produção **após 02/07/2026 03:36:00 UTC** é perdido neste caminho. Só usar se o dano do dado novo for maior que o valor dele.

---

## Sinais que indicam rollback

### Cenários específicos deste deploy

- **Criação de contagem falhando**: Prompt 17 envolveu `POST /inventory/count-sessions` em `$transaction` + guarda "SETORIAL requer sectorId". Se log do Render mostrar erro do Prisma em transaction, ou usuários reportando "Contagem setorial requer sectorId" quando escolheram setor válido → investigar antes de rollback.
- **PDF de pedido corrompido, vazio, ou HTTP 500** em `GET /purchase-orders/:id/pdf`: probe rápido `curl -o test.pdf` deve retornar `%PDF-1.4` como primeiros bytes. Se vier HTML ou arquivo <500 bytes, generator quebrou.
- **Badge no menu com valor absurdo (>1000) ou não atualizando**: `getStockCountSessions()` no `App.tsx` pode estar retornando lista errada ou o filtro client-side quebrou.
- **Botão "Gerar pedido de compra" não navegando**: URL do `navigate()` deve conter `?sourceType=STOCK_COUNT_SESSION&sourceId=<uuid>`. Se URL ficar quebrada, tela `PurchasePlanning` carrega padrão (LATEST_FINAL_CMV) — não é rollback, é bug de UI.
- **`/master-data/categories?sectorId=X` retornando 500 ou dados inconsistentes**: novo query param do Prompt 17. Falha aqui isola a feature (comprador usa dropdown sem filtro de setor); não força rollback imediato.
- **Comprador reportando dropdown "Modelo de compra" sempre "outro"**: `UNIT_ALIASES` não está mapeando UNI/CX/KG etc. Cair pra "outro" em ~86% dos produtos é regressão — verificar se `PurchasePlanning.tsx:UNIT_ALIASES` chegou ao bundle.

### Cenários herdados de deploys anteriores (ainda válidos)

- **Pedidos gerados com valores absurdos**: probe `curl -X POST /purchase-orders/from-planning` com `requestedQuantity: 200000` **deve** retornar HTTP 400 com "Quantidade fora do intervalo aceitavel (maximo 100000)". Se voltar 201, cap saiu do ar → rollback (Prompt 12).
- **`/from-planning` retornando 500 consistentemente** (não confundir com 400 legítimo ou warmup).
- **Rafael reporta comportamento diferente do preview local**: sempre reproduzir localmente primeiro antes de rollback.

### Antes de qualquer rollback

1. Verificar log do Render (Events tab) — descartar cold start / warmup passageiro
2. Reproduzir o problema em preview local com HEAD atual
3. Confirmar que o comportamento antigo (deploy `85e67a8`) resolve — se o problema for pré-existente, rollback não ajuda
4. Notificar o Rafael antes de disparar Método A ou B — janela de 5 min sem app enquanto Render recompila

---

## Referência histórica

- **31f6a47** — planejamento de compra com origem de estoque (era o estável antes de 85e67a8)
- **85e67a8** — cap qty + selo sem preço (LIVE antes deste deploy, alvo de rollback)
- **edfa35f** — este deploy (Prompts 17+18)
