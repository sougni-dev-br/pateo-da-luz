-- Conferência da ficha técnica pela cozinha: nula = ainda não conferida. Todas as fichas existentes começam assim.
ALTER TABLE "Dish" ADD COLUMN "fichaConferidaEm" TIMESTAMP(3);
ALTER TABLE "Dish" ADD COLUMN "fichaConferidaPorId" TEXT;
