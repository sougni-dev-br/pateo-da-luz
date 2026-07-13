# 99 Food / DiDi Food Open Platform — notas de integração

⚠️ **Conteúdo sob NDA da 99/DiDi.** O `swagger.yaml` NÃO é versionado
(ver `.gitignore`). Fica só na máquina local pra consulta.

## Termos que usamos vs. os deles

| Nosso schema (Prisma)                              | 99 Food (DiDi)                            | O que é                                                                 |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `DeliveryStore.externalId`                         | `app_shop_id` (string)                    | ID que **nós** atribuímos à loja no sistema do Pateo                    |
| `DeliveryStore.shopIdRemote`                       | `shop_id` (long/bigint)                   | ID que a **99** atribui à loja no sistema deles (recebido no bind)      |
| `NoventaNoveCredential.clientId`                   | `app_id` (long/bigint)                    | ID do nosso app cadastrado em developer-food.99app.com                  |
| `NoventaNoveCredential.clientSecret`               | `app_secret` (string)                     | Secret pra gerar authtoken                                              |
| `NoventaNoveShopAuthToken.authToken`               | `auth_token` (string)                     | Token de autenticação **por loja**, com validade + refresh              |

## URLs (produção)

- API base:       `https://openapi.didi-food.com`
- Portal dev:     `https://developer-food.99app.com/pt-BR/openapi`
- Contato dev:    `didiOpenApiSupport@didiglobal.com`

## Fluxo de bind (self-service)

1. `POST /v1/auth/authorizationpage/getUrl` com `{ app_id, app_shop_id }` → retorna URL
2. Loja abre essa URL e autoriza no site do 99 Food
3. Após autorização, `shop_id` do 99 fica vinculado ao nosso `app_shop_id`
4. `GET /v1/auth/authtoken/refresh?app_id=X&app_secret=Y&app_shop_id=Z` → cria token novo
5. `GET /v1/auth/authtoken/get?app_id=X&app_secret=Y&app_shop_id=Z` → retorna `{ auth_token, token_expiration_time }`

Endpoints operacionais (`shop/*`, `order/*`, `item/*`) usam `auth_token` como query param.

## Autenticação — dois esquemas

- **Por loja:** query param `auth_token` (obtido acima)
- **Global (algumas rotas de listagem):** query/body `{ app_id, timestamp, sign, ... }`
  onde `sign` é um HMAC. **Algoritmo exato: TODO — está na doc HTML em
  "Before Coding", ainda não confirmado.**

## Como pedidos chegam

- ❌ NÃO existe endpoint pra listar pedidos por data
- ✅ 99 envia **webhook/callback** pra nosso endpoint público a cada evento
- Nosso endpoint: `POST /integrations/delivery/noventa-nove/webhook`
- Payload traz `OrderModel` completo (bruto, taxas, promos, cupons — tudo em cents)
- IDs são `long` 64-bit → tratar sempre como string no JSON (Number.MAX_SAFE_INTEGER < long max)

## Como valores financeiros funcionam

- `PriceModel` no callback traz:
  - `order_price` — bruto original dos itens
  - `real_price` — depois de desconto do merchant
  - `real_pay_price` — depois de cupom (o que o cliente pagou)
  - `delivery_price` — custo entrega
  - `items_discount`, `delivery_discount`, `others_fees` (small_order, tip, service, coupon)
- ❌ **Comissão do 99 NÃO vem via API** — a 99 provavelmente cobra via invoice
  mensal por email. Precisa lançamento manual ou % contratual configurável.

## Limitações e pontos de atenção

- ⚠️ **Cada loja só pode ser bindada a UM production app** — não misturar
- ⚠️ **Sandbox só depois de "Qualification Audit" aprovado no portal**
- ⚠️ **IDs (app_id, shop_id, order_id) são bigint** — sempre string em TS
- ⚠️ **Portal alerta que a doc muda sem aviso prévio** — validar antes de deploy real

## Fases da integração (99 recomenda)

1. Pre-Process (contato + NDA + cadastro) — Pateo terminou
2. Await Qualification Audit — Pateo está aqui (até 3 dias úteis)
3. Development in Test Environment — só depois da aprovação
4. Pilot Phase — começar com 1-2 lojas, não as 4 de uma vez
5. Expansion + Monitoring
