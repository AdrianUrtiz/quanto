-- AlterTable
ALTER TABLE "TransactionShare" ADD COLUMN     "seatId" TEXT,
ALTER COLUMN "debtorId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "TransactionShare_seatId_idx" ON "TransactionShare"("seatId");

-- AddForeignKey
ALTER TABLE "TransactionShare" ADD CONSTRAINT "TransactionShare_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
