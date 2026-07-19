-- CreateEnum
CREATE TYPE "ScheduleDayType" AS ENUM ('FOLGA', 'FERIAS', 'FALTA', 'ATESTADO');

-- CreateTable
CREATE TABLE "EmployeeScheduleDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "ScheduleDayType" NOT NULL DEFAULT 'FOLGA',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeScheduleDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeScheduleDay_date_idx" ON "EmployeeScheduleDay"("date");

-- CreateIndex
CREATE INDEX "EmployeeScheduleDay_employeeId_idx" ON "EmployeeScheduleDay"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeScheduleDay_employeeId_date_key" ON "EmployeeScheduleDay"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "EmployeeScheduleDay" ADD CONSTRAINT "EmployeeScheduleDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
