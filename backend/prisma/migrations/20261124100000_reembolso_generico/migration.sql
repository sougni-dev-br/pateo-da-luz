-- O reembolso deixou de ser so de funcionario: a forma de pagamento passa a se chamar
-- REEMBOLSO. O vinculo com o modulo e pelo tipo (REIMBURSEMENT), entao as compras ja
-- lancadas continuam ligadas. Se alguem ja criou "REEMBOLSO", nao mexe (evita colisao).
UPDATE "PaymentMethod"
SET "name" = 'REEMBOLSO',
    "normalizedName" = 'reembolso',
    "notes" = 'Compra paga do bolso de alguem de fora da empresa (funcionario, socio, terceiro). Entra no reembolso da pessoa; o titulo nasce ao fechar o reembolso.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "normalizedName" = 'reembolso funcionario'
  AND NOT EXISTS (SELECT 1 FROM "PaymentMethod" WHERE "normalizedName" = 'reembolso');
