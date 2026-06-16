-- CreateTable
CREATE TABLE "DRECategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dreGroup" TEXT NOT NULL DEFAULT 'DESPESAS_OPERACIONAIS',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DRECategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DRECategory_name_key" ON "DRECategory"("name");
CREATE INDEX "DRECategory_dreGroup_idx" ON "DRECategory"("dreGroup");
CREATE INDEX "DRECategory_sortOrder_idx" ON "DRECategory"("sortOrder");
CREATE INDEX "DRECategory_isActive_idx" ON "DRECategory"("isActive");

-- Seed default categories
INSERT INTO "DRECategory" ("id", "name", "dreGroup", "sortOrder", "isActive", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Custo de Alimentos',      'DESPESAS_OPERACIONAIS', 1,  true, NOW()),
  (gen_random_uuid()::text, 'Embalagens',              'DESPESAS_OPERACIONAIS', 2,  true, NOW()),
  (gen_random_uuid()::text, 'Limpeza e Higiene',       'DESPESAS_OPERACIONAIS', 3,  true, NOW()),
  (gen_random_uuid()::text, 'Folha de Pessoal',        'DESPESAS_OPERACIONAIS', 4,  true, NOW()),
  (gen_random_uuid()::text, 'Aluguel e Condominio',    'DESPESAS_OPERACIONAIS', 5,  true, NOW()),
  (gen_random_uuid()::text, 'Servicos e Utilities',    'DESPESAS_OPERACIONAIS', 6,  true, NOW()),
  (gen_random_uuid()::text, 'Marketing e Delivery',    'DESPESAS_OPERACIONAIS', 7,  true, NOW()),
  (gen_random_uuid()::text, 'Administrativo',          'DESPESAS_OPERACIONAIS', 8,  true, NOW()),
  (gen_random_uuid()::text, 'Outros',                  'DESPESAS_OPERACIONAIS', 9,  true, NOW());
