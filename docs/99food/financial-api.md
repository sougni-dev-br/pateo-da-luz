# 99Food — Financial API

> Capturado da doc oficial do portal (Documentos do desenvolvedor → Food → Financial API)
> em 2026-08-06. NÃO está no `swagger.yaml` local (que só cobre os endpoints v1 de pedidos).
> Host base diferente: `openapi.99food.com` (os pedidos usam o host do protocolo v1).

## Situação de acesso (whitelist)

A doc marca esses endpoints como `Permission: WhiteList` / `Special Authorization Needed`.
Porém, em resposta ao nosso chamado (2026-08), a 99 confirmou:

> "Caso o consumo desses endpoints se dê para lojas que estejam vinculadas somente ao
> aplicativo de vocês, nenhuma liberação é necessária. Basta consumir os endpoints —
> atentando-se ao fato de que **o token exigido é diferente do token requerido pelos
> endpoints de pedidos**."

Como as lojas do Pateo ficam vinculadas só ao nosso app, **não precisamos de whitelist**.
O ponto de atenção é o token separado (abaixo).

---

## 1. Get Financial API AccessToken (auth próprio)

O token daqui dá acesso **somente** às Financial APIs — é diferente do `auth_token` por-loja
usado nos endpoints de pedidos.

- **URL:** `POST https://openapi.99food.com/v3/auth/authtoken/signIn`
- **Permission:** Available (não precisa whitelist)

### Request body
| Campo | Tipo | Obrig. | Descrição | Exemplo |
|---|---|---|---|---|
| `retailer` | string | Sim | O `app_id` | `<app_id>` |
| `secret` | string | Sim | O `app_secret` | `<app_secret>` |

### Response
| Campo | Tipo | Descrição |
|---|---|---|
| `accessToken` | string | JWT p/ o app |
| `expiresIn` | int | Segundos até expirar (ex.: `21600` = 6h) |

```json
{ "accessToken": "<accessToken JWT>", "expiresIn": 21600 }
```

> Nível de APP (não por loja). Usar `retailer`=app_id + `secret`=app_secret.
> Cachear e renovar antes de expirar (6h).

---

## 2. Get Settlements Data (repasse semanal) — `getShopBillWeek`

Dados semanais de repasse por loja. Base pra registrar Contas a Receber.

- **URL:** `POST https://openapi.99food.com/v3/finance/finance/getShopBillWeek`
- **Header:** `Authorization: Bearer <accessToken>`

### Request body
| Campo | Tipo | Obrig. | Descrição |
|---|---|---|---|
| `acceptor_code` | string | Sim | `app_shop_id` (o que definimos no portal) |
| `page_no` | int | Sim | Página atual |
| `page_size` | int | Sim | Registros por página (máx. **200**) |
| `start_date` | string | Sim | Início do período `YYYYMMDD` |
| `end_date` | string | Sim | Fim do período `YYYYMMDD` |

### Response — envelope + `data.data[]`
| Campo | Tipo | Descrição |
|---|---|---|
| `weekPaymentId` | string | Identificador único do repasse (chave de dedup) |
| `withdrawDate` | string | Data efetiva do repasse (ISO-8601) |
| `withdrawAmount` | int | Valor do repasse (**centavos**; ex. `1100` = R$ 11,00) |
| `liability` | string | Entidade responsável pelo pagamento |
| `shopId` | int | ID da loja no 99 |
| `settleStartDate` | string | Início do período de apuração `YYYYMMDD` |
| `settleEndDate` | string | Fim do período de apuração `YYYYMMDD` |
| `currency` | string | Moeda (`BRL`) |
| `dayPaymentIDList` | array | IDs de repasse diário (liga com o Get Bill Data via `dayPaymentId`) |

### Limites / erros (errno)
- `110004` — só permite consultar dados dentro de **3 meses**.
- `110005` — range máximo de **31 dias** por consulta.
- `110006` — start não pode ser maior que end.
- `10001` sistema, `10002` parâmetro, `110002/110003` formato de data.

```json
{
  "errno": 0, "errmsg": "ok",
  "data": { "data": [{
    "weekPaymentId": "510_BFMW202508128a6a6ed55bb9",
    "withdrawDate": "2025-09-03", "withdrawAmount": 1100,
    "liability": "Nourishflow", "shopId": 5764608924570091908,
    "settleStartDate": "20250825", "settleEndDate": "20250831",
    "currency": "BRL", "dayPaymentIDList": ["1945389697417496990", "..."]
  }], "total_num": 1, "total_page": 1, "page_size": 100, "page_no": 1 }
}
```

---

## 3. Get Bill Data (detalhe diário por pedido) — `getShopBillDetail`

Detalhamento por pedido. **Só retorna pedidos confirmados pela loja.** É aqui que sai a
comissão efetiva por pedido, refunds, etc. — cruza com o callback `orderNew` via `orderId`.

- **URL:** `POST https://openapi.99food.com/v3/finance/finance/getShopBillDetail`
- **Header:** `Authorization: Bearer <accessToken>`
- **Body:** igual ao getShopBillWeek (`acceptor_code`, `page_no`, `page_size` máx 200, `start_date`, `end_date` YYYYMMDD)
- Mesmos limites de erro (janela 3 meses / range 31 dias).

### Data Model (campos principais — todos valores int em **centavos**)
| Campo | Descrição |
|---|---|
| `orderId` / `orderIndex` | ID e índice do pedido (liga com o webhook) |
| `orderType` | 1-Receita; 2-Refund total; 3-Refund parcial em venda; 4-Refund pós-venda; 5-Non-accompanying/monthly fee |
| `deliveryType` | 0-sem entrega; 1-plataforma; 2-loja; 20-terceiro |
| `businessDateTime` / `businessTs` | Data/hora do fato gerador |
| `mealOriginalAmount` | Preço original antes de descontos |
| `shopActivityOutcome` / `shopActivitySubsidy` | Custo da loja / subsídio da plataforma em descontos de item |
| `shopDeliveryAmount` | Taxa de entrega recebida pela loja (self-delivery) |
| `shopPreTips` | Gorjeta paga pelo cliente à loja |
| `freeDeliveryOutcome` / `freeDeliverySubsidy` | Custo da loja / subsídio em campanhas de frete grátis |
| `commissionBaseAmount` | Base de cálculo da comissão |
| `commissionRate` | Alíquota de comissão (base 10000 → `3500` = 35,00%) |
| `commissionAmount` | **Comissão cobrada pela plataforma** |
| `commissionSubsidyAmount` | Subsídio de comissão da plataforma |
| `b2pDeliveryAmount` | Taxa logística cobrada pela plataforma |
| `payCommissionAmount` | Taxa de processamento de pagamento |
| `orderAmount` | Valor final do pedido |
| `paymentMethod` | 0-default, 1-online, 2-offline, -1-refund |
| `paymentChannel` / `paymentMethodDetail` | Canal/detalhe de pagamento (PIX 212/280, cartão, VR, etc.) |
| `settlementAmount` | **Valor final a repassar à loja nessa transação** |
| `expectSettleDate` | Data prevista do repasse (ISO-8601) |
| `dayPaymentId` | ID do repasse diário (liga com `dayPaymentIDList` do Settlements) |
| `vatAmount` | IVA sobre a comissão da plataforma |
| `mealLossDeductAmount` | Dedução por responsabilidade da loja em cancelamento |
| `merchantAppealAmount` | Reembolso por recurso do lojista |

> Grocery-only (orderType=5): `monthlyServicePrice`, `gmv`, `monthlyServiceBasePrice`,
> `monthlyServiceCalculationCycle`. Não se aplica ao Pateo (restaurante).

---

## Como plugar no ERP (plano de implementação)

Espelhar o `ifood-financial-api.ts`:

1. **`noventa-nove-financial-api.ts`** — cliente com auth próprio (signIn → cachear accessToken 6h).
2. **Sync diário** (1x/dia): para cada loja, chamar `getShopBillWeek` no período e registrar cada
   `weekPaymentId` como uma linha de **Contas a Receber** (Receivable).
3. **Reconciliação de comissão**: cruzar `getShopBillDetail` (por `orderId`) com os callbacks
   `orderNew` já persistidos em `NoventaNoveSale` → comissão efetiva = soma(`commissionAmount`)
   e repasse líquido = soma(`settlementAmount`) por período (`settleStartDate`/`settleEndDate`).
4. **Refletir no DRE**: repasse líquido como receita realizada; comissão como despesa da plataforma.

### Pontos a confirmar na implementação
- **Unidade monetária**: docs mostram int (centavos). Validar dividindo por 100 num pedido real.
- **`commissionRate`**: assumir base 10000 (basis points → /100 = %). Confirmar com pedido real.
- **Assinatura**: a Financial API usa Bearer token; não observei header de `sign` aqui (diferente
  do webhook de pedidos, que usa `didi-header-sign` MD5).
