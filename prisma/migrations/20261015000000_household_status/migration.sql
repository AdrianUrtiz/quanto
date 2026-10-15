-- Estado de grupo: ACTIVE (default) o CLOSED (liquidado, sin movimientos).
-- CreateEnum
CREATE TYPE "HouseholdStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "status" "HouseholdStatus" NOT NULL DEFAULT 'ACTIVE';
