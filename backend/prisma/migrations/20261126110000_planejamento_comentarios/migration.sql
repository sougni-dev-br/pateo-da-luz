-- Comentários explicativos do Comparativo do Planejamento (um por ponto: ano comparado + mês + métrica + turno).
CREATE TABLE "PlanejamentoComentario" (
    "id" TEXT NOT NULL,
    "contexto" TEXT NOT NULL DEFAULT 'COMPARATIVO',
    "anoBase" INTEGER NOT NULL,
    "anoComparado" INTEGER NOT NULL,
    "mes" INTEGER,
    "metrica" TEXT NOT NULL,
    "turno" TEXT NOT NULL DEFAULT 'TOTAL',
    "texto" TEXT NOT NULL,
    "naImpressao" BOOLEAN NOT NULL DEFAULT true,
    "autorId" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "editadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanejamentoComentario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanejamentoComentario_ponto_idx" ON "PlanejamentoComentario"("anoComparado", "mes", "metrica", "turno", "createdAt");

-- Restrições que garantem no banco o que o zod valida na rota.
ALTER TABLE "PlanejamentoComentario"
  ADD CONSTRAINT "PlanejamentoComentario_contexto_check" CHECK ("contexto" IN ('COMPARATIVO')),
  ADD CONSTRAINT "PlanejamentoComentario_mes_check" CHECK ("mes" IS NULL OR "mes" BETWEEN 1 AND 12),
  ADD CONSTRAINT "PlanejamentoComentario_metrica_check" CHECK ("metrica" IN ('VENDAS', 'CLIENTES', 'TICKET')),
  ADD CONSTRAINT "PlanejamentoComentario_turno_check" CHECK ("turno" IN ('TOTAL', 'ALMOCO', 'JANTAR')),
  ADD CONSTRAINT "PlanejamentoComentario_anos_check"
    CHECK ("anoBase" <> "anoComparado" AND "anoBase" BETWEEN 2020 AND 2100 AND "anoComparado" BETWEEN 2020 AND 2100),
  ADD CONSTRAINT "PlanejamentoComentario_texto_check" CHECK (char_length(btrim("texto")) BETWEEN 1 AND 1000);
