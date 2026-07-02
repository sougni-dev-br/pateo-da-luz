# ROLLBACK — plano de reversão do deploy 01/07/2026

Deploy corrente: **`85e67a8`** (Prompt 12: cap qty + selo sem preço) + **`c39d1cf`** (Prompt 13: 8 refinamentos UX).
Ambos foram para produção em **01/07/2026 ~00:31 UTC**.

Estado estável ANTES do push: **`31f6a47`** (planejamento de compra com origem de estoque). É pra ele que se reverte.

---

## Backup pré-push (único paraquedas)

- **Arquivo**: `C:\Projeto_pateo_Claude\backups\pateo-prod-20260701-190441.dump`
- **Timestamp UTC**: `2026-07-01 22:04:42` (registrado dentro do dump)
- **Formato**: pg_dump custom (`-Fc`), gzip
- **Tamanho**: 1.95 MB
- **Conteúdo**: 124 tabelas, 254 índices, 127 FKs, 533 entradas TOC

**Plano Render Free NÃO tem daily backup automático.** Este arquivo é o ÚNICO ponto de restauração possível para o estado pré-push.

> Sugestão: subir cópia para Google Drive ou similar. A única cópia hoje está numa máquina local — se ela falhar, o backup vai junto.

---

## Sinais que indicam rollback

- **Pedidos gerados com valores absurdos** — probe rápido: `curl -X POST /purchase-orders/from-planning` com `requestedQuantity: 200000` **deve** retornar HTTP 400 com "Quantidade fora do intervalo aceitavel (maximo 100000)". Se voltar 201, cap saiu do ar → rollback.
- **`/from-planning` retornando 500 consistentemente** (não confundir com 400 legítimo ou warmup).
- **Rafael reporta comportamento diferente do preview local** (sempre reproduzir localmente primeiro antes de rollback).
- **KPI "Custo estimado" divergindo entre header / modal / barra sticky / banco** — as 5 camadas foram validadas consistentes no Prompt 10. Divergência = regressão nova.

---

## Antes de acionar rollback

1. **Autoriza**: Eli. Rafael pode reportar sintoma, mas rollback é decisão do dev.
2. **Descartar warmup do Free tier**: aguardar 30 s do primeiro request após inatividade, tentar de novo. Free tier hiberna — primeiro request pode demorar até 30 s.
3. **Reproduzir local**: se o sintoma não reproduz no `npm run dev`, provavelmente é config/env, não código. Rollback não vai resolver.
4. **Comunicar Rafael** se ele estiver usando o sistema no momento.

---

## Método A — Rollback rápido (só código, sem tocar banco)

Via dashboard Render. Reverte deploy sem mexer no git.

1. `https://dashboard.render.com/web/srv-d8o1h9j6sc1c738vp8j0/deploys`
2. Localizar deploy anterior ao atual (o de `31f6a47`).
3. Clicar **Redeploy**.
4. Aguardar build (~4–5 min).
5. Validar com o mesmo curl 3 do Prompt 14 (qty=200000 → esperado 201, porque o cap era do commit revertido).

Git local continua ahead com `85e67a8` e `c39d1cf` — não afeta nada, só significa que o remote está atrás. Depois dá pra decidir se comita revert (Método B) ou re-push.

---

## Método B — Rollback definitivo (via git)

Cria commits novos que desfazem os anteriores. Auto-deploy dispara sozinho.

```bash
cd /c/Projeto_pateo_Claude/pateo-da-luz
git revert 85e67a8 c39d1cf --no-edit
git push origin main
```

Depois:
1. Aguardar deploy (~4–5 min).
2. Rodar os 3 curls de validação (Prompt 14 Fase 3, adaptados: agora qty=200000 deve **passar** porque cap saiu com o revert).

---

## Método C — Restaurar banco (se dado foi corrompido)

Só use se o problema for DADOS, não código. Se for código, Método A ou B resolve sem tocar banco.

**Não restaure por cima da produção diretamente.** Restaure em banco temporário no Render, valide, depois swap via `DATABASE_URL`.

```bash
# 1) Criar database temporário no Render (dashboard → Databases → New Database)
#    Anotar a connection string do novo banco: NEW_DB_URL

# 2) Restore no banco temporário
MSYS_NO_PATHCONV=1 docker run --rm -v "C:\\Projeto_pateo_Claude\\backups:/backups" \
  postgres:18-alpine \
  pg_restore --clean --if-exists --no-owner --no-privileges \
    -d "NEW_DB_URL" \
    /backups/pateo-prod-20260701-190441.dump

# 3) Validar dados no banco temporário (contagens, produtos, etc.)

# 4) No dashboard Render, editar env var DATABASE_URL do serviço pateo-backend
#    para apontar para NEW_DB_URL. Render reinicia o serviço.

# 5) Após confirmar tudo OK, deletar o banco antigo (dashboard).
```

**Restore seletivo (só uma tabela)** — se o problema foi contido:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "C:\\Projeto_pateo_Claude\\backups:/backups" \
  postgres:18-alpine \
  pg_restore -t NomeDaTabela -d "URL" /backups/pateo-prod-20260701-190441.dump
```

---

## Checklist pós-rollback

- [ ] Curl `GET /health` retorna 200
- [ ] Curl `GET /suppliers?activeOnly=true` retorna 200 com lista de fornecedores
- [ ] Curl `GET /inventory/operational/buyer-support` retorna 200
- [ ] Frontend em `https://pateo.sougni.com` carrega sem erros no console
- [ ] Comunicar Rafael que o rollback ocorreu (se ele foi afetado)
- [ ] Documentar razão do rollback em issue/nota (aprender para o próximo deploy)
