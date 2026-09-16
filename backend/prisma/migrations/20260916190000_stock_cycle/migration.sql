-- Ciclo operacional de estoque: o intervalo real entre duas contagens de
-- fechamento.
--
-- O restaurante nao fecha o CMV por competencia estrita. O ciclo termina no dia
-- em que se conta o estoque, e esse dia cai no mes seguinte sempre que o ultimo
-- dia do mes esta ocupado: agosto/2026 fechou em 02/09 (evento no dia 31) e
-- maio/2026 em 01/06. Ate aqui o ciclo era implicito — um par de campos
-- (periodYear/periodMonth) nas contagens, sem comeco nem fim declarados. Sem o
-- intervalo nao da para somar "as compras do ciclo", so as da competencia, e por
-- isso nenhum relatorio conseguia oferecer as duas visoes.
--
-- Os ciclos nao se sobrepoem e nao deixam buraco: cada um comeca no dia seguinte
-- ao fim do anterior. A unicidade por competencia garante um ciclo por mes.
--
-- Tabela nova e sem escrita de dados aqui: nada existente e alterado, e o
-- backfill a partir do historico roda depois, por rota propria.
CREATE TABLE "StockCycle" (
    "id" TEXT NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "closingSnapshotId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SISTEMA',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockCycle_competenceYear_competenceMonth_key" ON "StockCycle"("competenceYear", "competenceMonth");
CREATE INDEX "StockCycle_startDate_endDate_idx" ON "StockCycle"("startDate", "endDate");
CREATE INDEX "StockCycle_status_idx" ON "StockCycle"("status");
CREATE INDEX "StockCycle_closingSnapshotId_idx" ON "StockCycle"("closingSnapshotId");
