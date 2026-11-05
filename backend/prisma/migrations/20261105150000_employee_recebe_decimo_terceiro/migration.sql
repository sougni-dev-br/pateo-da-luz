-- Chave "Recebe 13º" no cadastro do funcionário (padrão: recebe).
ALTER TABLE "Employee" ADD COLUMN "recebeDecimoTerceiro" BOOLEAN NOT NULL DEFAULT true;
