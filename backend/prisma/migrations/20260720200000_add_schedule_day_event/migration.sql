-- CreateEnum
CREATE TYPE "EventSize" AS ENUM ('PEQUENO', 'MEDIO', 'GRANDE');

-- CreateTable
CREATE TABLE "ScheduleDayEvent" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "size" "EventSize" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleDayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDayEvent_date_key" ON "ScheduleDayEvent"("date");
