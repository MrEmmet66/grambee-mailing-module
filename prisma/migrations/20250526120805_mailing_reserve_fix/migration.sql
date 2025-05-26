-- AlterTable
ALTER TABLE "MailingReservation" ADD COLUMN     "adminApprovalStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "isProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "peopleInvited" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "trackingLink" TEXT;
