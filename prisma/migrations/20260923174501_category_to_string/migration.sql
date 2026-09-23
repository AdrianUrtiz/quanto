-- Enum Category -> TEXT preservando los valores existentes
ALTER TABLE "Transaction" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "Transaction" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "Transaction" ALTER COLUMN "category" SET DEFAULT 'OTRO';

-- DropEnum
DROP TYPE "Category";
