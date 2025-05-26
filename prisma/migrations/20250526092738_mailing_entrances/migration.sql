-- CreateTable
CREATE TABLE "MailingEntrances" (
    "id" SERIAL NOT NULL,
    "mailingTargetBotId" INTEGER NOT NULL,
    "userTelegramId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailingEntrances_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MailingEntrances" ADD CONSTRAINT "MailingEntrances_mailingTargetBotId_fkey" FOREIGN KEY ("mailingTargetBotId") REFERENCES "MailingTargetBots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
