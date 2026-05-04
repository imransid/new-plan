import { Injectable, Logger } from "@nestjs/common";
import { DateTime } from "luxon";
import { utcNowJsDate, utcTodayStartForDb } from "../../common/utc-datetime";
import { PrismaService } from "../../prisma/prisma.service";
import { DiscordApiService } from "./discord-api.service";
import { MessageFormatterService } from "./message-formatter.service";

type PostKind = "goal" | "work_update" | "wrap";

export interface PostResult {
  posted: number;
  failed: number;
  results: Array<{
    channelName: string;
    status: "success" | "failed";
    error?: string;
  }>;
}

@Injectable()
export class DiscordPosterService {
  private readonly logger = new Logger(DiscordPosterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: DiscordApiService,
    private readonly formatter: MessageFormatterService,
  ) {}

  // ─── NEW: post the morning goal list ────────────────────────────────────
  // Sends "TODAY GOAL" with every task planned for today, only to channels
  // that have postGoals=true.
  async postGoalList(userId: string): Promise<PostResult> {
    return this.run(userId, "goal");
  }

  // ─── NEW: post the work-update list ─────────────────────────────────────
  // Sends "Work Updated (date)" with only completed tasks, only to channels
  // that have postUpdates=true.
  async postWorkUpdate(userId: string): Promise<PostResult> {
    return this.run(userId, "work_update");
  }

  // ─── Existing daily wrap (kept for backward compat) ─────────────────────
  async postDailyWrap(userId: string): Promise<PostResult> {
    return this.run(userId, "wrap");
  }

  // ─── Shared posting pipeline ────────────────────────────────────────────
  private async run(userId: string, kind: PostKind): Promise<PostResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) return { posted: 0, failed: 0, results: [] };

    const discordUsername = this.displayNameForDiscord(user);

    const today = utcTodayStartForDb();

    const tasks = await this.prisma.task.findMany({
      where: { userId, date: today },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    // Decide which subset of tasks the message should contain.
    let payloadTasks = tasks;
    if (kind === "work_update") {
      payloadTasks = tasks.filter((t) => t.doneAt);
    }

    // Skip silently when there's nothing meaningful to send. We still allow
    // an empty goal list through (useful as a "today's plan is empty" nudge),
    // but we skip work_update / wrap entirely.
    if (kind !== "goal" && payloadTasks.length === 0) {
      this.logger.log(
        `Nothing to post for user ${userId} (${kind}) — skipping`,
      );
      return { posted: 0, failed: 0, results: [] };
    }

    const connections = await this.prisma.discordConnection.findMany({
      where: { userId },
      include: {
        channels: {
          where: this.channelFilter(kind),
        },
      },
    });

    const dateLabel = DateTime.utc().toFormat("LLLL d");
    const results: PostResult["results"] = [];

    for (const conn of connections) {
      for (const channel of conn.channels) {
        try {
          const payload =
            kind === "goal"
              ? this.formatter.formatGoals(
                  payloadTasks,
                  channel.format,
                  dateLabel,
                )
              : kind === "work_update"
                ? this.formatter.formatWorkUpdate(
                    payloadTasks,
                    channel.format,
                    dateLabel,
                  )
                : this.formatter.format(
                    payloadTasks,
                    channel.format,
                    dateLabel,
                  );

          await this.deliverDiscordMessage(channel, payload, discordUsername);

          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { lastPostedAt: utcNowJsDate(), lastError: null },
          });
          await this.prisma.postLog.create({
            data: {
              userId,
              date: today,
              channelId: channel.channelId,
              channelName: channel.channelName,
              kind,
              status: "success",
            },
          });
          results.push({ channelName: channel.channelName, status: "success" });
        } catch (err: any) {
          const message =
            err?.response?.data?.message ?? err?.message ?? "Unknown error";
          const code = err?.response?.status;
          this.logger.error(
            `Failed posting ${kind} to #${channel.channelName} for user ${userId}: ${message}`,
          );
          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { lastError: message },
          });
          await this.prisma.postLog.create({
            data: {
              userId,
              date: today,
              channelId: channel.channelId,
              channelName: channel.channelName,
              kind,
              status: "failed",
              errorCode: code,
              errorMessage: message,
            },
          });
          results.push({
            channelName: channel.channelName,
            status: "failed",
            error: message,
          });
        }
      }
    }

    const posted = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;
    return { posted, failed, results };
  }

  /** Discord max length for webhook `username`. */
  private displayNameForDiscord(user: {
    name: string | null;
    email: string;
  }): string {
    const trimmed = user.name?.trim();
    if (trimmed) return trimmed.slice(0, 80);
    const local = user.email.split("@")[0] || "DayPlan";
    return local.slice(0, 80);
  }

  /**
   * Posts via an incoming webhook with the user's display name when possible.
   * Falls back to the bot if webhooks are unavailable (missing Manage Webhooks, etc.).
   */
  private async deliverDiscordMessage(
    channel: {
      id: string;
      channelId: string;
      webhookId: string | null;
      webhookToken: string | null;
    },
    payload: { content?: string; embeds?: unknown[] },
    username: string,
  ): Promise<void> {
    try {
      let wid = channel.webhookId;
      let wtoken = channel.webhookToken;

      if (!wid || !wtoken) {
        const w = await this.api.ensurePostingWebhook(channel.channelId);
        wid = w.id;
        wtoken = w.token;
        await this.prisma.discordChannel.update({
          where: { id: channel.id },
          data: { webhookId: wid, webhookToken: wtoken },
        });
      }

      const sendWebhook = () =>
        this.api.executeWebhook(wid!, wtoken!, { ...payload, username });

      try {
        await sendWebhook();
      } catch (err: any) {
        const code = err?.response?.status;
        if (code === 401 || code === 404) {
          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { webhookId: null, webhookToken: null },
          });
          const w = await this.api.ensurePostingWebhook(channel.channelId);
          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { webhookId: w.id, webhookToken: w.token },
          });
          wid = w.id;
          wtoken = w.token;
          await this.api.executeWebhook(wid, wtoken, { ...payload, username });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      const hint = err?.response?.data?.message ?? err?.message ?? err;
      this.logger.warn(
        `Webhook post as "${username}" failed (${hint}) — using bot`,
      );
      await this.api.postMessage(channel.channelId, payload);
    }
  }

  // Per-kind WHERE clause for channels:
  // - 'goal'        → channels where enabled=true AND postGoals=true
  // - 'work_update' → channels where enabled=true AND postUpdates=true
  // - 'wrap'        → channels where enabled=true (legacy behavior)
  private channelFilter(kind: PostKind) {
    if (kind === "goal") return { enabled: true, postGoals: true };
    if (kind === "work_update") return { enabled: true, postUpdates: true };
    return { enabled: true };
  }
}
