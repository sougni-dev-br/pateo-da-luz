-- Histórico do cadastro de funcionários (salário, vínculo, empresa, cargo...) com vigência.
CREATE TABLE "EmployeeHistorico" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "vigenteDesde" DATE NOT NULL,
    "motivo" TEXT,
    "origem" TEXT NOT NULL,
    "origemRef" TEXT,
    "criadoPorId" TEXT,
    "criadoPorNome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeHistorico_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeHistorico_origemRef_campo_key" ON "EmployeeHistorico"("origemRef", "campo");
CREATE INDEX "EmployeeHistorico_employeeId_campo_vigenteDesde_idx" ON "EmployeeHistorico"("employeeId", "campo", "vigenteDesde");

ALTER TABLE "EmployeeHistorico" ADD CONSTRAINT "EmployeeHistorico_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
