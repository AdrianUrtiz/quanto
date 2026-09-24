-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "shareAmount",
DROP COLUMN "sharePct",
ADD COLUMN     "ownerPart" DECIMAL(12,2),
ADD COLUMN     "partnerPart" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "transactionId" TEXT,
    "ownerPaid" BOOLEAN NOT NULL DEFAULT false,
    "partnerPaid" BOOLEAN NOT NULL DEFAULT false,
    "ownerPaidById" TEXT,
    "partnerPaidById" TEXT,
    "ownerPaidAt" TIMESTAMP(3),
    "partnerPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_transactionId_key" ON "SubscriptionCharge"("transactionId");

-- CreateIndex
CREATE INDEX "SubscriptionCharge_subscriptionId_idx" ON "SubscriptionCharge"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_subscriptionId_month_key" ON "SubscriptionCharge"("subscriptionId", "month");

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_ownerPaidById_fkey" FOREIGN KEY ("ownerPaidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_partnerPaidById_fkey" FOREIGN KEY ("partnerPaidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
