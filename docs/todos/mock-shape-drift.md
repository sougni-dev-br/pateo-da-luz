# TODO — Mock-user shape drift

## Contexto

O interceptor `installMockFetch` em [frontend/src/lib/mockUser.ts](../../frontend/src/lib/mockUser.ts)
devolve fallback `{}` para qualquer endpoint que não match uma regra
específica. Durante a Fase 5 descobrimos 3 endpoints cujo shape real
é estruturado (com propriedades esperadas sem optional chaining nas
páginas), e o fallback `{}` crashava a rota inteira em modo mock —
o que também é sinal de fragilidade em produção se o backend algum
dia mudar o shape.

## Endpoints com shape específico agora mockado

Todos vivem em produção e as páginas dependem do formato. Se o
backend mudar sem atualizar o TypeScript, estas telas explodem
primeiro:

| Endpoint | Shape esperado | Página que crashava | Commit |
|---|---|---|---|
| `GET /inventory/agenda` | `{ year, month, items: [], rules: [] }` | Estoque Visão Geral (`agenda.items.find`) | `504c0f7` |
| `GET /inventory/operational/buyer-support` | `{ summary: {...11 campos}, items: [] }` | Estoque (relatório do comprador) | `504c0f7` |
| `GET /purchase-orders` | `{ orders: [], summary: {} }` | Pedidos de compra (`data.orders.map`) | `a9b861c` |
| `GET /revenue` | `{ entries: [], summary: { byChannel: [], byPlatform: [] } }` | Faturamento | `4595333` |

## Ação sugerida (fora do escopo do PR do DS)

- Adicionar teste de contrato entre backend e frontend (Zod schema
  compartilhado ou snapshot da resposta) para os 4 endpoints acima
  — hoje eles dependem só do TypeScript, que confia no comentário
  `request<T>()` no client.
- Ou: envolver os acessos aninhados críticos em defaults (`agenda?.items ?? []`,
  `summary?.byChannel ?? []`) — mais barato, cobre o crash mas mascara
  bug de dados.
