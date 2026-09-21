-- AlterTable
ALTER TABLE "Account" DROP COLUMN "depositFrequency",
DROP COLUMN "recurringDeposit";

-- DropEnum
DROP TYPE "DepositFrequency";

