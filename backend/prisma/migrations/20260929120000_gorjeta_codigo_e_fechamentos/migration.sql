-- Gorjeta: código automático da apuração (GOR-AAAA-NNNN), registro permanente
-- e imutável de cada fechamento, e saldo inicial do fundo de reserva.

-- 1) Código da apuração. Períodos existentes recebem código na ordem da competência.
ALTER TABLE "TipPeriod" ADD COLUMN "code" TEXT;
UPDATE "TipPeriod" tp SET "code" = c.codigo
FROM (
  SELECT "id",
         'GOR-' || "competenceYear" || '-' ||
         LPAD((ROW_NUMBER() OVER (PARTITION BY "competenceYear" ORDER BY "competenceMonth"))::text, 4, '0') AS codigo
  FROM "TipPeriod"
) c
WHERE c."id" = tp."id";
ALTER TABLE "TipPeriod" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "TipPeriod_code_key" ON "TipPeriod"("code");

-- 2) Registro de cada fechamento.
CREATE TABLE "TipPeriodClosing" (
  "id"              TEXT NOT NULL,
  "periodId"        TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "version"         INTEGER NOT NULL,
  "competenceYear"  INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "periodStart"     DATE NOT NULL,
  "periodEnd"       DATE NOT NULL,
  "closedAt"        TIMESTAMP(3) NOT NULL,
  "closedById"      TEXT NOT NULL,
  "closedByName"    TEXT NOT NULL,
  "params"          JSONB NOT NULL,
  "totals"          JSONB NOT NULL,
  "participants"    JSONB NOT NULL,
  "reserve"         JSONB NOT NULL,
  "payloadHash"     TEXT NOT NULL,
  "reopenedAt"      TIMESTAMP(3),
  "reopenedById"    TEXT,
  "reopenedByName"  TEXT,
  "reopenReason"    TEXT,
  CONSTRAINT "TipPeriodClosing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TipPeriodClosing_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TipPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TipPeriodClosing_code_key" ON "TipPeriodClosing"("code");
CREATE UNIQUE INDEX "TipPeriodClosing_periodId_version_key" ON "TipPeriodClosing"("periodId", "version");
CREATE INDEX "TipPeriodClosing_competenceYear_competenceMonth_idx" ON "TipPeriodClosing"("competenceYear", "competenceMonth");

-- 3) Imutável no próprio banco: não se apaga, e o conteúdo não muda. Só é
-- permitido gravar a reabertura uma única vez (de vazio para preenchido).
CREATE OR REPLACE FUNCTION "tip_fechamento_imutavel"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registro de fechamento da gorjeta (%) não pode ser apagado.', OLD."code";
  END IF;
  IF (NEW."id", NEW."periodId", NEW."code", NEW."version", NEW."competenceYear", NEW."competenceMonth",
      NEW."periodStart", NEW."periodEnd", NEW."closedAt", NEW."closedById", NEW."closedByName",
      NEW."params", NEW."totals", NEW."participants", NEW."reserve", NEW."payloadHash")
     IS DISTINCT FROM
     (OLD."id", OLD."periodId", OLD."code", OLD."version", OLD."competenceYear", OLD."competenceMonth",
      OLD."periodStart", OLD."periodEnd", OLD."closedAt", OLD."closedById", OLD."closedByName",
      OLD."params", OLD."totals", OLD."participants", OLD."reserve", OLD."payloadHash") THEN
    RAISE EXCEPTION 'Registro de fechamento da gorjeta (%) não pode ser alterado.', OLD."code";
  END IF;
  IF OLD."reopenedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Fechamento % já foi reaberto; a reabertura não pode ser reescrita.', OLD."code";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tip_fechamento_imutavel_trg"
BEFORE UPDATE OR DELETE ON "TipPeriodClosing"
FOR EACH ROW EXECUTE FUNCTION "tip_fechamento_imutavel"();

-- 4) Saldo inicial do fundo de reserva (definido pelo Eli em 29/09/2026):
-- reserva de agosto/2026, que estava com o cadastro "Ricardo Almeida" (25,96 pts).
INSERT INTO "TipReserveMovement" ("id", "date", "type", "amount", "notes", "createdById")
SELECT gen_random_uuid()::text, DATE '2026-08-25', 'AJUSTE', 6734.46,
       'Saldo inicial: reserva de agosto/2026 guardada no cadastro "Ricardo Almeida" (25,96 pontos)', 'sistema'
WHERE NOT EXISTS (
  SELECT 1 FROM "TipReserveMovement" WHERE "type" = 'AJUSTE' AND "notes" LIKE 'Saldo inicial: reserva de agosto/2026%'
);
