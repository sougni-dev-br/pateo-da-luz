-- Desconto de VT por falta.
--
-- O VT é pago antes da quinzena acontecer, então uma falta num dia já pago só
-- pode ser acertada no vale seguinte. Esta tabela registra cada acerto.
--
-- A chave única (employeeId, date) é o que garante, no banco, que uma falta é
-- descontada UMA vez só — reprocessar a folha não pode cobrar de novo o mesmo
-- dia. O ON DELETE CASCADE no payrollItemId faz o caminho inverso: apagar o
-- lançamento de VT devolve as faltas para a fila de pendentes.

CREATE TABLE "VtFaltaDeduction" (
  "id"            TEXT NOT NULL,
  "employeeId"    TEXT NOT NULL,
  "date"          DATE NOT NULL,
  -- FALTA ou ATESTADO: os dois recuperam o vale já pago (a pessoa não viajou),
  -- mas o comprovante precisa dizer qual, sem obrigar a voltar na escala.
  "dayType"       "ScheduleDayType" NOT NULL DEFAULT 'FALTA',
  "amount"        DECIMAL(12,2) NOT NULL,
  "payrollItemId" TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VtFaltaDeduction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VtFaltaDeduction_employeeId_date_key" ON "VtFaltaDeduction"("employeeId", "date");
CREATE INDEX "VtFaltaDeduction_payrollItemId_idx" ON "VtFaltaDeduction"("payrollItemId");

ALTER TABLE "VtFaltaDeduction" ADD CONSTRAINT "VtFaltaDeduction_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VtFaltaDeduction" ADD CONSTRAINT "VtFaltaDeduction_payrollItemId_fkey"
  FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
