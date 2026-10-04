-- Cada impressão de plaquinhas anota os pratos do dia: é o que alimenta o acompanhamento
-- de pratos mais feitos, repetidos e esquecidos.

CREATE TABLE "BuffetPlatePrint" (
    "id" TEXT NOT NULL,
    "servedOn" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BUFFET',
    "listId" TEXT,
    "listName" TEXT,
    "itemIds" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuffetPlatePrint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuffetPlatePrint_kind_servedOn_idx" ON "BuffetPlatePrint"("kind", "servedOn");
