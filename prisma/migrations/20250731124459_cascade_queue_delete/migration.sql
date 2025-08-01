-- DropForeignKey
ALTER TABLE "ReservationQueue" DROP CONSTRAINT "ReservationQueue_mailingReservationId_fkey";

-- AddForeignKey
ALTER TABLE "ReservationQueue" ADD CONSTRAINT "ReservationQueue_mailingReservationId_fkey" FOREIGN KEY ("mailingReservationId") REFERENCES "MailingReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
