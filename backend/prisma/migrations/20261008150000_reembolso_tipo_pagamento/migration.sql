-- Tipo de forma de pagamento para compra paga do bolso de um funcionario.
-- Migration separada da que usa o valor: o Postgres nao deixa usar um valor de
-- enum na mesma transacao em que ele foi criado.
ALTER TYPE "PaymentMethodType" ADD VALUE IF NOT EXISTS 'REIMBURSEMENT';
