-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER');

-- CreateEnum
CREATE TYPE "DepositFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('COMIDA', 'TRANSPORTE', 'VIVIENDA', 'SERVICIOS', 'SALUD', 'OCIO', 'COMPRAS', 'EDUCACION', 'VIAJES', 'MASCOTAS', 'SUSCRIPCIONES', 'NOMINA', 'OTRO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "userId" TEXT NOT NULL,
    "lastFour" TEXT,
    "color" TEXT DEFAULT '#6366f1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "initialBalance" DECIMAL(12,2),
    "recurringDeposit" DECIMAL(12,2),
    "depositFrequency" "DepositFrequency" DEFAULT 'MONTHLY',
    "creditLimit" DECIMAL(12,2),
    "statementDay" INTEGER,
    "dueDay" INTEGER,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL DEFAULT 'EXPENSE',
    "amount" DECIMAL(12,2) NOT NULL,
    "concept" TEXT NOT NULL,
    "category" "Category" NOT NULL DEFAULT 'OTRO',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "accountId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "transferToAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionShare" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "sharePct" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_createdById_idx" ON "Transaction"("createdById");

-- CreateIndex
CREATE INDEX "TransactionShare_transactionId_idx" ON "TransactionShare"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionShare_debtorId_idx" ON "TransactionShare"("debtorId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionShare" ADD CONSTRAINT "TransactionShare_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionShare" ADD CONSTRAINT "TransactionShare_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
