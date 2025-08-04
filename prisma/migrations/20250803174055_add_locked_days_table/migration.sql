-- CreateTable
CREATE TABLE "LockedDays" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "botSellerId" INTEGER NOT NULL,

    CONSTRAINT "LockedDays_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LockedDays" ADD CONSTRAINT "LockedDays_botSellerId_fkey" FOREIGN KEY ("botSellerId") REFERENCES "BotSeller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
