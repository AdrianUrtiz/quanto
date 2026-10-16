-- Si quien pagó también consume su parte (default true = comportamiento previo).
-- AlterTable
ALTER TABLE "GroupExpenseClaim" ADD COLUMN     "payerInSplit" BOOLEAN NOT NULL DEFAULT true;
