-- Painel de Eventos: séries, edições e dias dos eventos que trazem gente ao restaurante,
-- uma linha por data com a decisão e o histórico do dia, e os limites da sugestão de buffet.

-- CreateEnum
CREATE TYPE "EventOrigin" AS ENUM ('CENTRO_CONVENCOES', 'TEATRO', 'GRUPO');

-- CreateEnum
CREATE TYPE "EventArea" AS ENUM ('SAUDE', 'CORPORATIVO', 'TECNOLOGIA', 'JURIDICO', 'FINANCEIRO', 'FEIRA_VAREJO', 'EDUCACAO', 'ENTRETENIMENTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('BUFFET', 'BUFFET_EXECUTIVO', 'A_LA_CARTE');

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "aliasKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin" "EventOrigin" NOT NULL DEFAULT 'CENTRO_CONVENCOES',
    "area" "EventArea" NOT NULL DEFAULT 'OUTRO',
    "organizer" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEdition" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "announcedAudience" INTEGER,
    "floor" TEXT,
    "contact" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEditionDay" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "lunchInside" BOOLEAN,

    CONSTRAINT "EventEditionDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "serviceMode" "ServiceMode",
    "buffetPrice" DECIMAL(10,2),
    "forecastLunch" INTEGER,
    "forecastSize" "EventSize",
    "forecastBasis" TEXT,
    "legacyLunchPeople" INTEGER,
    "legacyLunchSales" DECIMAL(14,2),
    "legacyDinnerPeople" INTEGER,
    "legacyDinnerSales" DECIMAL(14,2),
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "smallMaxLunch" INTEGER NOT NULL DEFAULT 80,
    "largeMinLunch" INTEGER NOT NULL DEFAULT 150,
    "lunchCapacity" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventSeries_nameKey_key" ON "EventSeries"("nameKey");

-- CreateIndex
CREATE INDEX "EventEdition_startDate_idx" ON "EventEdition"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "EventEdition_seriesId_startDate_key" ON "EventEdition"("seriesId", "startDate");

-- CreateIndex
CREATE INDEX "EventEditionDay_date_idx" ON "EventEditionDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "EventEditionDay_editionId_date_key" ON "EventEditionDay"("editionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OperationDay_date_key" ON "OperationDay"("date");

-- AddForeignKey
ALTER TABLE "EventEdition" ADD CONSTRAINT "EventEdition_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventEditionDay" ADD CONSTRAINT "EventEditionDay_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "EventEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Limites aceitos em 30/09/2026: Pequeno até 80 almoços, Grande acima de 150.
INSERT INTO "EventSettings" ("id", "smallMaxLunch", "largeMinLunch", "updatedAt") VALUES ('singleton', 80, 150, CURRENT_TIMESTAMP);
