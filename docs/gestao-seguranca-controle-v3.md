# Gestao, Seguranca e Controle - V3

## Migration

```txt
backend/prisma/migrations/20260529113000_purchase_cancellation_password_audit/migration.sql
```

## Dashboard

O endpoint `GET /dashboard/purchases` aceita:

- `year`
- `month`
- `startDate`
- `endDate`

O frontend agora possui filtros visuais:

- mes/ano;
- data inicial;
- data final;
- mes atual;
- mes anterior;
- ultimos 7 dias;
- ultimos 30 dias;
- ano atual.

Todos os indicadores do dashboard usam o periodo selecionado.

## Usuarios e senhas

Novos recursos:

- alterar perfil do usuario;
- marcar/desmarcar troca obrigatoria de senha;
- redefinir senha de usuario;
- alterar a propria senha;
- inativar/reativar usuario;
- ver ultimo login e status.

Endpoints:

- `PUT /users/:id`
- `PATCH /users/:id/password`
- `POST /auth/change-password`

Regras:

- senha continua criptografada com `scrypt`;
- ADMIN nao ve senha atual;
- redefinicao de senha encerra sessoes do usuario;
- alteracoes geram `AuditLog`.

## Compras canceladas

Novos campos em `Purchase`:

- `status`;
- `cancelledAt`;
- `cancellationReason`;
- `cancelledByUserId`;
- `restoredAt`;
- `restoredByUserId`.

Endpoints:

- `PATCH /purchases/:id/cancel`
- `PATCH /purchases/:id/restore`

Regras:

- somente `ADMIN` pode cancelar/restaurar;
- cancelamento exige motivo;
- compra nao e apagada fisicamente;
- status muda para `CANCELLED`;
- restauracao volta para `ACTIVE`;
- tudo registra `AuditLog`.

## Estoque vinculado

Ao cancelar compra:

- movimentacoes `PURCHASE_IN` vinculadas aos itens da compra sao marcadas como canceladas;
- o saldo em `InventoryStock` e estornado.

Ao restaurar compra:

- movimentacoes vinculadas sao reativadas;
- saldo em estoque e recomposto.

## Auditoria visual

Nova tela:

- `Auditoria`

Endpoint:

- `GET /audit`

Filtros:

- usuario;
- entidade;
- data inicial;
- data final.

A tela exibe:

- acao;
- entidade;
- usuario;
- IP;
- data/hora;
- detalhes antes/depois.

## Validacao

Executado:

```powershell
cd backend
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npx.cmd" prisma migrate deploy

cd frontend
& "C:\Program Files\nodejs\npm.cmd" run build
```

Validado em backend temporario na porta `3334`:

- login ADMIN;
- dashboard por periodo;
- usuarios;
- auditoria;
- compras com `showCancelled=true`.
