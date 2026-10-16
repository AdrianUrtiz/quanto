-- Gastos grupales: registro inmediato aunque pague otro integrante.
-- El pagador adjunta su cuenta después (movimiento personal vinculado).
-- Se elimina la tabla de reclamos pendientes (estaba vacía en producción).

-- AlterTable: la cuenta pasa a opcional (gasto registrado por otro aún sin cuenta indicada).
ALTER TABLE "Transaction" ADD COLUMN     "paidBySeatId" TEXT,
ADD COLUMN     "payerTransactionId" TEXT,
ALTER COLUMN "accountId" DROP NOT NULL;

-- Backfill: el pagador de los gastos existentes es quien los registró.
UPDATE "Transaction" t
SET "paidBySeatId" = m."id"
FROM "HouseholdMember" m
WHERE t."householdId" IS NOT NULL
  AND m."householdId" = t."householdId"
  AND m."userId" = t."createdById";

-- DropTable
DROP TABLE "GroupExpenseClaim";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_payerTransactionId_key" ON "Transaction"("payerTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_paidBySeatId_idx" ON "Transaction"("paidBySeatId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paidBySeatId_fkey" FOREIGN KEY ("paidBySeatId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payerTransactionId_fkey" FOREIGN KEY ("payerTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
