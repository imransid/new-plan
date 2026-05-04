-- CreateEnum
CREATE TYPE "ChannelFormat" AS ENUM ('EMBED', 'PLAIN', 'COMPACT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "goalPostTime" TEXT NOT NULL DEFAULT '09:00',
    "workUpdateTime" TEXT NOT NULL DEFAULT '18:00',
    "endOfDayTime" TEXT NOT NULL DEFAULT '23:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "doneAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_channels" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "format" "ChannelFormat" NOT NULL DEFAULT 'EMBED',
    "postGoals" BOOLEAN NOT NULL DEFAULT true,
    "postUpdates" BOOLEAN NOT NULL DEFAULT true,
    "lastPostedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "webhookId" TEXT,
    "webhookToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_schedules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '21:00',
    "hourlyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "endOfDayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channelId" TEXT,
    "channelName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'wrap',
    "status" TEXT NOT NULL,
    "errorCode" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "post_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tasks_userId_date_idx" ON "tasks"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "discord_connections_userId_guildId_key" ON "discord_connections"("userId", "guildId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_channels_connectionId_channelId_key" ON "discord_channels"("connectionId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_schedules_userId_key" ON "reminder_schedules"("userId");

-- CreateIndex
CREATE INDEX "post_logs_userId_date_idx" ON "post_logs"("userId", "date");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_connections" ADD CONSTRAINT "discord_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_channels" ADD CONSTRAINT "discord_channels_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "discord_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_logs" ADD CONSTRAINT "post_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
