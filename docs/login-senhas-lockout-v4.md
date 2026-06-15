# Login, Senhas Temporarias e Bloqueio - V4

## Fluxo corrigido

- `Gerar senha temporaria` apenas gera a senha visualmente na tela.
- `Aplicar nova senha` salva a senha no banco com hash `scrypt`.
- Quando `Obrigar troca no proximo login` esta marcado:
  - o login com a senha temporaria funciona;
  - o usuario entra na tela de alteracao obrigatoria;
  - a mensagem exibida e: `Voce precisa alterar sua senha antes de continuar.`

## Politica de senha

Minimo:

- 8 caracteres;
- 1 letra;
- 1 numero.

A politica e validada no backend e indicada visualmente no frontend.

## Mostrar/ocultar senha

Campos de senha agora possuem botao de olho em:

- Login;
- cadastro de novo usuario;
- reset de senha pelo ADMIN;
- alteracao da propria senha;
- alteracao obrigatoria de senha.

## Auditoria

Eventos registrados:

- `CREATE_USER`;
- `CHANGE_PASSWORD`;
- `RESET_PASSWORD`;
- `APPLY_TEMPORARY_PASSWORD`;
- `UPDATE_PERMISSIONS`;
- `REACTIVATE`;
- `INACTIVATE`;
- `LOGIN`;
- `LOGIN_INVALID`;
- `LOGIN_BLOCKED`.

## Bloqueio automatico

Regra:

- 5 tentativas invalidas;
- bloqueio por 15 minutos;
- tentativa seguinte retorna HTTP `423`;
- registra IP, usuario informado e data/hora em `AuditLog`.

## Migration

```txt
backend/prisma/migrations/20260529123000_password_policy_lockout/migration.sql
```

Campos adicionados em `User`:

- `passwordChangedAt`;
- `failedLoginAttempts`;
- `lockedUntil`.

## Validacao executada

Fluxo testado via API em backend temporario na porta `3334`:

1. Criar usuario.
2. Login com senha inicial.
3. Resetar senha como temporaria.
4. Login com senha temporaria.
5. Confirmar `mustChangePassword = true`.
6. Alterar senha.
7. Login com senha definitiva.
8. Login invalido retorna `401`.
9. Apos 5 tentativas invalidas, login retorna `423`.
10. AuditLog populado.
