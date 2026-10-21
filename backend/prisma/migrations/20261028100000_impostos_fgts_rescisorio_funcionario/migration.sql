-- Guia de FGTS de rescisão: fica atrelada ao funcionário desligado (opcional).
ALTER TABLE "TaxPayment" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "TaxPayment" ADD CONSTRAINT "TaxPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "TaxPayment_employeeId_idx" ON "TaxPayment"("employeeId");
