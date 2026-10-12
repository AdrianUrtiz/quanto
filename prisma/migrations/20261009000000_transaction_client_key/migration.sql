-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_clientKey_key" ON "Transaction"("clientKey");
