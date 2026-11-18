-- Pesagem do buffet: panelas com peso vazio (tara) e pesagens de produção/sobra por prato.

CREATE TABLE "BuffetPot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "tareG" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuffetPot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BuffetPot_tare_positive" CHECK ("tareG" > 0)
);

CREATE UNIQUE INDEX "BuffetPot_code_key" ON "BuffetPot"("code");

CREATE TABLE "BuffetWeighing" (
    "id" TEXT NOT NULL,
    "servedOn" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BUFFET',
    "itemId" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'PRODUCAO',
    "grossG" INTEGER NOT NULL,
    "tareG" INTEGER NOT NULL,
    "netG" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuffetWeighing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BuffetWeighing_net_check" CHECK ("netG" = "grossG" - "tareG" AND "netG" >= 0)
);

CREATE INDEX "BuffetWeighing_servedOn_kind_idx" ON "BuffetWeighing"("servedOn", "kind");
CREATE INDEX "BuffetWeighing_itemId_servedOn_idx" ON "BuffetWeighing"("itemId", "servedOn");
CREATE INDEX "BuffetWeighing_potId_idx" ON "BuffetWeighing"("potId");

ALTER TABLE "BuffetWeighing" ADD CONSTRAINT "BuffetWeighing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BuffetPlateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuffetWeighing" ADD CONSTRAINT "BuffetWeighing_potId_fkey" FOREIGN KEY ("potId") REFERENCES "BuffetPot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
