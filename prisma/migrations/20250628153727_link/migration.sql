/*
  Warnings:

  - You are about to drop the column `botLink` on the `Mailing` table. All the data in the column will be lost.
  - Added the required column `link` to the `Mailing` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Mailing" DROP COLUMN "botLink",
ADD COLUMN     "link" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MailingReservation" ADD COLUMN     "forwardedMessageId" TEXT;
