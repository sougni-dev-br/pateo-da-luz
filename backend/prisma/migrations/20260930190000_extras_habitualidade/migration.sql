-- Extras, Fase 3: limites do aviso de habitualidade de pessoa de fora.
ALTER TABLE "PayrollSettings"
  ADD COLUMN "extraHabitualSemana" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "extraHabitual30Dias" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "extraHabitualSemanas" INTEGER NOT NULL DEFAULT 4;
