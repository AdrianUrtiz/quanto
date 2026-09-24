-- Alfa: inicio limpio. Elimina usuarios demo (cascada a cuentas/movimientos) y cambia email por username.
DELETE FROM "User";
ALTER TABLE "User" DROP COLUMN "email";
ALTER TABLE "User" ADD COLUMN "username" TEXT NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
