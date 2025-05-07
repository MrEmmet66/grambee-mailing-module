-- CreateEnum
CREATE TYPE "BotSellerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITING');

-- CreateEnum
CREATE TYPE "MailingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITING');

-- CreateEnum
CREATE TYPE "BotCategories" AS ENUM ('GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSeller" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "apiKey" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "usersData" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fixedPrice" DOUBLE PRECISION,
    "subscriberPrice" DOUBLE PRECISION,
    "link" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "acceptStatus" "BotSellerStatus" NOT NULL DEFAULT 'PENDING',
    "category" "BotCategories" NOT NULL DEFAULT 'OTHER',
    "isChannel" BOOLEAN NOT NULL DEFAULT false,
    "channelId" TEXT,
    "statisticsFilePath" TEXT,
    "botLiveAudience" INTEGER DEFAULT 0,
    "botMonthlyActiveUsers" INTEGER DEFAULT 0,
    "lastMailingPeopleIncome" INTEGER DEFAULT 0,
    "lastMailingDate" TIMESTAMP(3),
    "lastMailingMoneyIncome" INTEGER DEFAULT 0,
    "channelAudience" INTEGER DEFAULT 0,
    "channelDaylyActiveUsers" INTEGER DEFAULT 0,
    "channelDailyPeopleIncome" INTEGER DEFAULT 0,

    CONSTRAINT "BotSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingReservation" (
    "id" SERIAL NOT NULL,
    "mailingId" INTEGER NOT NULL,
    "botSellerId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "selectedFilters" JSONB NOT NULL,

    CONSTRAINT "MailingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailing" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "botToken" TEXT,
    "channelId" TEXT,
    "isChannel" BOOLEAN NOT NULL DEFAULT false,
    "botLink" TEXT,
    "status" "MailingStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "postContent" TEXT NOT NULL,
    "postButtons" JSONB NOT NULL,
    "postMedia" TEXT,
    "postMediaType" TEXT,

    CONSTRAINT "Mailing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingTargetBots" (
    "id" SERIAL NOT NULL,
    "botSellerId" INTEGER NOT NULL,
    "mailingId" INTEGER NOT NULL,
    "link" TEXT NOT NULL,
    "peopleInvited" INTEGER DEFAULT 0,
    "paymentType" TEXT NOT NULL DEFAULT 'fixed',

    CONSTRAINT "MailingTargetBots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "BotSeller_apiKey_key" ON "BotSeller"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "BotSeller_botToken_key" ON "BotSeller"("botToken");

-- AddForeignKey
ALTER TABLE "BotSeller" ADD CONSTRAINT "BotSeller_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingReservation" ADD CONSTRAINT "MailingReservation_mailingId_fkey" FOREIGN KEY ("mailingId") REFERENCES "Mailing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingReservation" ADD CONSTRAINT "MailingReservation_botSellerId_fkey" FOREIGN KEY ("botSellerId") REFERENCES "BotSeller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailing" ADD CONSTRAINT "Mailing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingTargetBots" ADD CONSTRAINT "MailingTargetBots_botSellerId_fkey" FOREIGN KEY ("botSellerId") REFERENCES "BotSeller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingTargetBots" ADD CONSTRAINT "MailingTargetBots_mailingId_fkey" FOREIGN KEY ("mailingId") REFERENCES "Mailing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
