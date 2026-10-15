-- Requisição em andamento salva no sistema: qualquer aparelho e qualquer pessoa com acesso a Requisições
-- abre, edita e conclui. O estoque só baixa ao concluir (registrar); até lá é só este rascunho.
CREATE TABLE "InventoryRequisitionDraft" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryRequisitionDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryRequisitionDraft_updatedAt_idx" ON "InventoryRequisitionDraft"("updatedAt");
