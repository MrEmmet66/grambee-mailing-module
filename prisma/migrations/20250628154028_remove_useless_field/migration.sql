/*
  Warnings:

  - You are about to drop the column `peopleInvited` on the `MailingReservation` table. All the data in the column will be lost.
  - You are about to drop the column `selectedFilters` on the `MailingReservation` table. All the data in the column will be lost.
  - You are about to drop the `MailingEntrances` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MailingEntrances" DROP CONSTRAINT "MailingEntrances_mailingReservationId_fkey";

-- AlterTable
ALTER TABLE "MailingReservation" DROP COLUMN "peopleInvited",
DROP COLUMN "selectedFilters";

-- DropTable
DROP TABLE "MailingEntrances";
