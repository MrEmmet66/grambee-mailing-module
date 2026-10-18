/*
  Warnings:

  - You are about to drop the column `link` on the `MailingTargetBots` table. All the data in the column will be lost.
  - You are about to drop the column `peopleInvited` on the `MailingTargetBots` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MailingReservation" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MailingTargetBots" DROP COLUMN "link",
DROP COLUMN "peopleInvited";
