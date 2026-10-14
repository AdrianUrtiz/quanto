-- Compartidos con personas sin cuenta (solo nombre, a modo de recordatorio).
-- AlterTable
ALTER TABLE "TransactionShare" ADD COLUMN     "externalName" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "externalName" TEXT;
