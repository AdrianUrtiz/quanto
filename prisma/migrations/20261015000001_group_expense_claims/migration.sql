-- Reclamos de gasto grupal: registrado por un miembro, lo confirma el
-- pagador eligiendo su cuenta (ahí nace el movimiento real).
-- CreateTable
CREATE TABLE "GroupExpenseClaim" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTRO',
    "date" TIMESTAMP(3) NOT NULL,
    "payerSeatId" TEXT NOT NULL,
    "registeredById" TEXT NOT NULL,
    "splits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupExpenseClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupExpenseClaim_householdId_idx" ON "GroupExpenseClaim"("householdId");

-- AddForeignKey
ALTER TABLE "GroupExpenseClaim" ADD CONSTRAINT "GroupExpenseClaim_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupExpenseClaim" ADD CONSTRAINT "GroupExpenseClaim_payerSeatId_fkey" FOREIGN KEY ("payerSeatId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupExpenseClaim" ADD CONSTRAINT "GroupExpenseClaim_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
