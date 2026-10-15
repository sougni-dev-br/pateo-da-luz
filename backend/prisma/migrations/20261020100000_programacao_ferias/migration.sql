-- Programação de férias: o que a casa decidiu (quando sai, quantos dias, abono, se já gozou).
CREATE TABLE "FeriasProgramacao" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "aquisitivoInicio" DATE NOT NULL,
    "gozoInicio" DATE,
    "dias" INTEGER NOT NULL,
    "diasAbono" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROGRAMADA',
    "observacao" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeriasProgramacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeriasProgramacao_employeeId_aquisitivoInicio_idx" ON "FeriasProgramacao"("employeeId", "aquisitivoInicio");

ALTER TABLE "FeriasProgramacao" ADD CONSTRAINT "FeriasProgramacao_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeriasProgramacao" ADD CONSTRAINT "FeriasProgramacao_dias_valido" CHECK ("dias" BETWEEN 1 AND 30);
ALTER TABLE "FeriasProgramacao" ADD CONSTRAINT "FeriasProgramacao_abono_valido" CHECK ("diasAbono" BETWEEN 0 AND 10);
ALTER TABLE "FeriasProgramacao" ADD CONSTRAINT "FeriasProgramacao_status_valido" CHECK ("status" IN ('PROGRAMADA', 'GOZADA'));
