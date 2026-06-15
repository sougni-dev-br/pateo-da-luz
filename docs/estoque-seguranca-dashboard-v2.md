# Pateo da Luz - Evolucao de Estoque, Seguranca e Auditoria

## Migration

Nova migration:

```txt
backend/prisma/migrations/20260529100000_users_audit_inventory/migration.sql
```

Ela cria a base para usuarios, sessoes, auditoria, estoque atual, movimentacoes, contagens e politica de contagem.

## Novas tabelas

- `User`: usuarios do sistema.
- `UserSession`: controle de sessao local.
- `AuditLog`: trilha de auditoria para alteracoes relevantes.
- `InventoryStock`: saldo atual por produto.
- `InventoryMovement`: historico completo de movimentacoes.
- `StockCount`: contagens de estoque e divergencias.
- `StockCountPolicy`: periodicidade de contagem.

## Perfis

- `ADMIN`: perfil maximo. Deve ser o unico autorizado a excluir dados.
- `GESTAO_COMPLETA`: gestao operacional completa, sem exclusoes criticas.
- `ESTOQUISTA`: contagem, conferencia e movimentacao de estoque.
- `VISUALIZACAO`: consulta.

Usuario local inicial:

```txt
email: admin@pateodaluz.local
senha: admin123
perfil: ADMIN
```

Trocar essa senha antes de uso real.

## Endpoints

### Autenticacao

- `POST /auth/login`
- `GET /auth/me`

### Usuarios

- `GET /users`
- `POST /users`
- `PATCH /users/:id/status`

### Estoque

- `GET /inventory/stocks`
- `GET /inventory/movements`
- `POST /inventory/movements`
- `GET /inventory/counts`
- `POST /inventory/counts`
- `GET /inventory/policy`
- `PUT /inventory/policy`

## Regras de negocio

- Toda compra importada passa a poder gerar entrada de estoque via `InventoryMovement` do tipo `PURCHASE_IN`.
- O saldo atual fica consolidado em `InventoryStock`.
- Movimentacoes manuais suportam:
  - entrada manual;
  - saida manual;
  - perda;
  - quebra;
  - ajuste.
- Contagem de estoque calcula:
  - quantidade esperada;
  - quantidade contada;
  - divergencia;
  - ajuste opcional.
- A politica inicial de contagem e semanal.
- O sistema ja deixa o modelo pronto para periodicidade diaria, semanal, quinzenal e mensal.

## Auditoria

O `AuditLog` registra eventos importantes com:

- usuario, quando disponivel;
- acao;
- entidade;
- id da entidade;
- IP;
- user-agent;
- valor anterior;
- valor novo;
- data/hora.

## Frontend

Novas telas:

- Login;
- Estoque;
- Usuarios.

Branding aplicado em:

- login;
- sidebar;
- dashboard.

## Validacao

Comandos executados:

```powershell
cd backend
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npx.cmd" prisma migrate deploy

cd frontend
& "C:\Program Files\nodejs\npm.cmd" run build
```

Validado tambem em backend temporario na porta `3334`:

- login ADMIN;
- `/auth/me`;
- `/inventory/stocks`;
- `/inventory/policy`.
