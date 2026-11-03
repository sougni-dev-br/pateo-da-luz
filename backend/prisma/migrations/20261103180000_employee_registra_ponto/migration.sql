-- Quem não bate ponto fica fora da apuração do Ponto (padrão: bate).
ALTER TABLE "Employee" ADD COLUMN "registraPonto" BOOLEAN NOT NULL DEFAULT true;
