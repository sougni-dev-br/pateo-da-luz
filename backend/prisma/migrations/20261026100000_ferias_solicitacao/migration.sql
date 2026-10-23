-- Férias: o que o colaborador pediu (início e dias) para cada período aquisitivo. A empresa decide pela
-- programação; o pedido fica ao lado para comparar. Um pedido por funcionário e período.
CREATE TABLE "FeriasSolicitacao" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "aquisitivoInicio" DATE NOT NULL,
    "inicio" DATE NOT NULL,
    "dias" INTEGER NOT NULL,
    "diasAbono" INTEGER NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeriasSolicitacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeriasSolicitacao_employeeId_aquisitivoInicio_key" ON "FeriasSolicitacao"("employeeId", "aquisitivoInicio");

ALTER TABLE "FeriasSolicitacao" ADD CONSTRAINT "FeriasSolicitacao_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeriasSolicitacao" ADD CONSTRAINT "FeriasSolicitacao_dias_valido" CHECK ("dias" BETWEEN 1 AND 30);
ALTER TABLE "FeriasSolicitacao" ADD CONSTRAINT "FeriasSolicitacao_abono_valido" CHECK ("diasAbono" BETWEEN 0 AND 10);
