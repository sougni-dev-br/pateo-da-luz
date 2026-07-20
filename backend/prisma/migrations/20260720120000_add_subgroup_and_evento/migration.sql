-- AlterEnum
ALTER TYPE "ScheduleDayType" ADD VALUE 'EVENTO';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "subgroup" TEXT;
