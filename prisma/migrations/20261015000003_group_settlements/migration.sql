-- Libro de liquidaciones neteadas entre seats de un grupo.
-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "GroupSettlement" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fromSeatId" TEXT NOT NULL,
    "toSeatId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "registeredById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "accountId" TEXT,
    "transactionId" TEXT,
    "debtorAccountId" TEXT,
    "debtorTransactionId" TEXT,
    "debtorConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupSettlement_transactionId_key" ON "GroupSettlement"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSettlement_debtorTransactionId_key" ON "GroupSettlement"("debtorTransactionId");

-- CreateIndex
CREATE INDEX "GroupSettlement_householdId_idx" ON "GroupSettlement"("householdId");

-- CreateIndex
CREATE INDEX "GroupSettlement_fromSeatId_idx" ON "GroupSettlement"("fromSeatId");

-- CreateIndex
CREATE INDEX "GroupSettlement_toSeatId_idx" ON "GroupSettlement"("toSeatId");

-- CreateIndex
CREATE INDEX "GroupSettlement_status_idx" ON "GroupSettlement"("status");

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_fromSeatId_fkey" FOREIGN KEY ("fromSeatId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_toSeatId_fkey" FOREIGN KEY ("toSeatId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_debtorAccountId_fkey" FOREIGN KEY ("debtorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_debtorTransactionId_fkey" FOREIGN KEY ("debtorTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
