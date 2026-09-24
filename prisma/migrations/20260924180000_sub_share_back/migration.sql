-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "ownerPart",
DROP COLUMN "partnerPart",
ADD COLUMN     "shareAmount" DECIMAL(12,2),
ADD COLUMN     "sharePct" DOUBLE PRECISION NOT NULL DEFAULT 50;
