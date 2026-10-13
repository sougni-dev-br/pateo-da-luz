-- Heartbeat do agente do Agile PDV: uma linha por maquina, atualizada a cada execucao.
-- CreateTable
CREATE TABLE "AgileAgentHeartbeat" (
    "id" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL DEFAULT 'AGILE_PDV',
    "agenteHost" TEXT NOT NULL,
    "agenteVersion" TEXT,
    "ultimoStatus" TEXT NOT NULL,
    "ultimaMensagem" TEXT,
    "ultimoHeartbeatEm" TIMESTAMP(3) NOT NULL,
    "ultimoOkEm" TIMESTAMP(3),
    "ultimoOkOcorridoEm" TIMESTAMP(3),
    "ultimoOkBatchId" TEXT,
    "ultimoOkPeriodoFim" TEXT,
    "alertaNivel" TEXT,
    "alertaNotificadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileAgentHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgileAgentHeartbeat_sourcePlatform_agenteHost_key" ON "AgileAgentHeartbeat"("sourcePlatform", "agenteHost");
