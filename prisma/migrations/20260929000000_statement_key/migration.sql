-- Add statementKey to Transaction (pago aplicado a un período aunque sea extemporáneo)
ALTER TABLE "Transaction" ADD COLUMN "statementKey" TEXT;
CREATE INDEX "Transaction_statementKey_idx" ON "Transaction"("statementKey");
