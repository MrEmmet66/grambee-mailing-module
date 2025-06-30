-- AlterTable
ALTER TABLE "BotSeller" ADD COLUMN     "totalBotAudience" INTEGER DEFAULT 0;

-- AlterTable
ALTER TABLE "MailingEntrances" ALTER COLUMN "userTelegramId" SET DATA TYPE BIGINT;
