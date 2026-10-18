-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ReservationQueue" (
    "id" SERIAL NOT NULL,
    "mailingReservationId" INTEGER NOT NULL,
    "queueName" TEXT NOT NULL,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationQueue_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReservationQueue" ADD CONSTRAINT "ReservationQueue_mailingReservationId_fkey" FOREIGN KEY ("mailingReservationId") REFERENCES "MailingReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
