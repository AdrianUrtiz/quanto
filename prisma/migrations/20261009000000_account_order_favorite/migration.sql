-- Orden manual + favorita de cuentas
ALTER TABLE "Account" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;
