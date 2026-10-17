-- Férias: registro de que a pessoa foi avisada por escrito das datas (30 dias antes, CLT art. 135).
ALTER TABLE "FeriasProgramacao" ADD COLUMN "avisadoEm" TIMESTAMP(3), ADD COLUMN "avisadoPorId" TEXT;
