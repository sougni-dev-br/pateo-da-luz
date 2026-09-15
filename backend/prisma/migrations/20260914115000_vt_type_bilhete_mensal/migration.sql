-- Novo valor do enum VtType em migration separada: o Postgres proibe USAR um
-- valor de enum recem-criado na MESMA transacao em que ele foi adicionado, e o
-- Prisma roda cada migration dentro de uma transacao. Separar e o que permite o
-- UPDATE para BILHETE_MENSAL na migration seguinte.
ALTER TYPE "VtType" ADD VALUE IF NOT EXISTS 'BILHETE_MENSAL';
