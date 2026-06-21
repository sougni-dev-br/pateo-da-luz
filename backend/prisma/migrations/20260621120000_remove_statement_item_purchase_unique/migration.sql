-- Remove unique constraint que impede 1 compra ter múltiplos itens em faturas (parcelamento CC)
DROP INDEX IF EXISTS "CreditCardStatementItem_purchaseId_key";
