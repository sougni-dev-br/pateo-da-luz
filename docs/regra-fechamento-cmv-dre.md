# Regra de Fechamento — CMV e DRE

> Documento normativo. Todo fechamento mensal do Pateo da Luz deve passar por este checklist **antes** de considerar o CMV e o DRE do mês encerrados. Nenhum item pode ficar em branco sem uma **justificativa registrada**.

Última revisão: 2026-07-09 (§3.2 preenchida com dados reais do banco local; §3.2.2 lista pendências de cadastro)
Base contábil do CMV: `Estoque inicial + Compras do mês − Estoque final`

---

## 1. Princípio geral

O fechamento só é válido quando **todos os blocos abaixo estão marcados como concluídos** ou possuem justificativa formal (ver §9). Fechar sem justificar é o que gera "dado burro" no DRE — a leitura do mês passa a mentir e contamina comparações históricas.

Ordem obrigatória de execução:

1. Faturamentos (§2)
2. Compras e fornecedores fixos (§3)
3. Despesas fixas (§4)
4. Impostos e obrigações (§5)
5. Inventário final (§6)
6. Conciliações (§7)
7. Validação das duas visões de CMV (§8)
8. Justificativas e assinatura (§9)

Não pular etapas. Cada bloco anterior alimenta o próximo.

---

## 2. Faturamentos — não pode faltar

Todo faturamento do mês precisa estar registrado **antes** do CMV ser fechado. Faturamento incompleto = margem falsa.

- [ ] **Salão (Agile PDV)** — importado pela integração `/integrations/agile` (agente em `C:\PateoAgent`). Conferir na tela `/financeiro/faturamento-salao` que todos os dias do mês têm valor.
- [ ] **Delivery próprio** (se houver) — lançar diariamente ou fechar bloco mensal.
- [ ] **iFood / Uber Eats / Rappi** — repasses do mês conferidos contra extrato da plataforma.
- [ ] **Eventos / fechamento de casa** — receitas não recorrentes lançadas na categoria correta.
- [ ] **Outras receitas** (couvert, taxa de serviço reconhecida como receita, etc.).

**Regra de corte:** o faturamento considera o **regime de competência** (dia da venda), não o dia do recebimento. Recebíveis futuros ficam em conciliação de cartões (§7).

---

## 3. Compras do mês e fornecedores fixos

Toda nota fiscal de entrada do mês precisa estar lançada, classificada e com CFOP correto. Categoria DRE do produto é o eixo — ver [[memoria-cmv-dre-2026-07-08]].

### 3.1 Checklist de lançamento

- [ ] Todas as NF-e do mês baixadas e conferidas contra o portal da Sefaz / e-mails de fornecedor.
- [ ] Cada item com categoria DRE definida (`Custo de Alimentos`, `Bebidas`, `Descartaveis`, `Descartaveis / Delivery`, `Material de Limpeza`, `Despesas Gerais`).
- [ ] Produtos novos passaram pela fila de revisão (`exports/cmv-review-queues-*`).
- [ ] Compras avulsas em dinheiro / pix (sem NF) lançadas como despesa com comprovante anexado.

### 3.2 Fornecedores fixos — devem ter compra no mês

> Lista consolidada a partir da análise do banco em 2026-07-09 (janela mar–jul/2026, script `backend/scripts/propose-fixed-suppliers-v2.ts`, export em `exports/fornecedores-fixos-v2b-2026-07-09.md`). Se um fornecedor da lista **não teve compra** no mês, precisa de justificativa (§9). Ausência silenciosa é o padrão que mais distorce o CMV.

#### 3.2.1 Fornecedores CONFIRMADOS pela base

| Categoria DRE | Fornecedor | CNPJ | Frequência observada | Marcar |
|---|---|---|---|---|
| **Bebidas** | AMBEV S/A CDD – São Paulo | 07.526.557/0105-04 | semanal (4/5 meses, ~13 entregas) | ☐ |
| **Custo de Alimentos** | NOVA UNIAO ALIMENTOS EIRELI | 07.172.011/0001-06 | volume alto — 28 compras / 3 meses | ☐ |
| Custo de Alimentos | CASTELÃO DIST. DE FRIOS E LATICÍNIOS | 45.758.190/0001-49 | volume alto — 60 compras / 3 meses | ☐ |
| Custo de Alimentos | PESCADOS POPO LTDA | 31.901.640/0001-04 | peixaria principal — 30 compras / 3 meses | ☐ |
| Custo de Alimentos | JJE PESCADOS LTDA – ME | 17.847.991/0001-45 | peixaria secundária — 12 compras / 3 meses | ☐ |
| Custo de Alimentos | PICAPAU – ANA HORTIFRUTI | 46.191.984/0001-36 | hortifruti principal — 23 compras / 3 meses | ☐ |
| Custo de Alimentos | FLD HORTIFRUTIGRANJEIRO | 37.643.752/0001-80 | hortifruti secundária — 17 compras / 3 meses | ☐ |
| Custo de Alimentos | PMG PAMA – GÊNEROS ALIMENTÍCIOS | 11.660.951/0002-94 | mercearia — 13 compras / 3 meses | ☐ |
| Custo de Alimentos | JM MEAT COMÉRCIO DE CARNES | 25.126.358/0001-96 | açougue — 8 compras / 3 meses | ☐ |
| Custo de Alimentos | ADRV DISTRIBUIÇÃO DE PRODUTOS | 34.348.459/0001-00 | 23 compras / 3 meses | ☐ |
| Custo de Alimentos | DELTA FOODS BRASIL | 14.830.817/0001-00 | 4 meses de compra | ☐ |
| Custo de Alimentos | MASTER ATS SUPERMERCADOS | 01.874.166/0009-57 | mercado — café funcionários + gerais | ☐ |
| Custo de Alimentos | DOCES DOCELANDIA E VAZ | 12.264.015/0004-99 | mensal | ☐ |
| Custo de Alimentos | SHOPEE | – | 5/5 meses, compras pequenas | ☐ |
| **Embalagens / Descartáveis** | KATIVA – TRINCA DISTRIBUIDORA | 41.923.215/0001-61 | principal — 24 compras / 3 meses | ☐ |
| Embalagens / Descartáveis | KATIVA – TRIADE HIGIENE E DESCARTÁVEIS | 41.490.983/0001-79 | 4/5 meses | ☐ |
| Embalagens / Descartáveis | DISTUDO – DPRO | 18.173.605/0001-40 | 16 compras / 3 meses | ☐ |
| Embalagens / Descartáveis | RICAPEL | 36.078.911/0001-89 | mensal | ☐ |
| Embalagens / Descartáveis | PAPEL PLÁSTICO ITUPEVA S/A | 13.254.314/0001-62 | mensal | ☐ |
| **Material de Escritório** | KALUNGA S/A | 43.283.811/0212-38 | 8 compras / 3 meses | ☐ |
| **Serviços de Terceiros** | ACESSONUTRI – ASSESSORIA EM NUTRIÇÃO | 27.965.411/0001-78 | mensal — 8 compras / 3 meses | ☐ |
| Serviços de Terceiros — Manutenção | ACS REFRIGERAÇÃO E ELÉTRICA (Toninho) | 28.542.065/0001-88 | mensal — cadastrado, aparece só em jun/2026 no local (subamostrado) | ☐ |
| **Cartão empresa (OTHER)** | Fatura Sicredi Marcos C Morra final 3890 | – | mensal — 4/5 meses | ☐ |

#### 3.2.2 Fornecedores/despesas **NÃO CADASTRADAS** no sistema — obrigatório cadastrar antes do próximo fechamento

> Estes itens foram citados pela gestão como recorrentes mas **não aparecem** no banco (varredura por palavra-chave em 2026-07-09). Sem cadastro, saem do DRE e inflam o resultado. Cadastrar como fornecedor + lançar competência mensal.

| Categoria esperada | Item / fornecedor citado | Onde entra no DRE | Status | Marcar |
|---|---|---|---|---|
<!-- Manutenção Toninho movida para §3.2.1 — ACS REFRIGERAÇÃO E ELÉTRICA, CNPJ 28.542.065/0001-88 (confirmado 2026-07-09) -->
| Gás | Fornecedor de GLP / gás encanado | Despesas Gerais | ❌ não cadastrado | ☐ |
| CO₂ | Fornecedor de CO₂ do chope | Custo de Alimentos (managerial) | ❌ não cadastrado no fluxo atual | ☐ |
| Aluguel | Locador do ponto | Despesas Fixas | ❌ não cadastrado | ☐ |
| Energia elétrica | Enel / distribuidora local | Despesas Fixas | ❌ não cadastrado | ☐ |
| Água / esgoto | Sabesp | Despesas Fixas | ❌ não cadastrado | ☐ |
| Internet / telefonia | (operadora) | Despesas Fixas | ❌ não cadastrado | ☐ |
| Contador | Escritório contábil | Serviços de Terceiros | ❌ não cadastrado | ☐ |
| Folha de pagamento | Salários competência | Folha / Pessoal | ❌ não cadastrado | ☐ |
| Pró-labore Eli | Retirada mensal | Folha / Pessoal | ❌ não cadastrado | ☐ |
| Encargos trabalhistas | INSS patronal, FGTS, provisões | Folha / Pessoal | ❌ não cadastrado | ☐ |
| Impostos (TaxPayment) | DAS Simples, ISS, GPS, GRRF, IRRF | Impostos e taxas | ❌ **módulo TaxPayment está vazio** | ☐ |
| Marketing / Delivery apps | iFood taxa fixa, impulsionamentos | Marketing / Comercial | ❌ não cadastrado como fornecedor | ☐ |
| Assinaturas / SaaS | GLOBO PLAY, WIX, CHAT-GPT (já existem esporádicos) | Despesas Gerais | ⚠️ existem mas sem recorrência mensal registrada | ☐ |

**Ação obrigatória antes do próximo fechamento:**
1. Cadastrar cada fornecedor da §3.2.2 no módulo de fornecedores (mesmo os de despesa fixa — precisam existir como `Supplier`).
2. Alimentar `TaxPayment` com os impostos mensais competência.
3. Lançar as competências dos últimos 3 meses (Mai/Jun/Jul 2026) pra corrigir o histórico do DRE.
4. Repetir a análise (`npx tsx backend/scripts/propose-fixed-suppliers-v2.ts --window 6 --min 4`) e mover cada item da §3.2.2 pra §3.2.1 conforme forem sendo cadastrados e reconhecidos como fixos.

---

## 4. Despesas fixas mensais

Despesas fixas **sempre** entram no DRE do mês, mesmo se o pagamento atrasar (regime de competência).

- [ ] **Aluguel** do ponto
- [ ] **Condomínio / IPTU** (se rateado mensal)
- [ ] **Energia elétrica** — fatura do mês competência
- [ ] **Água / esgoto**
- [ ] **Gás encanado** (se aplicável, senão via §3)
- [ ] **Internet + telefonia**
- [ ] **Software / SaaS** (ERP próprio custa infra: Render, SiteGround, domínios)
- [ ] **Contador**
- [ ] **Folha de pagamento** — salários competência do mês
- [ ] **Pró-labore** do Eli
- [ ] **Encargos trabalhistas** (INSS patronal, FGTS, provisão de férias/13º)
- [ ] **Vale-transporte / vale-refeição** dos funcionários
- [ ] **Uniformes / EPIs** (quando houver)
- [ ] **Manutenção preventiva** (equipamentos de cozinha, ar-condicionado, exaustão)
- [ ] **Taxa de máquinas de cartão** (aluguel, se houver)
- [ ] **Marketing / mídias** (impulsionamento, agência, delivery apps taxa fixa)
- [ ] **Alvarás / licenças** rateados no mês competência

Despesa fixa **não lançada** = lucro inflado. Rever mês a mês.

---

## 5. Impostos e obrigações fiscais

- [ ] **DAS Simples Nacional** — apuração do mês (guia gerada até dia 20 do mês seguinte).
- [ ] **ISS** — se destacado ou fora do Simples.
- [ ] **INSS empregados** (GPS) — competência do mês.
- [ ] **FGTS** — GRRF/GFIP do mês.
- [ ] **IRRF** sobre folha (quando aplicável).
- [ ] **IRRF sobre pró-labore** (quando aplicável).
- [ ] **Contribuição sindical / patronal** (quando houver).
- [ ] **Taxas municipais** (funcionamento, vigilância sanitária) — rateio mensal.

Cada guia gerada precisa estar registrada no módulo fiscal / contas a pagar. Guia esquecida = distorção fiscal + risco de multa.

---

## 6. Inventário final

O CMV depende disso. **Sem contagem física, não há CMV real** — só estimativa.

- [ ] Contagem física realizada no **último dia útil do mês** (ou primeiro dia do mês seguinte, antes de abrir a operação).
- [ ] Contagem por setor: cozinha, bar, estoque seco, câmara/geladeiras, descartáveis.
- [ ] Planilha de contagem exportada e conferida (dupla contagem em itens de alto valor: destilados, cortes nobres).
- [ ] Divergências acima de X% investigadas (perda, quebra, furto, erro de lançamento).
- [ ] Inventário final do mês N vira **estoque inicial do mês N+1** automaticamente no sistema.

**Regra:** categorias `Descartaveis` e `Material de Limpeza` também são contadas — entram na visão gerencial do CMV.

Se a contagem não foi feita, o fechamento **não pode** rodar com estoque estimado sem justificativa formal (§9).

---

## 7. Conciliações

- [ ] **Bancária** — todos os extratos do mês conciliados.
- [ ] **Cartões** — recebíveis do mês (com taxa e prazo) batem com relatório da adquirente (Cielo, Stone, etc.).
- [ ] **Contas a pagar em aberto** — revisadas; nenhuma nota do mês esquecida.
- [ ] **Contas a receber** — recebíveis futuros de eventos e faturados.
- [ ] **Caixa físico** — sangria e fechamento diários batem com sistema.

---

## 8. Validação das duas visões de CMV

Base técnica em [[cmv-dre-consolidacao-2026-07-08]].

- [ ] `Visão contábil (accounting)` — topo do DRE bate com este valor.
- [ ] `Visão gerencial (managerial)` — inclui `Material de Limpeza`, `Descartaveis`, `Descartaveis / Delivery`.
- [ ] Diferença entre as duas visões faz sentido (é aproximadamente o total dessas categorias).
- [ ] CMV como % do faturamento dentro da faixa esperada do Pateo (histórico). Fora da faixa = investigar antes de fechar.

**Regra do topo do DRE:** o topo sempre usa `accountingView`. Nunca reintroduzir agregação paralela de despesas ali — foi exatamente o bug corrigido em 2026-07-08 (`backend/src/modules/dre/dre.routes.ts`).

---

## 9. Justificativas — quando algo fica em aberto

Se **qualquer** item dos blocos §2 a §8 não puder ser cumprido antes do fechamento, é obrigatório registrar:

1. **O que ficou pendente** (item específico do checklist).
2. **Por que** não foi possível cumprir (motivo real, não "faltou tempo").
3. **Impacto estimado** no CMV / DRE do mês (R$ ou %).
4. **Prazo de regularização** (mês/data em que será corrigido).
5. **Quem autorizou** o fechamento com a pendência.

Onde registrar: campo de observação do fechamento do mês no módulo DRE + cópia em `docs/fechamentos/YYYY-MM-justificativas.md`.

**Regra dura:** fechamento sem justificativa é fechamento inválido. Não usar o número para decisão de gestão até a pendência ser resolvida.

---

## 10. Ordem cronológica recomendada do fechamento

Prazo alvo: até o **5º dia útil do mês seguinte**.

| Dia | Atividade |
|---|---|
| Último dia do mês | Contagem física de inventário (§6) |
| D+1 a D+2 | Lançamento de NF-e atrasadas, conferência de fornecedores fixos (§3) |
| D+2 | Faturamentos finalizados — salão, delivery, plataformas (§2) |
| D+3 | Despesas fixas lançadas em competência (§4) |
| D+3 a D+4 | Conciliações bancária e de cartões (§7) |
| D+4 | Guias fiscais geradas e registradas (§5) |
| D+5 | Rodar DRE, validar as duas visões (§8), registrar justificativas (§9) |

---

## Anexos / referências vivas

- Regra base do CMV e correção do topo do DRE: `docs/memoria-cmv-dre-2026-07-08.md`
- Fila de classificação de produtos: `exports/cmv-review-queues-2026-07-08/`
- Relatório de saneamento: `exports/cmv-base-sanitization-report-2026-07-08.md`
- Backend do DRE: `backend/src/modules/dre/dre.routes.ts`
- Integração PDV salão: memória `integracao_agile_pdv`

---

_Este documento é vivo. Ao adicionar fornecedor fixo, despesa fixa nova ou obrigação fiscal nova, atualizar a tabela correspondente e registrar a data da revisão no topo._
