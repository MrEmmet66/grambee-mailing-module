-- AlterTable
ALTER TABLE "BotSeller" ALTER COLUMN "category" SET DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "MailingTargetBots" ADD COLUMN     "paymentType" TEXT NOT NULL DEFAULT 'fixed';
