-- Abono parcial de horas num dia com batidas (atestado de horas, médico do trabalho etc.).
ALTER TABLE "PontoDia" ADD COLUMN "abonoMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PontoDia" ADD COLUMN "abonoMotivo" TEXT;
