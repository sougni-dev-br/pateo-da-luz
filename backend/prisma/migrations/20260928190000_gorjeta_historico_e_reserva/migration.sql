-- Gorjeta: histórico de função/pontos e fundo de reserva.
-- A reserva deixa de ser um "funcionário" (Employee.gorjetaReserva) e vira um
-- campo do período (pontos da reserva) com extrato próprio.

-- Período: pontos da reserva
ALTER TABLE "TipPeriod" ADD COLUMN "reservaPontos" DECIMAL(8,2) NOT NULL DEFAULT 0;

-- Participante: função do período (retrato para relatórios)
ALTER TABLE "TipParticipant" ADD COLUMN "functionName" TEXT;

CREATE TABLE "EmployeeTipHistory" (
  "id"               TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  "validFrom"        DATE NOT NULL,
  "participaGorjeta" BOOLEAN NOT NULL,
  "tipFunctionId"    TEXT,
  "functionName"     TEXT,
  "functionPoints"   DECIMAL(6,2),
  "pontosPadrao"     DECIMAL(6,2),
  "basePoints"       DECIMAL(6,2),
  "reason"           TEXT,
  "changedById"      TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeTipHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeTipHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "EmployeeTipHistory_employeeId_validFrom_idx" ON "EmployeeTipHistory"("employeeId", "validFrom");
CREATE INDEX "EmployeeTipHistory_validFrom_idx" ON "EmployeeTipHistory"("validFrom");

CREATE TABLE "TipFunctionHistory" (
  "id"            TEXT NOT NULL,
  "tipFunctionId" TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "pointsBefore"  DECIMAL(6,2),
  "pointsAfter"   DECIMAL(6,2) NOT NULL,
  "minPoints"     DECIMAL(6,2),
  "maxPoints"     DECIMAL(6,2),
  "changedById"   TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipFunctionHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TipFunctionHistory_tipFunctionId_fkey" FOREIGN KEY ("tipFunctionId") REFERENCES "TipFunction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TipFunctionHistory_tipFunctionId_createdAt_idx" ON "TipFunctionHistory"("tipFunctionId", "createdAt");

CREATE TABLE "TipReserveMovement" (
  "id"          TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "type"        TEXT NOT NULL,
  "amount"      DECIMAL(14,2) NOT NULL,
  "periodId"    TEXT,
  "employeeId"  TEXT,
  "valeId"      TEXT,
  "notes"       TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipReserveMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TipReserveMovement_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TipPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TipReserveMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TipReserveMovement_valeId_fkey" FOREIGN KEY ("valeId") REFERENCES "TipVale"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TipReserveMovement_valeId_key" ON "TipReserveMovement"("valeId");
CREATE INDEX "TipReserveMovement_date_idx" ON "TipReserveMovement"("date");
CREATE INDEX "TipReserveMovement_periodId_idx" ON "TipReserveMovement"("periodId");

-- Quem era "reserva" vira pontos da reserva do período e sai da equipe.
UPDATE "TipPeriod" tp SET "reservaPontos" = r.pontos
FROM (
  SELECT p."periodId", SUM(COALESCE(p."basePoints", p."points", 0)) AS pontos
  FROM "TipParticipant" p JOIN "Employee" e ON e."id" = p."employeeId"
  WHERE e."gorjetaReserva" = true
  GROUP BY p."periodId"
) r
WHERE r."periodId" = tp."id";

DELETE FROM "TipParticipant" p USING "Employee" e
WHERE e."id" = p."employeeId" AND e."gorjetaReserva" = true;

UPDATE "Employee" SET "participaGorjeta" = false WHERE "gorjetaReserva" = true;

-- Retrato da função em cada participação existente.
UPDATE "TipParticipant" p SET "functionName" = f."name"
FROM "Employee" e JOIN "TipFunction" f ON f."id" = e."tipFunctionId"
WHERE e."id" = p."employeeId" AND p."functionName" IS NULL;

-- Situação inicial do histórico: uma linha por funcionário com função ou participação.
INSERT INTO "EmployeeTipHistory" ("id","employeeId","validFrom","participaGorjeta","tipFunctionId","functionName","functionPoints","pontosPadrao","basePoints","reason","changedById")
SELECT gen_random_uuid()::text, e."id", COALESCE(e."admissionDate"::date, CURRENT_DATE), e."participaGorjeta",
       e."tipFunctionId", f."name", f."points", e."pontosPadrao", COALESCE(e."pontosPadrao", f."points"),
       'Situação inicial (implantação do histórico)', 'sistema'
FROM "Employee" e LEFT JOIN "TipFunction" f ON f."id" = e."tipFunctionId"
WHERE e."deletedAt" IS NULL AND (e."participaGorjeta" = true OR e."tipFunctionId" IS NOT NULL);

ALTER TABLE "Employee" DROP COLUMN "gorjetaReserva";
