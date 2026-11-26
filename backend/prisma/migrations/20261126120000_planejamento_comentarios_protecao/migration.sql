-- Comentários do Comparativo: lixeira (apagar só marca), e o número do ponto no momento em que o comentário foi escrito.
ALTER TABLE "PlanejamentoComentario"
  ADD COLUMN "apagadoEm" TIMESTAMP(3),
  ADD COLUMN "apagadoPorId" TEXT,
  ADD COLUMN "apagadoPorNome" TEXT,
  ADD COLUMN "valorBase" DECIMAL(14,4),
  ADD COLUMN "valorComparado" DECIMAL(14,4),
  ADD COLUMN "variacao" DECIMAL(10,6);

-- Apagado é tudo ou nada: quando, quem (id) e quem (nome) andam juntos.
ALTER TABLE "PlanejamentoComentario"
  ADD CONSTRAINT "PlanejamentoComentario_apagado_check" CHECK (
    ("apagadoEm" IS NULL AND "apagadoPorId" IS NULL AND "apagadoPorNome" IS NULL)
    OR ("apagadoEm" IS NOT NULL AND "apagadoPorId" IS NOT NULL AND "apagadoPorNome" IS NOT NULL)
  );

-- O caso comum (tela, impressão e limites) só lê os não apagados: o índice do ponto passa a ser parcial.
-- Declarado só aqui (o Prisma 5 não descreve índice parcial), como o RevenueEntry_date_idx.
DROP INDEX IF EXISTS "PlanejamentoComentario_ponto_idx";
CREATE INDEX "PlanejamentoComentario_ponto_vivo_idx"
  ON "PlanejamentoComentario"("anoComparado", "mes", "metrica", "turno", "createdAt")
  WHERE "apagadoEm" IS NULL;
