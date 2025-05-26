/*
  Warnings:

  - You are about to drop the column `mailingTargetBotId` on the `MailingEntrances` table. All the data in the column will be lost.
  - Added the required column `mailingReservationId` to the `MailingEntrances` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "MailingEntrances" DROP CONSTRAINT "MailingEntrances_mailingTargetBotId_fkey";

-- AlterTable
ALTER TABLE "MailingEntrances" DROP COLUMN "mailingTargetBotId",
ADD COLUMN     "mailingReservationId" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "MailingEntrances" ADD CONSTRAINT "MailingEntrances_mailingReservationId_fkey" FOREIGN KEY ("mailingReservationId") REFERENCES "MailingReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
