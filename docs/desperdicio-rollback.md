# Desperdício: como desfazer

As duas migrations do módulo Desperdício (`20261014120000_desperdicio` e
`20261015120000_desperdicio_prato_pronto`) **não têm volta automática**: o Prisma só aplica para a
frente. Este roteiro serve para o caso de o deploy falhar ou de ser revertido.

## Antes do deploy

1. Tire um dump do banco (ponto de restauração). Ver `ROLLBACK.md`.
2. Reverter **só o código** é seguro: o código antigo ignora as tabelas novas.
   Reverter **só o banco** não é: o código novo quebra sem elas.

## Reverter antes de qualquer uso real (tabelas sem dados que importem)

Em ordem, numa transação:

```sql
BEGIN;
DROP TABLE "WasteEntryPhoto";
DROP TABLE "WasteSettings";
DROP TABLE "WasteEntry";
DROP TYPE "WasteReason";
DELETE FROM "RoleMenuPermission" WHERE "menuId" = 'inventory-waste';
DELETE FROM "_prisma_migrations"
 WHERE "migration_name" IN ('20261014120000_desperdicio', '20261015120000_desperdicio_prato_pronto');
COMMIT;
```

Atenção: o `DELETE FROM "RoleMenuPermission"` também apaga ajustes que o admin tenha feito nas
permissões do módulo depois do deploy. Permissões por usuário (`UserMenuPermission`) com
`menuId = 'inventory-waste'` também devem sair:

```sql
DELETE FROM "UserMenuPermission" WHERE "menuId" = 'inventory-waste';
```

## Reverter só a segunda migration (prato pronto) depois de haver lançamentos

Não dá para voltar `productId` para `NOT NULL` com lançamentos de prato. Guarde-os antes:

```sql
\copy (SELECT * FROM "WasteEntry" WHERE "dishId" IS NOT NULL) TO 'desperdicio_pratos.csv' CSV HEADER
```

Depois, em transação:

```sql
BEGIN;
DELETE FROM "WasteEntryPhoto" WHERE "entryId" IN (SELECT id FROM "WasteEntry" WHERE "dishId" IS NOT NULL);
DELETE FROM "WasteEntry" WHERE "dishId" IS NOT NULL;
ALTER TABLE "WasteEntry" DROP CONSTRAINT "WasteEntry_product_xor_dish";
ALTER TABLE "WasteEntry" DROP COLUMN "dishId";            -- leva junto a FK e o índice
ALTER TABLE "WasteEntry" ALTER COLUMN "productId" SET NOT NULL;
DROP TABLE "WasteEntryPhoto";
DROP TABLE "WasteSettings";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261015120000_desperdicio_prato_pronto';
COMMIT;
```

## Depois

- Confirme com `prisma migrate status` que o estado do banco bate com as migrations do código que
  ficou no ar.
- O desperdício não escreve em estoque, DRE nem CMV: desfazer o módulo **não altera nenhum número
  contábil**. A conferência do inventário volta a não mostrar a linha "Desperdício".
