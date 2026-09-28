-- Gorjeta: método da planilha de apuração (set/2026).
-- Funções com pontos-base, pontos fracionados, fator de presença, rescisão com
-- serviço parcial, reserva da casa e lista de pagamento dos sem registro.

ALTER TYPE "TipValeType" ADD VALUE IF NOT EXISTS 'CREDITO';

CREATE TABLE "TipFunction" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "points"    DECIMAL(6,2) NOT NULL,
  "minPoints" DECIMAL(6,2),
  "maxPoints" DECIMAL(6,2),
  "group"     TEXT,
  "notes"     TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipFunction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TipFunction_name_key" ON "TipFunction"("name");

-- Tabela "Regras e Pontos" da planilha de 28/09/2026.
INSERT INTO "TipFunction" ("id","name","points","minPoints","maxPoints","group","notes","sortOrder") VALUES
 ('tipfn-01','Gerente Geral com acúmulo',15,12,20,'Gerência','Administrativo + operação geral.',1),
 ('tipfn-02','Gerente administrativo',10,8,15,'Gerência','Gestão administrativa sem operação integral.',2),
 ('tipfn-03','Gerência operacional',8,7,10,'Gerência','Responsável pela operação da casa.',3),
 ('tipfn-04','Liderança / subgerência',6,5,7,'Liderança','Apoio direto à gerência / responsabilidade ampliada.',4),
 ('tipfn-05','Líder de setor',5,4.5,6,'Liderança','Coordenação de setor/equipe.',5),
 ('tipfn-06','Cozinha manhã',4,3.5,5,'Operação','Cozinha qualificada.',6),
 ('tipfn-07','Cozinha manhã - Líder',5,3.5,6,'Operação','Cozinha qualificada.',7),
 ('tipfn-08','Cozinha tarde - Nível 1',3,3,5,'Operação','Cozinha qualificada.',8),
 ('tipfn-09','Cozinha tarde - Nível 2',2,2,4,'Operação','Cozinha qualificada.',9),
 ('tipfn-10','Pizzaiolo',3.5,3.5,5,'Operação','Função qualificada.',10),
 ('tipfn-11','Bar',2,2,5,'Operação','Atendimento/bar.',11),
 ('tipfn-12','Adm',4,3.5,5,'Administrativo','Apoio administrativo sem função gerencial.',12),
 ('tipfn-13','Atendimento - Líder',4,3.5,5,'Operação','Salão e atendimento ao cliente.',13),
 ('tipfn-14','Atendimento',3.5,2.5,5,'Operação','Salão e atendimento ao cliente.',14),
 ('tipfn-15','Apoio operacional',2.5,2.5,4,'Operação','Auxiliar, delivery e apoio.',15),
 ('tipfn-16','Pia 1',2.5,2.5,3.5,'Operação','Pia / higienização.',16),
 ('tipfn-17','Pia 2',2,2,3,'Operação','Pia / higienização.',17),
 ('tipfn-18','Treinamento / entrada',1.5,1.5,3,'Entrada','Uso temporário quando a gestão desejar.',18);

-- Funcionário
ALTER TABLE "Employee" ALTER COLUMN "pontosPadrao" TYPE DECIMAL(6,2);
ALTER TABLE "Employee" ADD COLUMN "tipFunctionId" TEXT;
ALTER TABLE "Employee" ADD COLUMN "gorjetaReserva" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tipFunctionId_fkey"
  FOREIGN KEY ("tipFunctionId") REFERENCES "TipFunction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Período
ALTER TABLE "TipPeriod" ADD COLUMN "diasPadrao" INTEGER NOT NULL DEFAULT 26;
ALTER TABLE "TipPeriod" ADD COLUMN "descontaFalta" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TipPeriod" ADD COLUMN "descontaAtestado" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TipPeriod" ADD COLUMN "descontaFerias" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TipPeriod" ADD COLUMN "descontaOutros" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipPeriod" ADD COLUMN "saldoRetido" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Participante. Os pontos que já existiam viram os pontos-base, sem ajuste:
-- o rateio dos períodos antigos continua o mesmo.
ALTER TABLE "TipParticipant" ALTER COLUMN "points" TYPE DECIMAL(8,2);
ALTER TABLE "TipParticipant" ADD COLUMN "basePoints" DECIMAL(8,2);
ALTER TABLE "TipParticipant" ADD COLUMN "pointsAdjustment" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "TipParticipant" ADD COLUMN "atestados" INTEGER;
ALTER TABLE "TipParticipant" ADD COLUMN "ferias" INTEGER;
ALTER TABLE "TipParticipant" ADD COLUMN "outrosDias" INTEGER;
ALTER TABLE "TipParticipant" ADD COLUMN "diasPrevistosOverride" INTEGER;
ALTER TABLE "TipParticipant" ADD COLUMN "rescisaoServicoBruto" DECIMAL(14,2);
ALTER TABLE "TipParticipant" ADD COLUMN "rescisaoValorFixo" DECIMAL(14,2);
ALTER TABLE "TipParticipant" ADD COLUMN "diasSalarioOverride" INTEGER;
ALTER TABLE "TipParticipant" ADD COLUMN "salarioProporcional" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "TipParticipant" ADD COLUMN "totalAPagar" DECIMAL(14,2) NOT NULL DEFAULT 0;
UPDATE "TipParticipant" SET "basePoints" = "points" WHERE "points" IS NOT NULL;
