/*
  Warnings:

  - You are about to drop the column `apiKey` on the `BotSeller` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "BotSeller_apiKey_key";

-- AlterTable
ALTER TABLE "BotSeller" DROP COLUMN "apiKey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "refreshToken" TEXT;
