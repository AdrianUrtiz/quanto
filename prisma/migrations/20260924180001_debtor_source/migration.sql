-- AlterTable
ALTER TABLE "DebtPayment" ADD COLUMN     "debtorAccountId" TEXT,
ADD COLUMN     "debtorConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "debtorTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DebtPayment_debtorTransactionId_key" ON "DebtPayment"("debtorTransactionId");

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtorAccountId_fkey" FOREIGN KEY ("debtorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtorTransactionId_fkey" FOREIGN KEY ("debtorTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
