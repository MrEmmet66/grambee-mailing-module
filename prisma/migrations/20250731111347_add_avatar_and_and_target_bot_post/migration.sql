-- AlterTable
ALTER TABLE "BotSeller" ADD COLUMN     "avatarUrl" TEXT;

-- AlterTable
ALTER TABLE "MailingTargetBots" ADD COLUMN     "postButtons" JSONB,
ADD COLUMN     "postContent" TEXT,
ADD COLUMN     "postMedia" TEXT,
ADD COLUMN     "postMediaType" TEXT;
