-- Vales: número do recibo, registro da impressão e descrições prontas.
ALTER TABLE "TipVale" ADD COLUMN "codigo" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "reciboEmpresaId" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "reciboImpressoEm" TIMESTAMP(3);
ALTER TABLE "TipVale" ADD COLUMN "reciboImpressoPor" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "reciboImpressoes" INTEGER NOT NULL DEFAULT 0;

-- Numera os vales que já existem: VALE-<ano do lançamento>-NNNNN, pela ordem de lançamento.
UPDATE "TipVale" v SET "codigo" = n."codigo"
FROM (
  SELECT "id", 'VALE-' || EXTRACT(YEAR FROM "createdAt")::int || '-' ||
         LPAD(ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM "createdAt") ORDER BY "createdAt", "id")::text, 5, '0') AS "codigo"
  FROM "TipVale"
) n
WHERE v."id" = n."id";
CREATE UNIQUE INDEX "TipVale_codigo_key" ON "TipVale"("codigo");

CREATE TABLE "TipValeDescricao" (
  "id" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "tipo" "TipValeType",
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipValeDescricao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TipValeDescricao_texto_tipo_key" ON "TipValeDescricao"("texto", "tipo");

-- Descrições iniciais (dá para desativar e cadastrar outras na aba Vales).
INSERT INTO "TipValeDescricao" ("id", "texto", "tipo", "ordem", "createdById") VALUES
  ('valdesc-01', 'Adiantamento de gorjeta', 'ADIANTAMENTO', 1, 'sistema'),
  ('valdesc-02', 'Adiantamento de quinzena', 'ADIANTAMENTO', 2, 'sistema'),
  ('valdesc-03', 'Adiantamento emergencial', 'ADIANTAMENTO', 3, 'sistema'),
  ('valdesc-04', 'Refeição fora do horário da equipe', 'REFEICAO', 1, 'sistema'),
  ('valdesc-05', 'Refeição para levar', 'REFEICAO', 2, 'sistema'),
  ('valdesc-06', 'Consumo no restaurante', 'VALE_CONSUMO', 1, 'sistema'),
  ('valdesc-07', 'Bebidas', 'VALE_CONSUMO', 2, 'sistema'),
  ('valdesc-08', 'Produtos do restaurante', 'VALE_CONSUMO', 3, 'sistema'),
  ('valdesc-09', 'Retirada de caixa para despesa pessoal', 'RETIRADA_CAIXA', 1, 'sistema'),
  ('valdesc-10', 'Uniforme', 'OUTRO', 1, 'sistema'),
  ('valdesc-11', 'Quebra ou avaria', 'OUTRO', 2, 'sistema'),
  ('valdesc-12', 'Diferença de caixa', 'OUTRO', 3, 'sistema'),
  ('valdesc-13', 'Devolução de desconto indevido', 'CREDITO', 1, 'sistema')
ON CONFLICT DO NOTHING;
